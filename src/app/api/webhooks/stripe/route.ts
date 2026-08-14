import { Prisma } from "@/generated/prisma/client";
import type { WebhookEventStatus } from "@/generated/prisma/enums";
import { writeAudit } from "@/lib/audit/log";
import type { TenantTx } from "@/lib/db/client";
import { platformPrisma } from "@/lib/db/platform-client";
import { assertUuid } from "@/lib/db/tenant-context";
import { withTenant } from "@/lib/db/with-tenant";
import { logger } from "@/lib/logging/logger";
import { PaymentConfigError } from "@/lib/payments/config";
import {
  ProviderNotConfiguredError,
  ProviderNotImplementedError,
  WebhookNotConfiguredError,
  WebhookSignatureError,
} from "@/lib/payments/errors";
import {
  EFFECT_TO_PAYMENT_STATUS,
  PAYMENT_STATUS_ABERTOS,
  getProviderByKey,
  podeReprocessarWebhook,
  type NormalizedWebhookEvent,
  type WebhookEffect,
} from "@/lib/payments/provider";
import {
  agendarTarefasDaReserva,
  confirmarReservaPorPagamento,
} from "@/lib/reservations/actions";

/**
 * Webhook do Stripe — a única fonte de verdade sobre pagamento confirmado.
 *
 * A tela de sucesso do Checkout NÃO confirma nada: o pagador pode fechar o
 * navegador antes de voltar, e a URL de retorno é adivinhável. Quem move
 * dinheiro no nosso lado é este endpoint, e só depois de verificar a
 * assinatura (RN-009).
 *
 * Fica fora do gate de sessão do proxy — `/api/webhooks` está em
 * `PUBLIC_PREFIXES` (src/lib/auth/routes.ts), como manda
 * docs/06-mapa-navegacao.md. O Stripe não tem cookie nosso; o que
 * autentica a requisição é a assinatura HMAC do corpo.
 *
 * Ordem inegociável: verificar assinatura → gravar WebhookEvent → só então
 * processar. A unique (provider, eventId) é a idempotência: o Stripe
 * reenvia o mesmo evento por dias até receber 2xx, e um reenvio não pode
 * confirmar a reserva nem somar o pagamento duas vezes.
 */

// Node, não Edge: a verificação de assinatura e o Prisma dependem de APIs
// de Node. `force-dynamic` porque nada aqui pode ser servido de cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Limite do texto guardado em `WebhookEvent.error` — é diagnóstico, não log. */
const MAX_ERRO = 500;

const ACAO_AUDITORIA: Record<WebhookEffect, string> = {
  PAYMENT_SUCCEEDED: "payment.succeeded",
  PAYMENT_FAILED: "payment.failed",
  PAYMENT_EXPIRED: "payment.expired",
  PAYMENT_REFUNDED: "payment.refunded",
  PAYMENT_PARTIALLY_REFUNDED: "payment.partially_refunded",
  IGNORED: "payment.webhook_ignored",
};

/**
 * Ids vindos do metadata do provedor são texto livre até prova em
 * contrário. Comparar um texto qualquer com coluna `uuid` faz o Postgres
 * estourar 22P02 em vez de devolver zero linhas — o mesmo modo de falha
 * que `DENY_ALL` evita em src/lib/rbac/guard.ts.
 */
function pareceUuid(valor: string | null): valor is string {
  if (!valor) return false;
  try {
    assertUuid(valor);
    return true;
  } catch {
    return false;
  }
}

function mensagemDe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Descarta chaves nulas para não apagar dado já gravado com `null`. */
function semNulos(campos: Record<string, string | null>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(campos)) {
    if (v !== null) out[k] = v;
  }
  return out;
}

const PAYMENT_SELECT = {
  id: true,
  reservationId: true,
  amountCents: true,
  status: true,
} as const;

type PaymentAlvo = {
  id: string;
  reservationId: string | null;
  amountCents: number;
  status: string;
};

/**
 * Acha o `Payment` que o evento afeta.
 *
 * Três chaves, nesta ordem: o `paymentId` que nós mesmos carimbamos no
 * metadata (o mais confiável), a sessão de checkout e, por fim, o id da
 * cobrança — eventos de `charge.*` chegam sem referência à sessão.
 */
async function localizarPayment(
  tx: TenantTx,
  evento: NormalizedWebhookEvent,
): Promise<PaymentAlvo | null> {
  if (pareceUuid(evento.paymentId)) {
    const porId = await tx.payment.findFirst({
      where: { id: evento.paymentId },
      select: PAYMENT_SELECT,
    });
    if (porId) return porId;
  }

  const chaves: Prisma.PaymentWhereInput[] = [];
  if (evento.providerSessionId) {
    chaves.push({ providerSessionId: evento.providerSessionId });
  }
  if (evento.providerPaymentId) {
    chaves.push({ providerPaymentId: evento.providerPaymentId });
  }
  if (chaves.length === 0) return null;

  return tx.payment.findFirst({
    where: { provider: evento.provider, OR: chaves },
    select: PAYMENT_SELECT,
  });
}

type ResultadoEfeito = {
  /** A transição de status realmente aconteceu nesta entrega. */
  aplicado: boolean;
  /**
   * Id da reserva que ESTE evento levou a CONFIRMED, ou `null`. Sai da
   * transação porque as tarefas operacionais só podem ser enfileiradas
   * depois do commit (RN-008) — ver `confirmarReservaPorPagamento`.
   */
  reservaConfirmada: string | null;
};

const SEM_EFEITO: ResultadoEfeito = { aplicado: false, reservaConfirmada: null };

/**
 * Aplica o efeito no `Payment` e, quando for o caso, no total pago da
 * reserva. Devolve se a transição realmente aconteceu.
 */
async function aplicarEfeito(
  tx: TenantTx,
  payment: PaymentAlvo,
  evento: NormalizedWebhookEvent,
  novoStatus: NonNullable<(typeof EFFECT_TO_PAYMENT_STATUS)[WebhookEffect]>,
): Promise<ResultadoEfeito> {
  if (novoStatus === "SUCCEEDED") {
    /**
     * A transição é o guarda de idempotência, não uma leitura prévia: sob
     * entrega duplicada (o Stripe reenvia, e `charge.succeeded` chega junto
     * de `payment_intent.succeeded`), o segundo UPDATE espera o primeiro,
     * reavalia o `where` já com o status novo e afeta zero linhas. É essa
     * contagem que autoriza somar em `Reservation.paidCents` — sem ela, um
     * retry contaria o dinheiro duas vezes.
     */
    const { count } = await tx.payment.updateMany({
      where: { id: payment.id, status: { in: PAYMENT_STATUS_ABERTOS } },
      data: {
        status: "SUCCEEDED",
        paidAt: evento.paidAt ?? new Date(),
        failureCode: null,
        failureMessage: null,
        ...semNulos({
          providerPaymentId: evento.providerPaymentId,
          providerSessionId: evento.providerSessionId,
          cardBrand: evento.cardBrand,
          cardLast4: evento.cardLast4,
          receiptUrl: evento.receiptUrl,
        }),
      },
    });

    if (count === 0) {
      // Já estava pago. O evento ainda pode trazer o que só `charge.*`
      // traz — bandeira, últimos dígitos e recibo (RN-009: nada além
      // disso). Completar não é reprocessar.
      const complemento = semNulos({
        cardBrand: evento.cardBrand,
        cardLast4: evento.cardLast4,
        receiptUrl: evento.receiptUrl,
      });
      if (Object.keys(complemento).length > 0) {
        await tx.payment.updateMany({
          where: { id: payment.id },
          data: complemento,
        });
      }
      return SEM_EFEITO;
    }

    let reservaConfirmada: string | null = null;
    if (payment.reservationId) {
      await tx.reservation.update({
        where: { id: payment.reservationId },
        data: { paidCents: { increment: payment.amountCents } },
      });

      /**
       * A decisão PENDING → CONFIRMED é regra de reserva, não de pagamento
       * (sinal parcial mantém PENDING; só o total quita) — por isso mora em
       * `confirmarReservaPorPagamento` e não é duplicada aqui.
       *
       * Vai DENTRO desta transação de propósito: precisa enxergar o
       * `paidCents` recém-incrementado e desfazer junto se o commit falhar.
       * Só se chega até aqui quando o UPDATE acima afetou uma linha, então
       * um reenvio do Stripe não passa por este ponto — nem soma o dinheiro
       * de novo, nem reconfirma.
       */
      const confirmou = await confirmarReservaPorPagamento(tx, {
        reservationId: payment.reservationId,
        paymentId: payment.id,
        // Sem actorUserId: quem deu a baixa foi o provedor, e a trilha
        // precisa distinguir isso de uma baixa manual (RN-010).
        actorType: "WEBHOOK",
        // Mesmo instante gravado em `Payment.paidAt`: se o Stripe só
        // conseguir entregar dias depois, `confirmedAt` deve ser a hora em
        // que o dinheiro entrou, não a do nosso reprocessamento.
        agora: evento.paidAt ?? undefined,
      });
      if (confirmou) reservaConfirmada = payment.reservationId;
    }
    return { aplicado: true, reservaConfirmada };
  }

  if (novoStatus === "FAILED" || novoStatus === "CANCELLED") {
    // Só derruba cobrança ainda aberta: uma sessão expirada que chega
    // depois de o pagamento ter entrado por outro caminho não pode
    // "descancelar" o dinheiro.
    const { count } = await tx.payment.updateMany({
      where: { id: payment.id, status: { in: PAYMENT_STATUS_ABERTOS } },
      data: {
        status: novoStatus,
        failureCode: evento.failureCode,
        failureMessage: evento.failureMessage,
      },
    });
    return { aplicado: count > 0, reservaConfirmada: null };
  }

  /**
   * Reembolso. Só a transição a partir de SUCCEEDED conta: `amount_refunded`
   * do Stripe é ACUMULADO, então tratar um segundo evento de reembolso
   * parcial como novo desconto subtrairia o mesmo dinheiro duas vezes.
   * Registrar reembolsos parciais sucessivos exige uma coluna
   * `refundedCents` em `Payment`, que o schema ainda não tem.
   */
  const { count } = await tx.payment.updateMany({
    where: { id: payment.id, status: "SUCCEEDED" },
    data: { status: novoStatus },
  });

  if (count > 0 && payment.reservationId) {
    await tx.reservation.update({
      where: { id: payment.reservationId },
      data: {
        paidCents: { decrement: evento.amountCents ?? payment.amountCents },
      },
    });
  }
  return { aplicado: count > 0, reservaConfirmada: null };
}

async function processarEvento(
  evento: NormalizedWebhookEvent,
): Promise<{ status: WebhookEventStatus; motivo: string | null }> {
  const novoStatus = EFFECT_TO_PAYMENT_STATUS[evento.effect];
  if (!novoStatus) {
    return {
      status: "IGNORED",
      motivo: `Evento sem efeito sobre pagamento: ${evento.type}.`,
    };
  }

  if (!pareceUuid(evento.tenantId)) {
    // Cobrança criada fora da plataforma (direto no painel do Stripe, ou
    // por outra integração na mesma conta) chega sem o nosso metadata.
    // Não há tenant para atribuir, e adivinhar seria pior que ignorar.
    logger.warn(
      { eventId: evento.eventId, type: evento.type },
      "Webhook Stripe sem tenantId válido no metadata — ignorado",
    );
    return {
      status: "IGNORED",
      motivo: "Evento sem tenantId válido no metadata.",
    };
  }

  const tenantId = evento.tenantId;

  const reservaConfirmada = await withTenant({ tenantId }, async (tx) => {
    const payment = await localizarPayment(tx, evento);
    if (!payment) {
      // Corrida esperada: o webhook costuma chegar antes de a transação
      // que criou o Payment ter commitado. Lançar aqui devolve 500, o
      // Stripe reenvia e o próximo envio encontra a linha.
      throw new Error(
        `Pagamento não encontrado para o evento ${evento.eventId} (${evento.type}).`,
      );
    }

    const { aplicado, reservaConfirmada } = await aplicarEfeito(
      tx,
      payment,
      evento,
      novoStatus,
    );

    await writeAudit(tx, {
      action: ACAO_AUDITORIA[evento.effect],
      entityType: "Payment",
      entityId: payment.id,
      // O ator é o provedor, não uma pessoa: a trilha precisa distinguir
      // "o operador deu baixa" de "o Stripe confirmou" (RN-010).
      actorType: "WEBHOOK",
      actorLabel: `stripe:${evento.type}`,
      before: { status: payment.status },
      after: {
        status: novoStatus,
        aplicado,
        confirmouReserva: reservaConfirmada !== null,
        eventId: evento.eventId,
        amountCents: evento.amountCents,
        currency: evento.currency,
        providerPaymentId: evento.providerPaymentId,
      },
    });

    return reservaConfirmada;
  });

  /**
   * Depois do COMMIT, nunca dentro: enfileirar na transação agendaria
   * trabalho para algo que ainda pode sofrer rollback, e o job leria a
   * reserva ainda PENDING (RN-008). `agendarTarefasDaReserva` é
   * best-effort e não propaga falha de fila — um pagamento confirmado não
   * pode virar 500 (e reenvio do Stripe) porque o Redis caiu.
   */
  if (reservaConfirmada) {
    await agendarTarefasDaReserva(tenantId, reservaConfirmada);
  }

  return { status: "PROCESSED", motivo: null };
}

/**
 * Grava o evento ANTES de qualquer efeito e decide se ele deve ser
 * processado agora. Usa `platformPrisma` porque `WebhookEvent` é
 * tenant-scoped no client da aplicação e, neste ponto, ainda não há tenant
 * resolvido — é o caso (2) documentado em src/lib/db/platform-client.ts.
 */
async function registrarEvento(
  evento: NormalizedWebhookEvent,
): Promise<{ id: string; processar: boolean }> {
  try {
    const row = await platformPrisma.webhookEvent.create({
      data: {
        provider: evento.provider,
        eventId: evento.eventId,
        type: evento.type,
        // Só chega aqui evento já verificado — parseWebhook lança antes.
        signatureVerified: true,
        payload: evento.payload as Prisma.InputJsonValue,
        tenantId: pareceUuid(evento.tenantId) ? evento.tenantId : null,
        status: "RECEIVED",
        attempts: 1,
      },
      select: { id: true },
    });
    return { id: row.id, processar: true };
  } catch (err) {
    const duplicado =
      err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
    if (!duplicado) throw err;

    const existente = await platformPrisma.webhookEvent.findUnique({
      where: {
        provider_eventId: { provider: evento.provider, eventId: evento.eventId },
      },
      select: { id: true, status: true },
    });
    if (!existente) throw err;

    // "Já vi este id" não é "já processei": um evento que ficou em FAILED
    // (respondemos 500) ou em RECEIVED (morremos no meio) precisa de nova
    // tentativa, senão o reenvio do Stripe o perderia para sempre.
    if (!podeReprocessarWebhook(existente.status)) {
      return { id: existente.id, processar: false };
    }

    await platformPrisma.webhookEvent.update({
      where: { id: existente.id },
      data: { attempts: { increment: 1 } },
    });
    return { id: existente.id, processar: true };
  }
}

export async function POST(request: Request) {
  // Corpo CRU: a assinatura cobre a string exata recebida. Ler como JSON e
  // reserializar invalidaria a verificação (Next.js 16 não faz parsing
  // automático em route handler — ver node_modules/next/dist/docs).
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");

  let evento: NormalizedWebhookEvent;
  try {
    evento = await getProviderByKey("STRIPE").parseWebhook(rawBody, signature);
  } catch (err) {
    if (err instanceof WebhookSignatureError) {
      // Nunca aceitação otimista: sem assinatura válida isto é um POST
      // anônimo dizendo que uma reserva foi paga.
      logger.warn({ erro: err.message }, "Webhook Stripe rejeitado na assinatura");
      return Response.json({ error: "assinatura inválida" }, { status: 400 });
    }
    if (
      err instanceof WebhookNotConfiguredError ||
      err instanceof ProviderNotConfiguredError ||
      err instanceof ProviderNotImplementedError ||
      err instanceof PaymentConfigError
    ) {
      // Defeito nosso, não do remetente: o evento é legítimo e vai se
      // perder. 503 faz o Stripe retentar enquanto alguém arruma a chave.
      logger.error(
        { erro: err.message },
        "Webhook Stripe recebido sem configuração de provedor",
      );
      return Response.json({ error: "provedor não configurado" }, { status: 503 });
    }
    logger.warn({ erro: mensagemDe(err) }, "Webhook Stripe malformado");
    return Response.json({ error: "payload inválido" }, { status: 400 });
  }

  const { id, processar } = await registrarEvento(evento);
  if (!processar) {
    // Reenvio de evento já finalizado: reconhecer e parar.
    return Response.json({ received: true, duplicated: true });
  }

  try {
    const { status, motivo } = await processarEvento(evento);
    await platformPrisma.webhookEvent.update({
      where: { id },
      data: { status, processedAt: new Date(), error: motivo },
    });
    return Response.json({ received: true });
  } catch (err) {
    const erro = mensagemDe(err);
    await platformPrisma.webhookEvent.update({
      where: { id },
      data: { status: "FAILED", error: erro.slice(0, MAX_ERRO) },
    });
    logger.error(
      { eventId: evento.eventId, type: evento.type, erro },
      "Falha ao processar webhook Stripe",
    );
    // 500 de propósito: é o que faz o Stripe reenviar. Responder 200 aqui
    // esconderia um pagamento perdido.
    return Response.json({ error: "falha ao processar" }, { status: 500 });
  }
}
