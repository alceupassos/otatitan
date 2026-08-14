import "server-only";
import type {
  PaymentIntentKind,
  ReservationStatus,
} from "@/generated/prisma/enums";
import { writeAudit } from "@/lib/audit/log";
import { ehPagamentoDuplicado } from "@/lib/db/errors";
import { withTenant, type TenantTx } from "@/lib/db/with-tenant";
import { logger } from "@/lib/logging/logger";
import {
  requirePermission,
  scopeFor,
  type ActorContext,
} from "@/lib/rbac/guard";
import { formatarCodigo } from "@/lib/reservations/codigo";
import {
  MINUTOS_DE_HOLD,
  ocupaDisponibilidade,
  saldoDevedorCents,
} from "@/lib/reservations/estados";
import {
  PagamentoInvalido,
  ReservaNaoEncontrada,
} from "@/lib/reservations/errors";
import { CheckoutError } from "./errors";
import { MIN_MINUTOS_DE_CHECKOUT } from "./limites";
import {
  getPaymentProvider,
  PAYMENT_STATUS_ABERTOS,
  type CheckoutResult,
  type PaymentProviderAdapter,
} from "./provider";

/**
 * Cobrança por link — o elo entre a reserva e o checkout hospedado do
 * provedor (UC-050, ADR-004).
 *
 * Este módulo é a única coisa no sistema que chama `createCheckout`. Ele
 * NÃO é `"use server"`, de propósito: recebe o `ActorContext` como
 * parâmetro, e todo export de um módulo `"use server"` vira endpoint
 * chamável com argumentos arbitrários — expor isto deixaria qualquer um
 * forjar o ator. Mesmo motivo de `src/lib/reservations/actions.ts`.
 *
 * O valor cobrado é SEMPRE o saldo devedor recalculado aqui, no servidor:
 * a assinatura de `abrirCobranca` nem tem por onde receber um valor
 * (RN-003 / RN-006). Nenhum campo neste arquivo aceita, transporta ou
 * grava dado de cartão — o pagador digita o cartão no domínio do provedor
 * (RN-009).
 */

/**
 * Prefixo das chaves de idempotência das cobranças por link.
 *
 * A chave é `cobranca:<reservationId>:<tentativa>` — determinística, e é
 * ela que faz o duplo submit bater na unique `(tenantId, idempotencyKey)`
 * em vez de virar dois `Payment` (ver `prepararCobranca`). O prefixo
 * também é o filtro que separa estas cobranças das baixas manuais, cuja
 * chave começa com `manual:`.
 */
const PREFIXO_CHAVE = "cobranca";

/**
 * Teto da janela de reaproveitamento de um link, contado da criação dele.
 *
 * É o teto, não a regra inteira: a validade real de uma cobrança de reserva
 * PENDING é o `holdExpiresAt`, porque é ele que o adapter recebe em
 * `expiresAt`. Um link nunca sobrevive ao hold — sobreviver significaria
 * cobrar por uma data que o worker já devolveu ao calendário (RN-004) — e
 * `validadeDoLink` aplica os dois limites juntos.
 *
 * Errar para o lado curto abre um link novo; errar para o longo devolveria
 * um link morto ao hóspede.
 */
const MS_DE_VALIDADE = MINUTOS_DE_HOLD * 60_000;

/**
 * Marca gravada em `Payment.description` quando a abertura FALHOU no
 * provedor.
 *
 * Sem ela não há como distinguir, olhando a linha, "a chamada ao provedor
 * está acontecendo agora" de "a chamada morreu e não existe checkout do
 * outro lado" — e é essa distinção que decide entre recusar o segundo submit
 * e deixar o operador tentar de novo. Ver `situacaoDaCobrancaAberta`.
 *
 * Não colide com o link: `linkGuardado` só aceita texto que SEJA uma URL
 * http(s).
 */
const MARCA_DE_FALHA = "Falha ao abrir a cobrança no provedor:";

/** Limite do texto da marca — a coluna também carrega observação livre. */
const MAX_MARCA = 300;

export type EntradaCobranca = {
  reservationId: string;
  /**
   * Natureza da cobrança. Por padrão é deduzida do que já entrou: nada
   * pago ainda é `FULL`, saldo remanescente é `BALANCE`.
   */
  intent?: PaymentIntentKind;
  /**
   * Adapter a usar. Injetável só para teste — em produção é sempre o
   * provedor ativo do ambiente. Nenhum caminho de UI passa este campo, e
   * um teste que o omitisse chamaria a API real do provedor.
   */
  provider?: PaymentProviderAdapter;
  agora?: Date;
};

export type CobrancaAberta = {
  paymentId: string;
  reservationId: string;
  code: string;
  /** Centavos inteiros — o saldo devedor apurado pelo servidor (RN-006). */
  amountCents: number;
  currency: string;
  /** Para onde mandar quem vai pagar. */
  redirectUrl: string;
  /** `true` quando um link ainda válido foi reaproveitado (duplo submit). */
  reaproveitada: boolean;
};

/**
 * A reserva admite cobrança?
 *
 * A resposta vem da máquina de estados, não de uma lista de `if` espalhada
 * pelas actions: `ocupaDisponibilidade` é verdade exatamente para os
 * estados em que a estadia ainda existe como ocupação. Cancelada e no-show
 * já devolveram a data ao calendário e não têm o que cobrar — devolver
 * dinheiro ali é assunto de reembolso, não de nova cobrança. É a mesma
 * fronteira que `registrarPagamentoManual` aplica à baixa manual.
 */
function admiteCobranca(status: ReservationStatus): boolean {
  return ocupaDisponibilidade(status);
}

/**
 * Onde o link do checkout fica guardado: em `Payment.description`.
 *
 * Não é elegante e não é por preguiça — `Payment` não tem coluna para a URL
 * do checkout, e o schema está congelado nesta entrega. Sem persistir a
 * URL não existe reaproveitamento possível: o segundo submit teria de abrir
 * um segundo checkout só para descobrir para onde mandar o hóspede, que é
 * exatamente o que este módulo evita.
 *
 * A leitura exige que o texto SEJA uma URL http(s), porque a mesma coluna
 * carrega observação livre nas baixas manuais — uma nota do operador nunca
 * pode ser interpretada como link de pagamento.
 */
function linkGuardado(description: string | null): string | null {
  if (!description) return null;
  return /^https?:\/\/\S+$/.test(description) ? description : null;
}

/** Base pública do app para as URLs de retorno (igual a `src/lib/mail/send.ts`). */
function baseDoApp(): string {
  return (process.env.APP_URL ?? "http://localhost:3040").replace(/\/+$/, "");
}

type SituacaoDaCobranca =
  | { tipo: "reaproveitavel"; id: string; amountCents: number; link: string }
  /** Outra requisição está no meio da chamada ao provedor — ver abaixo. */
  | { tipo: "em_andamento" }
  | { tipo: "nenhuma" };

/**
 * O que já existe de cobrança aberta para esta reserva.
 *
 * Sem isto, um operador ansioso que clica duas vezes gera DOIS checkouts
 * para a mesma reserva — e o hóspede paga o que estiver na tela dele, que
 * pode ser o link que o nosso lado já esqueceu. O adapter do Asaas não
 * ajuda: `POST /checkouts` não aceita chave de idempotência (o Asaas não
 * documenta esse cabeçalho), então a deduplicação tem de ser nossa.
 *
 * A chave da unique NÃO cobre a janela inteira. O `Payment` é commitado
 * ANTES da chamada de rede (ver a nota de ordem em `abrirCobranca`) e a
 * sessão só é gravada DEPOIS dela; no meio — a duração inteira do
 * `POST /checkouts`, de centenas de ms a segundos — a segunda requisição já
 * enxerga o `Payment` da primeira, conta uma tentativa a mais, monta uma
 * chave que não colide e abre um SEGUNDO checkout. Foi assim que duas
 * chamadas ao provedor viraram dois links vivos de R$ 2.620,00, ambos
 * pagáveis, para uma reserva de R$ 2.620,00.
 *
 * Por isso o estado da linha é lido pelo que está em `description`, e não
 * pela existência de `providerSessionId`:
 *
 * - **link http(s)** — checkout confirmado do outro lado. Reaproveita, desde
 *   que o valor seja o MESMO saldo devedor de agora: se uma baixa manual
 *   entrou no meio, o link antigo cobra um valor que já não é devido
 *   (RN-003), e aí abre-se um link novo (o antigo fica ABERTO de propósito —
 *   ver `abrirCobranca`).
 * - **marca de falha** — a tentativa morreu na rede e não há checkout. Não
 *   atrapalha: uma cobrança nova pode ser aberta.
 * - **vazio** — ou a chamada está acontecendo AGORA, ou ela terminou e a
 *   gravação do passo 3 falhou (checkout existe, sessão não gravada). Nos
 *   dois casos a resposta certa é recusar com texto legível, nunca abrir um
 *   segundo checkout.
 */
async function situacaoDaCobrancaAberta(
  tx: TenantTx,
  p: {
    reservationId: string;
    saldoCents: number;
    agora: Date;
    holdExpiresAt: Date | null;
  },
): Promise<SituacaoDaCobranca> {
  // Passado o hold, nem o link nem a reserva valem mais: o worker libera a
  // data e o checkout morre junto (`expiresAt`).
  if (p.holdExpiresAt && p.holdExpiresAt.getTime() <= p.agora.getTime()) {
    return { tipo: "nenhuma" };
  }

  const abertos = await tx.payment.findMany({
    where: {
      reservationId: p.reservationId,
      status: { in: PAYMENT_STATUS_ABERTOS },
      idempotencyKey: { startsWith: `${PREFIXO_CHAVE}:${p.reservationId}:` },
      createdAt: { gt: new Date(p.agora.getTime() - MS_DE_VALIDADE) },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, amountCents: true, description: true },
  });

  let reaproveitavel: SituacaoDaCobranca | null = null;

  for (const pagamento of abertos) {
    const link = linkGuardado(pagamento.description);
    if (link) {
      if (pagamento.amountCents === p.saldoCents && !reaproveitavel) {
        reaproveitavel = {
          tipo: "reaproveitavel",
          id: pagamento.id,
          amountCents: pagamento.amountCents,
          link,
        };
      }
      continue;
    }
    if (pagamento.description?.startsWith(MARCA_DE_FALHA)) continue;
    // Sem link e sem marca: tem gente na rede. Recusar ganha do risco de um
    // segundo checkout vivo, e vale mesmo que o valor seja outro — o
    // problema é o checkout duplicado, não o valor.
    return { tipo: "em_andamento" };
  }

  return reaproveitavel ?? { tipo: "nenhuma" };
}

/**
 * Até quando o link desta cobrança pode viver.
 *
 * `null` para reserva sem hold (já confirmada): não há data a proteger, e o
 * adapter usa a validade padrão dele.
 */
function prazoDoLink(reserva: {
  status: ReservationStatus;
  holdExpiresAt: Date | null;
}): Date | null {
  return reserva.status === "PENDING" ? reserva.holdExpiresAt : null;
}

type Preparo =
  | { tipo: "reaproveitada"; cobranca: CobrancaAberta }
  | { tipo: "em_andamento" }
  | {
      tipo: "nova";
      paymentId: string;
      reservationId: string;
      code: string;
      amountCents: number;
      currency: string;
      idempotencyKey: string;
      /** Prazo do link, amarrado ao hold da reserva (RN-004). */
      expiresAt: Date | null;
    };

/**
 * Primeira etapa, dentro de UMA transação: valida a reserva, apura o saldo
 * e ou reaproveita o link aberto, ou registra o `Payment` PENDING.
 *
 * `permitirCriacao: false` é o caminho de quem perdeu a corrida da chave
 * duplicada: aí só o reaproveitamento serve, criar de novo colidiria igual.
 */
async function prepararUmaVez(
  actor: ActorContext,
  entrada: EntradaCobranca,
  provider: PaymentProviderAdapter,
  agora: Date,
  permitirCriacao: boolean,
): Promise<Preparo | null> {
  return withTenant(
    { tenantId: actor.tenantId, userId: actor.userId },
    async (tx) => {
      /**
       * Serializa as aberturas de cobrança da MESMA reserva, como
       * `inserirReserva` já faz por unidade (ADR-003). Não é a garantia — a
       * garantia é a unique `(tenantId, idempotencyKey)` mais a leitura do
       * que já está aberto —, mas faz a segunda requisição só entrar depois
       * do COMMIT da primeira, e portanto encontrar um estado decidível em
       * vez de contar uma tentativa que ainda não existia.
       */
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${entrada.reservationId}::text, 0))
      `;

      const reserva = await tx.reservation.findFirst({
        where: {
          id: entrada.reservationId,
          ...scopeFor(actor, "Reservation"),
        },
        select: {
          id: true,
          code: true,
          status: true,
          currency: true,
          totalCents: true,
          paidCents: true,
          holdExpiresAt: true,
        },
      });
      // Inexistente e de outro tenant dão o MESMO erro: responder algo
      // diferente confirmaria que o id existe na carteira de outra empresa.
      if (!reserva) throw new ReservaNaoEncontrada();

      if (!admiteCobranca(reserva.status)) {
        throw new PagamentoInvalido(
          "Não é possível cobrar uma reserva cancelada ou marcada como " +
            "no-show. Devolver valores já pagos é caso de reembolso.",
        );
      }

      const saldoCents = saldoDevedorCents(reserva);
      // Zero é recusa explícita, nunca uma cobrança de R$ 0,00: o provedor
      // rejeitaria o valor de qualquer forma, e o operador precisa ler o
      // motivo em vez de um erro de API.
      if (saldoCents === 0) {
        throw new PagamentoInvalido(
          "Esta reserva já está quitada — não há saldo devedor a cobrar.",
        );
      }

      const prazo = prazoDoLink(reserva);

      const situacao = await situacaoDaCobrancaAberta(tx, {
        reservationId: reserva.id,
        saldoCents,
        agora,
        holdExpiresAt: prazo,
      });

      if (situacao.tipo === "em_andamento") {
        return { tipo: "em_andamento" as const };
      }

      if (situacao.tipo === "reaproveitavel") {
        await writeAudit(tx, {
          action: "payment.checkout_reused",
          entityType: "Payment",
          entityId: situacao.id,
          actorUserId: actor.userId,
          after: {
            reservationId: reserva.id,
            code: reserva.code,
            amountCents: situacao.amountCents,
            currency: reserva.currency,
            motivo:
              "Link ainda válido para o mesmo saldo — nenhuma cobrança nova " +
              "foi aberta no provedor.",
          },
        });
        return {
          tipo: "reaproveitada" as const,
          cobranca: {
            paymentId: situacao.id,
            reservationId: reserva.id,
            code: reserva.code,
            amountCents: situacao.amountCents,
            currency: reserva.currency,
            redirectUrl: situacao.link,
            reaproveitada: true,
          },
        };
      }

      if (!permitirCriacao) return null;

      /**
       * O link não pode viver mais que o hold (RN-004): passado o prazo, o
       * worker devolve a data ao calendário e a unidade pode ser revendida —
       * um link ainda pagável ali cobra por uma estadia que já é de outro
       * hóspede. Como o provedor não aceita validade menor que
       * `MIN_MINUTOS_DE_CHECKOUT`, com pouco hold restante não existe link
       * honesto a abrir: a recusa legível é a resposta certa.
       */
      if (prazo) {
        const restamMs = prazo.getTime() - agora.getTime();
        if (restamMs < MIN_MINUTOS_DE_CHECKOUT * 60_000) {
          throw new PagamentoInvalido(
            restamMs <= 0
              ? "O prazo desta reserva venceu — ela já não segura as datas. " +
                "Refaça a reserva antes de cobrar."
              : `Faltam menos de ${MIN_MINUTOS_DE_CHECKOUT} minutos para o ` +
                "fim do prazo desta reserva, e um link de pagamento viveria " +
                "mais que ela. Confirme a reserva ou registre o pagamento " +
                "por outro meio.",
          );
        }
      }

      /**
       * A tentativa entra na chave para que uma cobrança nova (link
       * expirado, saldo mudou, tentativa anterior morreu na rede) tenha
       * chave própria, enquanto dois submits SIMULTÂNEOS calculam a MESMA
       * chave e colidem na unique — que é o que se quer barrar.
       */
      const tentativa =
        1 +
        (await tx.payment.count({
          where: {
            reservationId: reserva.id,
            idempotencyKey: { startsWith: `${PREFIXO_CHAVE}:${reserva.id}:` },
          },
        }));
      const idempotencyKey = `${PREFIXO_CHAVE}:${reserva.id}:${tentativa}`;

      const payment = await tx.payment.create({
        data: {
          reservationId: reserva.id,
          provider: provider.key,
          /**
           * `OTHER` porque ainda não se sabe: quem escolhe entre pix e
           * cartão é o pagador, na tela do provedor, e o webhook não traz a
           * forma escolhida. Gravar `CARD` seria uma afirmação que não
           * temos como sustentar no extrato.
           */
          method: "OTHER",
          intent: entrada.intent ?? (reserva.paidCents > 0 ? "BALANCE" : "FULL"),
          status: "PENDING",
          amountCents: saldoCents,
          currency: reserva.currency,
          idempotencyKey,
          createdById: actor.userId,
        },
        select: { id: true },
      });

      return {
        tipo: "nova" as const,
        paymentId: payment.id,
        reservationId: reserva.id,
        code: reserva.code,
        amountCents: saldoCents,
        currency: reserva.currency,
        idempotencyKey,
        expiresAt: prazo,
      };
    },
  );
}

/**
 * Recusa de quem chegou enquanto outra requisição abre a cobrança.
 *
 * É melhor que abrir um segundo checkout: em segundos o link do vencedor
 * existe, e dois links vivos para a mesma reserva significam a mesma estadia
 * cobrada duas vezes, sem caminho automático de estorno (RN-003/RN-006).
 */
function cobrancaEmAndamento(): PagamentoInvalido {
  return new PagamentoInvalido(
    "Uma cobrança para esta reserva está sendo aberta neste instante. " +
      "Recarregue a reserva em alguns segundos para ver o link.",
  );
}

/**
 * O `em_andamento` fica FORA do tipo de retorno porque esta função lança
 * nesse caso (ver o fim do corpo). Declarar o `Preparo` inteiro faria o
 * chamador ter de estreitar de novo um caso que nunca chega até ele.
 */
async function prepararCobranca(
  actor: ActorContext,
  entrada: EntradaCobranca,
  provider: PaymentProviderAdapter,
  agora: Date,
): Promise<Exclude<Preparo, { tipo: "em_andamento" }>> {
  let preparo: Preparo | null;
  try {
    preparo = await prepararUmaVez(actor, entrada, provider, agora, true);
  } catch (err) {
    if (!ehPagamentoDuplicado(err)) throw err;

    // Corrida real: outra requisição inseriu o `Payment` com a MESMA chave
    // entre a nossa contagem e o nosso INSERT. Quem perdeu não cria nada —
    // procura o link do vencedor.
    preparo = await prepararUmaVez(actor, entrada, provider, agora, false);
  }

  // `null`: o vencedor da corrida commitou o `Payment`, mas ainda não há
  // link para reaproveitar.
  if (!preparo || preparo.tipo === "em_andamento") throw cobrancaEmAndamento();
  return preparo;
}

/**
 * Abre (ou reaproveita) a cobrança do saldo devedor e devolve o link de
 * pagamento.
 *
 * ORDEM DOS EFEITOS — a decisão que sustenta o resto do arquivo.
 *
 * A chamada de rede ao provedor fica FORA de qualquer transação: manter uma
 * transação aberta esperando a internet segura lock de linha da reserva e
 * conexão do pool pelo tempo do timeout do provedor.
 *
 * Fica, ainda, DEPOIS do commit do `Payment`, nunca antes:
 *
 *   1. transação: valida, apura o saldo, cria o `Payment` PENDING → COMMIT
 *   2. rede: `createCheckout`, carimbando `{tenantId, paymentId}` no metadata
 *   3. transação: grava `providerSessionId` + link e a trilha (RN-010)
 *
 * Na ordem inversa (provedor primeiro) existiria a falha inaceitável: o
 * hóspede paga um checkout que já está de pé e o webhook chega apontando
 * para um `paymentId` que nunca foi gravado — dinheiro recebido sem
 * registro. Nesta ordem, o `paymentId` que viaja no `externalReference` já
 * está commitado antes de o provedor sequer conhecer a cobrança.
 *
 * Os dois modos de falha desta ordem são recuperáveis:
 *
 * - **Falha no passo 2**: sobra um `Payment` PENDING sem sessão. Ele NÃO é
 *   marcado como falho de propósito — uma resposta perdida é
 *   indistinguível de uma requisição que nunca chegou, e se o checkout
 *   existir do outro lado o hóspede ainda pode pagá-lo; só um `Payment` em
 *   status aberto aceita a baixa do webhook (`PAYMENT_STATUS_ABERTOS`).
 *   Fechá-lo aqui trocaria "linha a mais no extrato" por "pagamento
 *   perdido em silêncio". Como o reaproveitamento exige
 *   `providerSessionId`, a próxima tentativa abre uma cobrança nova, com
 *   chave própria.
 * - **Falha no passo 3**: o checkout existe e o link é devolvido ao
 *   operador mesmo assim. O webhook continua encontrando o pagamento
 *   porque `localizarPayment` procura primeiro pelo `paymentId` do
 *   `externalReference`, não pelo `providerSessionId` — é exatamente para
 *   isso que aquele campo carrega os ids.
 */
export async function abrirCobranca(
  actor: ActorContext,
  entrada: EntradaCobranca,
): Promise<CobrancaAberta> {
  await requirePermission(actor, "payments.create");

  const agora = entrada.agora ?? new Date();
  const provider = entrada.provider ?? getPaymentProvider();

  // Recusa ANTES de gravar qualquer coisa: o provedor manual não tem
  // checkout hospedado (devolve sessão e link nulos), e criar um `Payment`
  // PENDING que nunca teria link só sujaria o extrato.
  if (provider.key === "MANUAL") {
    throw new CheckoutError(
      "O provedor de pagamento ativo é o manual, que não gera link. Use " +
        "“Registrar pagamento” para lançar a entrada.",
    );
  }

  const preparo = await prepararCobranca(actor, entrada, provider, agora);
  if (preparo.tipo === "reaproveitada") return preparo.cobranca;

  const base = baseDoApp();
  const codigoFormatado = formatarCodigo(preparo.code);

  let resultado: CheckoutResult;
  try {
    resultado = await provider.createCheckout({
      reservationId: preparo.reservationId,
      amountCents: preparo.amountCents,
      currency: preparo.currency,
      description: `Reserva ${codigoFormatado}`,
      idempotencyKey: preparo.idempotencyKey,
      // O link morre com o hold, não 30 minutos depois de ele nascer.
      expiresAt: preparo.expiresAt,
      /**
       * O retorno é uma página PÚBLICA, não o painel. Quem paga pode ser o
       * operador (que abriu a cobrança) ou o hóspede a quem ele repassou o
       * link — e não há como saber qual dos dois. Mandar os dois para
       * `/reservas/[id]` fazia o hóspede cair na tela de login logo depois
       * de pagar, que é o pior momento possível para pedir uma senha que
       * ele não tem. A página pública recebe os dois, não consulta nada e
       * oferece ao operador o atalho para o painel.
       */
      successUrl: `${base}/stays/pagamento?r=${preparo.reservationId}`,
      cancelUrl: `${base}/stays/pagamento?estado=cancelado&r=${preparo.reservationId}`,
      // O webhook chega sem sessão, sem cookie e sem tenant: estes dois ids
      // são o único caminho de volta até o dinheiro certo.
      metadata: { tenantId: actor.tenantId, paymentId: preparo.paymentId },
    });
  } catch (err) {
    await registrarFalha(actor, preparo, err);
    // A mensagem do adapter já vem em pt-BR e nomeia a recusa do provedor;
    // reescrevê-la aqui só apagaria o diagnóstico.
    throw err instanceof CheckoutError
      ? err
      : new CheckoutError(
          `Não foi possível abrir a cobrança no provedor: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
  }

  if (!resultado.redirectUrl) {
    // Adapter que devolve 2xx sem link não cobra ninguém; tratar como
    // sucesso mandaria o operador para lugar nenhum.
    const semLink = new CheckoutError(
      "O provedor não devolveu link de pagamento — não há para onde " +
        "mandar o hóspede.",
    );
    await registrarFalha(actor, preparo, semLink);
    throw semLink;
  }

  const redirectUrl = resultado.redirectUrl;

  try {
    await withTenant(
      { tenantId: actor.tenantId, userId: actor.userId },
      async (tx) => {
        // Sem filtro de status: `providerSessionId` e o link são fatos sobre
        // o checkout, verdadeiros mesmo se o webhook já tiver dado a baixa
        // (no pix, ele às vezes chega antes deste UPDATE).
        await tx.payment.updateMany({
          where: { id: preparo.paymentId },
          data: {
            providerSessionId: resultado.providerSessionId,
            description: redirectUrl,
          },
        });

        await writeAudit(tx, {
          action: "payment.checkout_opened",
          entityType: "Payment",
          entityId: preparo.paymentId,
          actorUserId: actor.userId,
          after: {
            reservationId: preparo.reservationId,
            code: preparo.code,
            provider: resultado.provider,
            providerSessionId: resultado.providerSessionId,
            amountCents: preparo.amountCents,
            currency: preparo.currency,
            // Nada de cartão aqui, nem no resto do fluxo (RN-009).
          },
        });
      },
    );
  } catch (err) {
    /**
     * O checkout EXISTE. Falhar a chamada agora faria o operador tentar de
     * novo e abrir um segundo link para a mesma reserva — o oposto do que
     * este módulo garante. O webhook segue casando pelo `paymentId` do
     * `externalReference`, então o pagamento não se perde.
     */
    logger.error(
      {
        tenantId: actor.tenantId,
        paymentId: preparo.paymentId,
        err: (err as Error).message,
      },
      "Checkout aberto no provedor, mas a sessão não pôde ser gravada",
    );

    // A trilha é tentada de novo sozinha: um checkout vivo sem registro de
    // quem o abriu é exatamente o que a RN-010 proíbe. Se nem isso passar,
    // resta o log acima.
    try {
      await withTenant(
        { tenantId: actor.tenantId, userId: actor.userId },
        (tx) =>
          writeAudit(tx, {
            action: "payment.checkout_opened",
            entityType: "Payment",
            entityId: preparo.paymentId,
            actorUserId: actor.userId,
            after: {
              reservationId: preparo.reservationId,
              code: preparo.code,
              provider: resultado.provider,
              providerSessionId: resultado.providerSessionId,
              amountCents: preparo.amountCents,
              currency: preparo.currency,
              observacao:
                "Checkout aberto no provedor, mas a sessão não pôde ser " +
                "gravada no Payment.",
            },
          }),
      );
    } catch (falhaTrilha) {
      logger.error(
        { err: (falhaTrilha as Error).message },
        "Não foi possível gravar a trilha do checkout aberto",
      );
    }
  }

  return {
    paymentId: preparo.paymentId,
    reservationId: preparo.reservationId,
    code: preparo.code,
    amountCents: preparo.amountCents,
    currency: preparo.currency,
    redirectUrl,
    reaproveitada: false,
  };
}

/**
 * Marca a tentativa que não virou link e grava a trilha (RN-010).
 *
 * A marca em `description` não é decoração: é ela que diz à próxima
 * requisição que aquele `Payment` aberto NÃO tem checkout do outro lado, e
 * portanto não é uma abertura em andamento. Sem ela, a recusa de duplo
 * submit prenderia a reserva até o fim do hold depois de qualquer falha de
 * rede (ver `situacaoDaCobrancaAberta`).
 *
 * Best-effort: a falha original é o que interessa a quem chamou, e um
 * problema ao gravar isto não pode substituí-la na mensagem de erro. O
 * `Payment` continua PENDING — ver a nota de ordem em `abrirCobranca`.
 */
async function registrarFalha(
  actor: ActorContext,
  preparo: Extract<Preparo, { tipo: "nova" }>,
  err: unknown,
): Promise<void> {
  const motivo = err instanceof Error ? err.message : String(err);
  logger.error(
    {
      tenantId: actor.tenantId,
      paymentId: preparo.paymentId,
      reservationId: preparo.reservationId,
      err: motivo,
    },
    "Falha ao abrir cobrança no provedor",
  );

  try {
    await withTenant(
      { tenantId: actor.tenantId, userId: actor.userId },
      async (tx) => {
        // Sem filtro de status: se o webhook já tiver dado a baixa (checkout
        // criado, resposta perdida), a marca vira só uma observação no
        // extrato — nunca um estado de pagamento diferente.
        await tx.payment.updateMany({
          where: { id: preparo.paymentId, description: null },
          data: {
            description: `${MARCA_DE_FALHA} ${motivo}`.slice(0, MAX_MARCA),
          },
        });

        await writeAudit(tx, {
          action: "payment.checkout_failed",
          entityType: "Payment",
          entityId: preparo.paymentId,
          actorUserId: actor.userId,
          after: {
            reservationId: preparo.reservationId,
            code: preparo.code,
            amountCents: preparo.amountCents,
            currency: preparo.currency,
            motivo,
            observacao:
              "O pagamento segue em aberto de propósito: se o checkout tiver " +
              "sido criado do outro lado, só um status aberto aceita a baixa " +
              "do webhook.",
          },
        });
      },
    );
  } catch (falhaTrilha) {
    logger.error(
      { err: (falhaTrilha as Error).message },
      "Não foi possível gravar a trilha da cobrança que falhou",
    );
  }
}
