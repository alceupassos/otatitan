import { Prisma } from "@/generated/prisma/client";
import type {
  PaymentIntentKind,
  WebhookEventStatus,
} from "@/generated/prisma/enums";
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
  getProviderByKey,
  PAYMENT_STATUS_ABERTOS,
  podeReprocessarWebhook,
  type NormalizedWebhookEvent,
  type PaymentProviderAdapter,
  type WebhookEffect,
} from "@/lib/payments/provider";
import {
  agendarTarefasDaReserva,
  confirmarReservaPorPagamento,
} from "@/lib/reservations/actions";
import { pagaAEstadia } from "@/lib/reservations/estados";

/**
 * Webhook do Asaas — a única fonte de verdade sobre pagamento confirmado.
 *
 * A tela de sucesso do checkout NÃO confirma nada: o hóspede pode fechar o
 * navegador antes de voltar, e a URL de retorno é adivinhável. Quem move
 * dinheiro no nosso lado é este endpoint, e só depois de verificar o token
 * do remetente (RN-009).
 *
 * Fica fora do gate de sessão do proxy — `/api/webhooks` está em
 * `PUBLIC_PREFIXES` (src/lib/auth/routes.ts), como manda
 * docs/06-mapa-navegacao.md. O Asaas não tem cookie nosso; o que autentica
 * a requisição é o cabeçalho `asaas-access-token`.
 *
 * Ordem inegociável: verificar → gravar WebhookEvent → só então processar.
 * A unique (provider, eventId) é a idempotência: o Asaas reenfileira e
 * reenvia o mesmo evento até receber 2xx, e um reenvio não pode confirmar a
 * reserva nem somar o pagamento duas vezes.
 *
 * DIFERENÇA IMPORTANTE em relação ao webhook do Stripe: lá a autenticação é
 * uma assinatura HMAC sobre o corpo; aqui é um token compartilhado no
 * cabeçalho (o Asaas não assina o corpo). O corpo cru continua sendo lido
 * como texto — é o que o adapter recebe —, mas nada é calculado sobre ele.
 */

// Node, não Edge: a comparação em tempo constante (node:crypto) e o Prisma
// dependem de APIs de Node. `force-dynamic` porque nada aqui pode ser
// servido de cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cabeçalho em que o Asaas devolve o token que cadastramos no painel. */
const HEADER_TOKEN = "asaas-access-token";

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
 * Adapter do Asaas para ESTE endpoint.
 *
 * Não usa o provedor ativo do ambiente: um evento pode chegar atrasado
 * depois de a plataforma ter trocado de provedor padrão, e ele ainda tem que
 * ser verificado com as credenciais do Asaas — mesma razão pela qual a rota
 * do Stripe usa `getProviderByKey("STRIPE")`.
 */
function adapterAsaas(): PaymentProviderAdapter {
  return getProviderByKey("ASAAS");
}

/**
 * Ids vindos da referência externa do provedor são texto livre até prova em
 * contrário. Comparar um texto qualquer com coluna `uuid` faz o Postgres
 * estourar 22P02 em vez de devolver zero linhas — o mesmo modo de falha que
 * `DENY_ALL` evita em src/lib/rbac/guard.ts.
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
  intent: true,
} as const;

type PaymentAlvo = {
  id: string;
  reservationId: string | null;
  amountCents: number;
  status: string;
  intent: PaymentIntentKind;
};

/** Formata centavos para as mensagens de revisão manual (RN-006). */
function emReais(centavos: number): string {
  return `R$ ${(centavos / 100).toFixed(2).replace(".", ",")}`;
}

/**
 * Acha o `Payment` que o evento afeta.
 *
 * Três chaves, nesta ordem: o `paymentId` que nós mesmos serializamos no
 * `externalReference` (o mais confiável), o checkout e, por fim, o id da
 * cobrança. A ordem importa mais aqui que no Stripe: os eventos `PAYMENT_*`
 * do Asaas chegam sem nenhuma referência ao checkout, e o `providerPaymentId`
 * só existe na nossa linha depois que um evento anterior o gravou — ou seja,
 * no primeiro evento a referência externa é o ÚNICO caminho de volta.
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
  /**
   * Preenchido quando o evento exige olho humano: o dinheiro não pôde ser
   * ajustado sozinho (reembolso sem valor no payload, segundo reembolso
   * parcial) ou entrou onde já não deveria (reserva cancelada, cobrança que
   * tínhamos dado como expirada, total pago acima do devido). Vira aviso no
   * log, na auditoria e em `WebhookEvent.error` — é a diferença entre um
   * problema visível e um pagamento que ninguém sabe que existe (RN-010).
   */
  revisaoManual: string | null;
};

const SEM_EFEITO: ResultadoEfeito = {
  aplicado: false,
  reservaConfirmada: null,
  revisaoManual: null,
};

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
    const dadosDaBaixa = {
      status: "SUCCEEDED" as const,
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
    };

    /**
     * A transição é o guarda de idempotência, não uma leitura prévia: sob
     * entrega duplicada — e no Asaas ela é a REGRA, porque `PAYMENT_CONFIRMED`
     * (pago) e `PAYMENT_RECEIVED` (dinheiro na conta) chegam os dois para a
     * mesma cobrança —, o segundo UPDATE espera o primeiro, reavalia o `where`
     * já com o status novo e afeta zero linhas. É essa contagem que autoriza
     * somar em `Reservation.paidCents`; sem ela, a reserva apareceria paga em
     * dobro só por ter recebido os dois eventos normais do fluxo.
     */
    const { count } = await tx.payment.updateMany({
      where: { id: payment.id, status: { in: PAYMENT_STATUS_ABERTOS } },
      data: dadosDaBaixa,
    });

    /**
     * `count === 0` tem DOIS significados, e tratá-los como um só descartava
     * dinheiro em silêncio.
     *
     * (a) Entrega duplicada: o pagamento já está SUCCEEDED (ou já reembolsado).
     *     Nada a aplicar — só completar bandeira/comprovante.
     * (b) O pagamento estava CANCELLED/FAILED. Isso acontece o tempo todo com
     *     pix: o Asaas manda `PAYMENT_OVERDUE`/`CHECKOUT_EXPIRED` quando o
     *     link vence, mas o QR continua pagável, e o `PAYMENT_RECEIVED` chega
     *     depois. Antes, esse evento caía no ramo "já estava pago" e o
     *     dinheiro sumia do nosso lado: reserva com `paidCents: 0`, o worker
     *     expirava o hold e a data era revendida — com o valor na conta do
     *     Asaas. Um pix pago não se desfaz: a baixa é aceita e sinalizada.
     */
    let recuperadoForaDaJanela = false;
    if (count === 0) {
      const recuperado = await tx.payment.updateMany({
        where: { id: payment.id, status: { in: ["CANCELLED", "FAILED"] } },
        data: dadosDaBaixa,
      });
      recuperadoForaDaJanela = recuperado.count > 0;

      if (!recuperadoForaDaJanela) {
        // Já estava pago. O evento ainda pode trazer o que só o segundo evento
        // traz — bandeira, últimos dígitos e comprovante (RN-009: nada além
        // disso). Completar não é reprocessar.
        const complemento = semNulos({
          providerPaymentId: evento.providerPaymentId,
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
    }

    const avisos: string[] = [];
    if (recuperadoForaDaJanela) {
      avisos.push(
        `Pagamento de ${emReais(payment.amountCents)} confirmado DEPOIS de a ` +
          "cobrança ter sido dada como expirada ou recusada. O valor foi " +
          "registrado; confira se a reserva ainda tem as datas e, se não " +
          "tiver, providencie reembolso.",
      );
    }

    let reservaConfirmada: string | null = null;
    if (payment.reservationId) {
      /**
       * Caução e extra ficam FORA de `paidCents`: entram no extrato como
       * `Payment`, mas não pagam a diária (`pagaAEstadia`, RN-003/RN-006).
       * Sem esta distinção, uma caução confirmaria a reserva sem ninguém ter
       * pago a estadia — mesma regra da baixa manual.
       */
      const abate = pagaAEstadia(payment.intent);
      if (abate) {
        await tx.reservation.update({
          where: { id: payment.reservationId },
          data: { paidCents: { increment: payment.amountCents } },
        });
      }

      /**
       * A decisão PENDING → CONFIRMED é regra de reserva, não de pagamento
       * (sinal parcial mantém PENDING; só o total quita) — por isso mora em
       * `confirmarReservaPorPagamento` e não é duplicada aqui.
       *
       * Vai DENTRO desta transação de propósito: precisa enxergar o
       * `paidCents` recém-incrementado e desfazer junto se o commit falhar.
       * Só se chega até aqui quando um dos UPDATEs acima afetou uma linha,
       * então o segundo evento do par CONFIRMED/RECEIVED não passa por este
       * ponto — nem soma o dinheiro de novo, nem reconfirma.
       */
      const confirmacao = await confirmarReservaPorPagamento(tx, {
        reservationId: payment.reservationId,
        paymentId: payment.id,
        // Sem actorUserId: quem deu a baixa foi o provedor, e a trilha
        // precisa distinguir isso de uma baixa manual (RN-010).
        actorType: "WEBHOOK",
        // Mesmo instante gravado em `Payment.paidAt`: se o Asaas só
        // conseguir entregar horas depois, `confirmedAt` deve ser a hora em
        // que o dinheiro entrou, não a do nosso reprocessamento.
        agora: evento.paidAt ?? undefined,
      });
      if (confirmacao.confirmou) reservaConfirmada = payment.reservationId;

      /**
       * Dinheiro recebido para uma reserva que já não aceita confirmação. As
       * datas voltaram ao calendário (RN-005) e podem já ter sido revendidas;
       * o pagamento fica no extrato de uma reserva morta. Antes disso, o
       * único vestígio era `confirmouReserva: false` na trilha.
       */
      if (
        confirmacao.motivo === "status_nao_confirmavel" &&
        (confirmacao.status === "CANCELLED" || confirmacao.status === "NO_SHOW")
      ) {
        avisos.push(
          `Pagamento de ${emReais(payment.amountCents)} recebido para reserva ` +
            "cancelada ou marcada como no-show: as datas já voltaram ao " +
            "calendário. Providencie reembolso ou reabra a venda.",
        );
      }

      if (
        confirmacao.paidCents !== null &&
        confirmacao.totalCents !== null &&
        confirmacao.paidCents > confirmacao.totalCents
      ) {
        // Sintoma visível de cobrança em dobro: dois links pagos para a mesma
        // reserva. `saldoDevedorCents` satura em zero e esconderia o excesso.
        avisos.push(
          `Total pago (${emReais(confirmacao.paidCents)}) acima do total da ` +
            `reserva (${emReais(confirmacao.totalCents)}). Confira se houve ` +
            "duas cobranças para a mesma estadia.",
        );
      }
    }

    return {
      aplicado: true,
      reservaConfirmada,
      revisaoManual: avisos.length > 0 ? avisos.join(" ") : null,
    };
  }

  if (novoStatus === "FAILED" || novoStatus === "CANCELLED") {
    // Só derruba cobrança ainda aberta: um `CHECKOUT_EXPIRED` que chega
    // depois de o pix ter entrado (o link expira, o pagamento não) não pode
    // "descancelar" o dinheiro.
    const { count } = await tx.payment.updateMany({
      where: { id: payment.id, status: { in: PAYMENT_STATUS_ABERTOS } },
      data: {
        status: novoStatus,
        failureCode: evento.failureCode,
        failureMessage: evento.failureMessage,
      },
    });
    return { aplicado: count > 0, reservaConfirmada: null, revisaoManual: null };
  }

  /**
   * Reembolso.
   *
   * A lista `refunds` do Asaas é ACUMULADA: cada evento traz TODOS os
   * estornos já feitos, não o último. Sem uma coluna `refundedCents` em
   * `Payment` (o schema não tem), não dá para descontar de forma idempotente
   * a diferença entre o acumulado do evento e o que já saiu do `paidCents`.
   *
   * Daí a divisão em dois caminhos, pelo status DE ONDE a transição sai — e
   * cada um com seu próprio UPDATE condicional, que é o único ponto
   * reavaliado sob concorrência:
   *
   * - saindo de SUCCEEDED: nada foi descontado ainda, o acumulado do evento
   *   É o valor a descontar;
   * - saindo de PARTIALLY_REFUNDED (segundo estorno, ou o total depois de um
   *   parcial): parte já saiu, e o quanto não é reconstituível aqui. O status
   *   é corrigido e o dinheiro vai para revisão humana — silêncio nesse ponto
   *   deixava a reserva afirmando um pago que já tinha voltado ao hóspede.
   */
  const deSucesso = await tx.payment.updateMany({
    where: { id: payment.id, status: "SUCCEEDED" },
    data: { status: novoStatus },
  });

  if (deSucesso.count === 0) {
    // Reembolso total depois de um parcial: o status precisa acompanhar, mas
    // o valor a devolver é a diferença, que não temos onde ler.
    if (novoStatus === "REFUNDED") {
      const deParcial = await tx.payment.updateMany({
        where: { id: payment.id, status: "PARTIALLY_REFUNDED" },
        data: { status: "REFUNDED" },
      });
      if (deParcial.count > 0) {
        return {
          aplicado: true,
          reservaConfirmada: null,
          revisaoManual:
            `Reembolso TOTAL de ${emReais(
              evento.amountCents ?? payment.amountCents,
            )} sobre um pagamento que já tinha estorno parcial: o status foi ` +
            "corrigido, mas o paidCents da reserva NÃO foi ajustado pela " +
            "diferença. Confira o extrato no Asaas e acerte a reserva.",
        };
      }
    }

    /**
     * Nem de SUCCEEDED nem de PARTIALLY_REFUNDED: ou é reentrega de um evento
     * já aplicado, ou é um NOVO estorno sobre um pagamento já parcialmente
     * reembolsado — este segundo caso movimenta dinheiro de verdade e não
     * pode responder 200 mudo, que era o comportamento anterior.
     */
    const atual = await tx.payment.findFirst({
      where: { id: payment.id },
      select: { status: true },
    });
    if (
      atual?.status === "PARTIALLY_REFUNDED" &&
      novoStatus === "PARTIALLY_REFUNDED" &&
      evento.amountCents !== null
    ) {
      return {
        aplicado: false,
        reservaConfirmada: null,
        revisaoManual:
          `Novo estorno parcial (acumulado de ${emReais(evento.amountCents)} ` +
          "no Asaas) sobre um pagamento que já constava como parcialmente " +
          "reembolsado: o paidCents da reserva NÃO foi ajustado. Confira o " +
          "extrato no Asaas e acerte a reserva.",
      };
    }
    return SEM_EFEITO;
  }

  /**
   * Quanto tirar de `Reservation.paidCents`.
   *
   * No reembolso TOTAL, o valor da nossa cobrança é queda legítima: devolveu
   * tudo, sai tudo. No PARCIAL, não existe queda — `payment.value` do Asaas
   * continua sendo o valor CHEIO mesmo depois do estorno, e usá-lo zeraria
   * um pagamento que ainda tem dinheiro dentro. Sem a lista `refunds` no
   * payload, o adapter devolve `null` de propósito, e aqui a escolha é não
   * mexer no dinheiro e pedir conferência humana.
   */
  const devolvido =
    novoStatus === "REFUNDED"
      ? (evento.amountCents ?? payment.amountCents)
      : evento.amountCents;

  if (devolvido === null) {
    return {
      aplicado: true,
      reservaConfirmada: null,
      revisaoManual:
        "Reembolso parcial sem valor devolvido no payload: o status do " +
        "pagamento mudou, mas o paidCents da reserva NÃO foi ajustado. " +
        "Confira o valor no Asaas e acerte a reserva manualmente.",
    };
  }

  // Caução e extra nunca entraram em `paidCents` (ver `pagaAEstadia`);
  // devolvê-los não pode tirar de lá o que nunca somou.
  if (payment.reservationId && pagaAEstadia(payment.intent)) {
    await tx.reservation.update({
      where: { id: payment.reservationId },
      data: { paidCents: { decrement: devolvido } },
    });
  }
  return { aplicado: true, reservaConfirmada: null, revisaoManual: null };
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
    // Cobrança criada fora da plataforma (direto no painel do Asaas, ou por
    // outra integração na mesma conta) chega sem a nossa referência externa.
    // Não há tenant para atribuir, e adivinhar seria pior que ignorar.
    logger.warn(
      { eventId: evento.eventId, type: evento.type },
      "Webhook Asaas sem tenantId válido no externalReference — ignorado",
    );
    return {
      status: "IGNORED",
      motivo: "Evento sem tenantId válido no externalReference.",
    };
  }

  const tenantId = evento.tenantId;

  const { reservaConfirmada, revisaoManual } = await withTenant(
    { tenantId },
    async (tx) => {
      const payment = await localizarPayment(tx, evento);
      if (!payment) {
        /**
         * Corrida esperada: o webhook costuma chegar antes de a transação
         * que criou o Payment ter commitado. Lançar aqui devolve 500, o
         * Asaas reenvia e o próximo envio encontra a linha.
         *
         * Vale mais que no Stripe manter esse caminho raro: a fila do Asaas
         * é sequencial e, após ~15 falhas consecutivas, ela pode ser
         * INTERROMPIDA — aí nenhum evento do tenant chega até alguém
         * reativar no painel (e o evento some de vez depois de 14 dias).
         */
        throw new Error(
          `Pagamento não encontrado para o evento ${evento.eventId} (${evento.type}).`,
        );
      }

      const efeito = await aplicarEfeito(tx, payment, evento, novoStatus);

      await writeAudit(tx, {
        action: ACAO_AUDITORIA[evento.effect],
        entityType: "Payment",
        entityId: payment.id,
        // O ator é o provedor, não uma pessoa: a trilha precisa distinguir
        // "o operador deu baixa" de "o Asaas confirmou" (RN-010).
        actorType: "WEBHOOK",
        actorLabel: `asaas:${evento.type}`,
        before: { status: payment.status },
        after: {
          status: novoStatus,
          aplicado: efeito.aplicado,
          confirmouReserva: efeito.reservaConfirmada !== null,
          revisaoManual: efeito.revisaoManual,
          eventId: evento.eventId,
          amountCents: evento.amountCents,
          currency: evento.currency,
          providerPaymentId: evento.providerPaymentId,
        },
      });

      return {
        reservaConfirmada: efeito.reservaConfirmada,
        revisaoManual: efeito.revisaoManual,
      };
    },
  );

  /**
   * Depois do COMMIT, nunca dentro: enfileirar na transação agendaria
   * trabalho para algo que ainda pode sofrer rollback, e o job leria a
   * reserva ainda PENDING (RN-008). `agendarTarefasDaReserva` é best-effort e
   * não propaga falha de fila — um pagamento confirmado não pode virar 500 (e
   * reenvio do Asaas) porque o Redis caiu.
   */
  if (reservaConfirmada) {
    await agendarTarefasDaReserva(tenantId, reservaConfirmada);
  }

  if (revisaoManual) {
    logger.warn(
      { eventId: evento.eventId, type: evento.type, tenantId },
      revisaoManual,
    );
  }

  // PROCESSED mesmo com pendência de conferência: o evento FOI aplicado, e
  // devolver FAILED faria o Asaas reenviar para sempre um evento que a nova
  // tentativa também não conseguiria resolver.
  return { status: "PROCESSED", motivo: revisaoManual };
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
    // tentativa, senão o reenvio do Asaas o perderia para sempre.
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
  // Corpo CRU como texto: é o que o adapter recebe e o que vai inteiro para
  // `WebhookEvent.payload`. Next.js 16 não faz parsing automático em route
  // handler — `request.text()` é a leitura padrão de webhook
  // (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md).
  const rawBody = await request.text();
  const token = request.headers.get(HEADER_TOKEN);

  let evento: NormalizedWebhookEvent;
  try {
    evento = await adapterAsaas().parseWebhook(rawBody, token);
  } catch (err) {
    if (err instanceof WebhookSignatureError) {
      // Nunca aceitação otimista: sem o token válido isto é um POST anônimo
      // da internet dizendo que uma reserva foi paga.
      logger.warn({ erro: err.message }, "Webhook Asaas rejeitado na verificação");
      return Response.json({ error: "token inválido" }, { status: 400 });
    }
    if (
      err instanceof WebhookNotConfiguredError ||
      err instanceof ProviderNotConfiguredError ||
      err instanceof ProviderNotImplementedError ||
      err instanceof PaymentConfigError
    ) {
      // Defeito nosso, não do remetente: o evento é legítimo e vai se
      // perder. 503 faz o Asaas retentar enquanto alguém arruma a chave.
      logger.error(
        { erro: mensagemDe(err) },
        "Webhook Asaas recebido sem configuração de provedor",
      );
      return Response.json({ error: "provedor não configurado" }, { status: 503 });
    }
    logger.warn({ erro: mensagemDe(err) }, "Webhook Asaas malformado");
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
      "Falha ao processar webhook Asaas",
    );
    // 500 de propósito: é o que faz o Asaas reenviar. Responder 200 aqui
    // esconderia um pagamento perdido. O preço é conhecido — falhas
    // consecutivas interrompem a fila do Asaas —, e é o preço certo: fila
    // parada é visível e recuperável; pagamento perdido em silêncio, não.
    return Response.json({ error: "falha ao processar" }, { status: 500 });
  }
}
