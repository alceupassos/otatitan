import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type {
  ActorType,
  PaymentIntentKind,
  PaymentMethod,
  ReservationSource,
  ReservationStatus,
} from "@/generated/prisma/enums";
import { writeAudit } from "@/lib/audit/log";
import { hojeUtc, toDateOnly } from "@/lib/dates";
import { ehPagamentoDuplicado } from "@/lib/db/errors";
import { withTenant, type TenantTx } from "@/lib/db/with-tenant";
import { encontrarOuCriarHospede } from "@/lib/guests/repository";
import type { HospedeInput } from "@/lib/guests/schemas";
import { logger } from "@/lib/logging/logger";
import { getProviderByKey } from "@/lib/payments/provider";
import { cotarUnidade } from "@/lib/pricing/queries";
import { precoConfere, type Cotacao, type ExtrasCotacao } from "@/lib/pricing/quote";
import {
  requirePermission,
  scopeFor,
  type ActorContext,
} from "@/lib/rbac/guard";
import { formatarCodigo, gerarCodigoUnico } from "./codigo";
import {
  calcularHoldExpiresAt,
  pagaAEstadia,
  podeTransicionar,
  quitada,
  saldoDevedorCents,
} from "./estados";
import {
  ehColisaoDeCodigo,
  ehConflitoDeOcupacao,
  PagamentoInvalido,
  PrecoMudou,
  ReservaNaoEncontrada,
  TransicaoInvalida,
  UnidadeIndisponivel,
  UnidadeNaoEncontrada,
  UnidadeNaoVendavel,
} from "./errors";
import { carregarUnidadeParaReserva, cotarNaTransacao } from "./queries";

/**
 * Escritas de reserva — o coração do fluxo vertical (UC-040, UC-050).
 *
 * Este arquivo NÃO é `"use server"`, de propósito. Todo export de um
 * módulo `"use server"` vira endpoint chamável pelo cliente com argumentos
 * arbitrários; funções que recebem o `ActorContext` como parâmetro —
 * como todas as daqui — deixariam qualquer um forjar o ator. Mesmo motivo
 * de `src/lib/guests/repository.ts`. Além disso, o webhook de pagamento
 * precisa de `confirmarReservaPorPagamento(tx, …)`, que recebe uma
 * transação aberta e jamais poderia ser um endpoint.
 *
 * O ator vem sempre de quem já o resolveu no servidor (`requireActor…`
 * numa página ou server action, ou o tenant do evento, no webhook). A
 * permissão é conferida aqui, junto ao dado, com `requirePermission` — e
 * não delegada ao chamador, porque estas funções têm mais de um ponto de
 * entrada.
 */

/** Refazer a transação por colisão de código sorteado (evento raríssimo). */
const MAX_TENTATIVAS_TRANSACAO = 3;

function assertTransicao(
  de: ReservationStatus,
  para: ReservationStatus,
  acao: string,
): void {
  if (!podeTransicionar(de, para)) throw new TransicaoInvalida(de, para, acao);
}

// ── Criação (UC-040) ──────────────────────────────────────────────────────

export type NovaReserva = {
  unitId: string;
  checkIn: Date;
  checkOut: Date;
  adults: number;
  children?: number;
  /** Bebês não contam contra `Unit.maxGuests`, mas ficam registrados. */
  infants?: number;
  /** Ficha do hóspede primário, já validada por `hospedeSchema`. */
  hospede: HospedeInput;
  /**
   * Total que o cliente tinha na tela, em centavos (RN-003). `null` ou
   * ausente = não houve cotação exibida (reserva lançada pelo operador), e
   * aí não há divergência a apurar — o preço continua sendo o do servidor.
   */
  totalConferidoCents?: number | null;
  origem?: ReservationSource;
  guestNotes?: string | null;
  internalNotes?: string | null;
  /** Plano escolhido pelo hóspede no canal direto; ausente = vencedor. */
  ratePlanId?: string;
  extras?: ExtrasCotacao;
  /** Injetáveis para teste; por padrão, hoje em UTC e agora. */
  hoje?: Date;
  agora?: Date;
};

export type ReservaCriada = {
  id: string;
  code: string;
  codigoFormatado: string;
  status: ReservationStatus;
  currency: string;
  totalCents: number;
  holdExpiresAt: Date | null;
  hospedeId: string;
  /** `false` quando um cadastro de hóspede existente foi reaproveitado. */
  hospedeCriado: boolean;
  cotacao: Cotacao;
};

/**
 * Cria a reserva — tudo ou nada.
 *
 * Ordem que importa:
 * 1. Pré-cotação FORA da transação. Serve para recusar cedo (unidade
 *    inexistente, sem tarifa, preço divergente) antes de tocar em
 *    qualquer escrita — inclusive antes de criar o hóspede.
 * 2. Hóspede resolvido também fora da transação, como exige
 *    `encontrarOuCriarHospede`: a colisão de e-mail concorrente é
 *    resolvida abrindo transação nova, e um P2002 dentro da transação da
 *    reserva a abortaria inteira. O custo, se a reserva falhar depois, é
 *    um cadastro órfão — um contato a mais, não uma inconsistência.
 * 3. Transação: recotar (é esta cotação que vai para as colunas e para
 *    `quoteSnapshot`), criar `Reservation` PENDING, o vínculo do hóspede,
 *    o `AvailabilityBlock` e a auditoria.
 *
 * A garantia anti-overbooking é a constraint de exclusão GiST do Postgres
 * (RN-002), não a busca de disponibilidade nem o advisory lock: qualquer
 * checagem de aplicação tem uma janela entre o SELECT e o INSERT.
 */
export async function criarReserva(
  actor: ActorContext,
  entrada: NovaReserva,
  opts: { autorizar?: boolean } = {},
): Promise<ReservaCriada> {
  if (opts.autorizar !== false) {
    await requirePermission(actor, "reservations.create");
  }

  const hoje = entrada.hoje ?? hojeUtc();
  const agora = entrada.agora ?? new Date();
  const children = entrada.children ?? 0;
  const infants = entrada.infants ?? 0;
  const hospedes = entrada.adults + children;

  const previa = await cotarUnidade(actor, {
    unitId: entrada.unitId,
    checkIn: entrada.checkIn,
    checkOut: entrada.checkOut,
    hospedes,
    hoje,
    ratePlanId: entrada.ratePlanId,
    extras: entrada.extras,
  });
  if (!previa) throw new UnidadeNaoEncontrada();
  if (!previa.resultado.ok) {
    throw new UnidadeNaoVendavel(
      previa.resultado.recusa,
      previa.resultado.recusas,
    );
  }
  if (
    entrada.totalConferidoCents != null &&
    !precoConfere(previa.resultado.cotacao, entrada.totalConferidoCents)
  ) {
    throw new PrecoMudou(previa.resultado.cotacao, entrada.totalConferidoCents);
  }

  const hospede = await encontrarOuCriarHospede(actor, entrada.hospede);

  for (let tentativa = 1; ; tentativa++) {
    try {
      return await inserirReserva(actor, entrada, {
        hoje,
        agora,
        children,
        infants,
        hospedes,
        hospedeId: hospede.id,
        hospedeCriado: hospede.criado,
      });
    } catch (err) {
      // Duas transações sortearam o mesmo código: refazer resolve, e o
      // usuário não precisa saber que houve um sorteio.
      if (ehColisaoDeCodigo(err) && tentativa < MAX_TENTATIVAS_TRANSACAO) {
        logger.warn(
          { tenantId: actor.tenantId, tentativa },
          "Colisão de código de reserva — refazendo a transação",
        );
        continue;
      }
      // A constraint de exclusão recusou: as datas foram tomadas entre a
      // cotação e o INSERT. É o banco cumprindo a RN-002, não um defeito.
      if (ehConflitoDeOcupacao(err)) throw new UnidadeIndisponivel();
      throw err;
    }
  }
}

type ContextoDaCriacao = {
  hoje: Date;
  agora: Date;
  children: number;
  infants: number;
  hospedes: number;
  hospedeId: string;
  hospedeCriado: boolean;
};

async function inserirReserva(
  actor: ActorContext,
  entrada: NovaReserva,
  ctx: ContextoDaCriacao,
): Promise<ReservaCriada> {
  return withTenant(
    { tenantId: actor.tenantId, userId: actor.userId },
    async (tx) => {
      const unidade = await carregarUnidadeParaReserva(
        tx,
        actor,
        entrada.unitId,
      );
      if (!unidade) throw new UnidadeNaoEncontrada();

      // Serializa as tentativas concorrentes na MESMA unidade (ADR-003).
      // Não é a garantia — é a constraint — mas evita que duas vendas
      // simultâneas façam todo o trabalho para uma delas morrer no commit.
      // `hashtextextended` dá o bigint estável que o advisory lock aceita.
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${entrada.unitId}::text, 0))
      `;

      const resultado = await cotarNaTransacao(tx, unidade, {
        checkIn: entrada.checkIn,
        checkOut: entrada.checkOut,
        hospedes: ctx.hospedes,
        hoje: ctx.hoje,
        agora: ctx.agora,
        ratePlanId: entrada.ratePlanId,
        extras: entrada.extras,
      });
      if (!resultado.ok) {
        throw new UnidadeNaoVendavel(resultado.recusa, resultado.recusas);
      }

      const cotacao = resultado.cotacao;
      // RN-003: o total do cliente nunca vira o total gravado. Ele só é
      // usado para decidir entre "grave" e "409 PRICE_CHANGED".
      if (
        entrada.totalConferidoCents != null &&
        !precoConfere(cotacao, entrada.totalConferidoCents)
      ) {
        throw new PrecoMudou(cotacao, entrada.totalConferidoCents);
      }

      const code = await gerarCodigoUnico(tx);

      const reserva = await tx.reservation.create({
        data: {
          code,
          propertyId: unidade.propertyId,
          unitId: unidade.id,
          primaryGuestId: ctx.hospedeId,
          ratePlanId: cotacao.ratePlanId,
          status: "PENDING",
          source: entrada.origem ?? "DIRECT",
          checkIn: entrada.checkIn,
          checkOut: entrada.checkOut,
          nights: cotacao.nights,
          adults: entrada.adults,
          children: ctx.children,
          infants: ctx.infants,
          currency: cotacao.currency,
          nightlyTotalCents: cotacao.nightlyTotalCents,
          feesTotalCents: cotacao.feesTotalCents,
          taxesTotalCents: cotacao.taxesTotalCents,
          discountsTotalCents: cotacao.discountsTotalCents,
          totalCents: cotacao.totalCents,
          // A conta feita HOJE, noite a noite. É o que responde ao hóspede
          // que questionar a cobrança meses depois, quando a tarifa
          // publicada já for outra (RN-003).
          quoteSnapshot: cotacao.snapshot as unknown as Prisma.InputJsonValue,
          // RN-004: a reserva segura a unidade por 30 minutos; passado o
          // prazo sem pagamento, o worker libera.
          holdExpiresAt: calcularHoldExpiresAt(ctx.agora),
          guestNotes: entrada.guestNotes ?? null,
          internalNotes: entrada.internalNotes ?? null,
          createdById: actor.userId,
        },
        select: {
          id: true,
          code: true,
          status: true,
          currency: true,
          totalCents: true,
          holdExpiresAt: true,
        },
      });

      await tx.reservationGuest.create({
        data: {
          reservationId: reserva.id,
          guestId: ctx.hospedeId,
          role: "PRIMARY",
          isPrimary: true,
        },
      });

      // O bloqueio é o que ocupa a unidade no livro-razão de disponibilidade
      // (ADR-005). Mesmo intervalo semiaberto da estadia: uma reserva que
      // termina dia 15 não impede outra que começa dia 15 (RN-001).
      await tx.availabilityBlock.create({
        data: {
          unitId: unidade.id,
          startDate: entrada.checkIn,
          endDate: entrada.checkOut,
          source: "RESERVATION",
          isBlocking: true,
          reservationId: reserva.id,
          createdById: actor.userId,
        },
      });

      await writeAudit(tx, {
        action: "reservation.created",
        entityType: "Reservation",
        entityId: reserva.id,
        actorUserId: actor.userId,
        after: {
          code: reserva.code,
          unidade: unidade.internalCode,
          unitId: unidade.id,
          // Sem nome, e-mail ou documento: a trilha é append-only e de
          // retenção longa, e o id do hóspede basta para reconstituir a
          // reserva (docs/11-seguranca-lgpd.md).
          guestId: ctx.hospedeId,
          de: toDateOnly(entrada.checkIn),
          ate: toDateOnly(entrada.checkOut),
          nights: cotacao.nights,
          hospedes: ctx.hospedes,
          ratePlanCode: cotacao.ratePlanCode,
          currency: cotacao.currency,
          totalCents: cotacao.totalCents,
          holdExpiresAt: reserva.holdExpiresAt,
        },
      });

      return {
        ...reserva,
        codigoFormatado: formatarCodigo(reserva.code),
        hospedeId: ctx.hospedeId,
        hospedeCriado: ctx.hospedeCriado,
        cotacao,
      };
    },
  );
}

// ── Confirmação (UC-050) ──────────────────────────────────────────────────

export type ResultadoTransicao = {
  /** A transição aconteceu AGORA, nesta chamada. */
  aplicada: boolean;
  /** A reserva já estava no estado pedido — nada a fazer, e não é erro. */
  jaEstava: boolean;
  code: string;
};

/**
 * Aplica PENDING → CONFIRMED e grava a trilha.
 *
 * A transição é o guarda de idempotência, não uma leitura prévia: o
 * `where` exige `status: PENDING`, então uma segunda chamada concorrente
 * (retry de webhook, dois cliques) espera a primeira, reavalia a condição
 * já com o status novo e afeta zero linhas. É esse `count` que diz se as
 * tarefas operacionais devem ser enfileiradas — sem ele, RN-008 dependeria
 * de sorte.
 */
async function aplicarConfirmacao(
  tx: TenantTx,
  p: {
    reservationId: string;
    agora: Date;
    actorUserId?: string;
    actorType?: ActorType;
    actorLabel?: string;
    motivo: string;
  },
): Promise<boolean> {
  const { count } = await tx.reservation.updateMany({
    where: { id: p.reservationId, status: "PENDING" },
    data: {
      status: "CONFIRMED",
      confirmedAt: p.agora,
      // O hold morre com a confirmação: manter a data faria o job de
      // expiração encarar uma reserva confirmada como candidata.
      holdExpiresAt: null,
    },
  });
  if (count === 0) return false;

  await writeAudit(tx, {
    action: "reservation.confirmed",
    entityType: "Reservation",
    entityId: p.reservationId,
    actorType: p.actorType,
    actorUserId: p.actorUserId,
    actorLabel: p.actorLabel,
    before: { status: "PENDING" },
    after: { status: "CONFIRMED", confirmedAt: p.agora, motivo: p.motivo },
  });
  return true;
}

/**
 * Confirmação feita por uma pessoa (venda fechada fora da plataforma,
 * cortesia, reserva de proprietário).
 *
 * Dispara as tarefas de check-in/check-out/limpeza DEPOIS do commit
 * (RN-008): enfileirar dentro da transação agendaria trabalho para algo
 * que ainda pode sofrer rollback, e o job leria a reserva ainda `PENDING`.
 */
export async function confirmarReserva(
  actor: ActorContext,
  reservationId: string,
  opts: { agora?: Date } = {},
): Promise<ResultadoTransicao> {
  await requirePermission(actor, "reservations.edit");
  const agora = opts.agora ?? new Date();

  const resultado = await withTenant(
    { tenantId: actor.tenantId, userId: actor.userId },
    async (tx) => {
      const reserva = await tx.reservation.findFirst({
        where: { id: reservationId, ...scopeFor(actor, "Reservation") },
        select: { id: true, code: true, status: true },
      });
      if (!reserva) throw new ReservaNaoEncontrada();
      if (reserva.status === "CONFIRMED") {
        return { aplicada: false, jaEstava: true, code: reserva.code };
      }

      assertTransicao(reserva.status, "CONFIRMED", "confirmar");

      const aplicada = await aplicarConfirmacao(tx, {
        reservationId: reserva.id,
        agora,
        actorUserId: actor.userId,
        motivo: "Confirmação manual do operador.",
      });
      return { aplicada, jaEstava: !aplicada, code: reserva.code };
    },
  );

  if (resultado.aplicada) {
    await agendarTarefasDaReserva(actor.tenantId, reservationId);
  }
  return resultado;
}

/**
 * Por que um pagamento baixado não confirmou a reserva.
 *
 * Um `boolean` mudo era o suficiente para a baixa manual (a tela só precisa
 * saber se mostra "quitada e confirmada"), mas escondia a diferença que o
 * webhook PRECISA enxergar: "ainda falta dinheiro" é rotina; "esta reserva
 * não aceita mais confirmação" significa que entrou dinheiro numa estadia
 * cancelada, cujas datas já voltaram ao calendário — alguém tem de decidir
 * entre reembolsar e reabrir a venda (RN-005/RN-010).
 */
export type MotivoDaNaoConfirmacao =
  /** A reserva não existe mais neste tenant. */
  | "reserva_inexistente"
  /** CANCELLED, NO_SHOW, ou já confirmada/hospedada/finalizada. */
  | "status_nao_confirmavel"
  /** Sinal parcial: segue PENDING até quitar. */
  | "saldo_pendente";

export type ConfirmacaoPorPagamento = {
  /** A transição PENDING → CONFIRMED aconteceu nesta chamada. */
  confirmou: boolean;
  motivo: "confirmada" | MotivoDaNaoConfirmacao;
  /** Status no momento da decisão; `null` quando a reserva não existe. */
  status: ReservationStatus | null;
  paidCents: number | null;
  totalCents: number | null;
};

/**
 * Confirmação disparada por um pagamento — chamada DENTRO da transação de
 * quem baixou o dinheiro (webhook do provedor ou baixa manual), logo
 * depois de `Reservation.paidCents` ser incrementado.
 *
 * Recebe o `tx` porque a decisão precisa enxergar o `paidCents` já
 * atualizado e desfazer junto se a transação do pagamento desfizer: uma
 * reserva confirmada por um pagamento que sofreu rollback seria uma venda
 * fantasma.
 *
 * Devolve o motivo, não só o resultado (ver `MotivoDaNaoConfirmacao`). Quando
 * `confirmou`, o chamador DEVE chamar
 * `agendarTarefasDaReserva(tenantId, reservationId)` depois do commit — as
 * tarefas não são enfileiradas aqui de propósito (ver `confirmarReserva`).
 */
export async function confirmarReservaPorPagamento(
  tx: TenantTx,
  p: {
    reservationId: string;
    paymentId: string;
    /** Preenchidos quando quem deu a baixa foi uma pessoa. */
    actorUserId?: string;
    actorType?: ActorType;
    agora?: Date;
  },
): Promise<ConfirmacaoPorPagamento> {
  const reserva = await tx.reservation.findFirst({
    where: { id: p.reservationId },
    select: { id: true, code: true, status: true, totalCents: true, paidCents: true },
  });
  if (!reserva) {
    // O pagamento aponta para uma reserva que não existe neste tenant.
    // Não lança: quem chama é o webhook, e um 500 aqui faria o provedor
    // reenviar para sempre um evento que nunca vai encaixar.
    logger.warn(
      { reservationId: p.reservationId, paymentId: p.paymentId },
      "Pagamento confirmado para reserva inexistente",
    );
    return {
      confirmou: false,
      motivo: "reserva_inexistente",
      status: null,
      paidCents: null,
      totalCents: null,
    };
  }

  const situacao = {
    status: reserva.status,
    paidCents: reserva.paidCents,
    totalCents: reserva.totalCents,
  };

  // Só PENDING confirma. Um evento atrasado não ressuscita reserva
  // cancelada nem "reconfirma" quem já fez check-in.
  if (reserva.status !== "PENDING") {
    return { confirmou: false, motivo: "status_nao_confirmavel", ...situacao };
  }

  // Sinal parcial mantém PENDING — e não corre risco de perder a unidade,
  // porque o job de expiração se recusa a expirar reserva com dinheiro
  // dentro (`avaliarHold`, src/worker/jobs/expirar-holds.ts).
  if (!quitada(reserva)) {
    return { confirmou: false, motivo: "saldo_pendente", ...situacao };
  }

  const confirmou = await aplicarConfirmacao(tx, {
    reservationId: reserva.id,
    agora: p.agora ?? new Date(),
    actorUserId: p.actorUserId,
    actorType: p.actorType ?? "WEBHOOK",
    actorLabel: `payment:${p.paymentId}`,
    motivo: "Pagamento confirmado (UC-050).",
  });

  return {
    confirmou,
    // `false` aqui só acontece se outra transação confirmou primeiro (retry
    // de webhook simultâneo): a reserva já não está PENDING.
    motivo: confirmou ? "confirmada" : "status_nao_confirmavel",
    ...situacao,
  };
}

/**
 * Enfileira as tarefas operacionais da reserva (RN-008).
 *
 * Best-effort em duas camadas. O `import` é DINÂMICO porque o módulo de
 * filas carrega o BullMQ na importação: um problema de dependência ou de
 * ambiente da fila derrubaria, senão, qualquer página que apenas
 * importasse este arquivo — inclusive a de criar reserva. E
 * `enfileirarTarefasDaReserva` já não propaga falha de Redis, porque uma
 * reserva paga não pode ser desfeita porque a fila caiu.
 *
 * O preço dessa tolerância é a tarefa não nascer quando a fila está fora.
 * A rede de segurança prevista é um job de reconciliação (varrer reservas
 * CONFIRMED sem `Task` com o `dedupeKey` esperado) — ainda não existe.
 */
export async function agendarTarefasDaReserva(
  tenantId: string,
  reservationId: string,
): Promise<boolean> {
  try {
    const { enfileirarTarefasDaReserva } = await import("@/lib/queue/filas");
    return await enfileirarTarefasDaReserva({ tenantId, reservationId });
  } catch (err) {
    logger.error(
      { tenantId, reservationId, err: (err as Error).message },
      "Não foi possível acessar a fila de reservas",
    );
    return false;
  }
}

// ── Cancelamento (RN-005) ─────────────────────────────────────────────────

/**
 * Cancela a reserva e devolve as datas ao calendário.
 *
 * A reserva NUNCA é apagada: vira `CANCELLED` com motivo e carimbo, e o
 * bloqueio ganha `releasedAt`. A constraint de exclusão só considera
 * bloqueios com `isBlocking AND releasedAt IS NULL`, então o carimbo
 * sozinho já libera a data — e preservar `isBlocking` mantém legível, no
 * histórico, que aquilo foi uma ocupação de verdade (é também o que o job
 * de expiração de holds faz).
 */
export async function cancelarReserva(
  actor: ActorContext,
  reservationId: string,
  motivo: string,
  opts: { agora?: Date } = {},
): Promise<ResultadoTransicao> {
  await requirePermission(actor, "reservations.delete");
  const agora = opts.agora ?? new Date();

  return withTenant(
    { tenantId: actor.tenantId, userId: actor.userId },
    async (tx) => {
      const reserva = await tx.reservation.findFirst({
        where: { id: reservationId, ...scopeFor(actor, "Reservation") },
        select: { id: true, code: true, status: true },
      });
      if (!reserva) throw new ReservaNaoEncontrada();
      if (reserva.status === "CANCELLED") {
        return { aplicada: false, jaEstava: true, code: reserva.code };
      }

      assertTransicao(reserva.status, "CANCELLED", "cancelar");

      const { count } = await tx.reservation.updateMany({
        where: { id: reserva.id, status: reserva.status },
        data: {
          status: "CANCELLED",
          cancelledAt: agora,
          cancellationReason: motivo,
          holdExpiresAt: null,
        },
      });
      // Perdeu a corrida para o job de expiração de holds ou para outro
      // operador: quem chegou primeiro já cancelou, e cancelar de novo só
      // sobrescreveria o motivo verdadeiro.
      if (count === 0) {
        return { aplicada: false, jaEstava: true, code: reserva.code };
      }

      // `releasedAt: null` no filtro impede sobrescrever um carimbo já
      // gravado — liberar duas vezes falsearia a hora da liberação.
      await tx.availabilityBlock.updateMany({
        where: { reservationId: reserva.id, releasedAt: null },
        data: { releasedAt: agora },
      });

      // A equipe não pode continuar vendo limpeza e check-in de uma
      // estadia que não vai acontecer. Tarefas já concluídas ficam como
      // estão: são registro do que foi feito.
      const { count: tarefasCanceladas } = await tx.task.updateMany({
        where: {
          reservationId: reserva.id,
          status: { in: ["OPEN", "IN_PROGRESS", "BLOCKED"] },
        },
        data: { status: "CANCELLED" },
      });

      await writeAudit(tx, {
        action: "reservation.cancelled",
        entityType: "Reservation",
        entityId: reserva.id,
        actorUserId: actor.userId,
        before: { status: reserva.status },
        after: {
          status: "CANCELLED",
          cancelledAt: agora,
          cancellationReason: motivo,
          tarefasCanceladas,
        },
      });

      return { aplicada: true, jaEstava: false, code: reserva.code };
    },
  );
}

// ── Check-in / check-out ──────────────────────────────────────────────────

async function registrarPassagem(
  actor: ActorContext,
  reservationId: string,
  destino: Extract<ReservationStatus, "CHECKED_IN" | "CHECKED_OUT">,
  agora: Date,
): Promise<ResultadoTransicao> {
  const acao = destino === "CHECKED_IN" ? "dar check-in em" : "dar check-out em";

  return withTenant(
    { tenantId: actor.tenantId, userId: actor.userId },
    async (tx) => {
      const reserva = await tx.reservation.findFirst({
        where: { id: reservationId, ...scopeFor(actor, "Reservation") },
        select: { id: true, code: true, status: true },
      });
      if (!reserva) throw new ReservaNaoEncontrada();
      if (reserva.status === destino) {
        return { aplicada: false, jaEstava: true, code: reserva.code };
      }

      assertTransicao(reserva.status, destino, acao);

      const { count } = await tx.reservation.updateMany({
        where: { id: reserva.id, status: reserva.status },
        data:
          destino === "CHECKED_IN"
            ? { status: destino, checkedInAt: agora }
            : { status: destino, checkedOutAt: agora },
      });
      if (count === 0) {
        return { aplicada: false, jaEstava: true, code: reserva.code };
      }

      await writeAudit(tx, {
        action:
          destino === "CHECKED_IN"
            ? "reservation.checked_in"
            : "reservation.checked_out",
        entityType: "Reservation",
        entityId: reserva.id,
        actorUserId: actor.userId,
        before: { status: reserva.status },
        after: { status: destino, em: agora },
      });

      return { aplicada: true, jaEstava: false, code: reserva.code };
    },
  );
}

/**
 * Chegada do hóspede. Não exige que hoje seja o dia do check-in: chegada
 * antecipada combinada e atraso de um dia são rotina, e travar isso faria
 * o operador registrar a estadia errada só para conseguir seguir.
 */
export async function registrarCheckIn(
  actor: ActorContext,
  reservationId: string,
  opts: { agora?: Date } = {},
): Promise<ResultadoTransicao> {
  await requirePermission(actor, "reservations.edit");
  return registrarPassagem(
    actor,
    reservationId,
    "CHECKED_IN",
    opts.agora ?? new Date(),
  );
}

/**
 * Saída do hóspede.
 *
 * O `AvailabilityBlock` NÃO é liberado: as noites já foram ocupadas, e
 * liberá-las abriria o passado para uma venda impossível — além de apagar
 * do calendário a ocupação que de fato existiu.
 */
export async function registrarCheckOut(
  actor: ActorContext,
  reservationId: string,
  opts: { agora?: Date } = {},
): Promise<ResultadoTransicao> {
  await requirePermission(actor, "reservations.edit");
  return registrarPassagem(
    actor,
    reservationId,
    "CHECKED_OUT",
    opts.agora ?? new Date(),
  );
}

// ── Pagamento manual (UC-050, provedor MANUAL) ───────────────────────────

export type PagamentoManual = {
  reservationId: string;
  /** Centavos inteiros, maior que zero (RN-006). */
  amountCents: number;
  method: PaymentMethod;
  intent?: PaymentIntentKind;
  description?: string | null;
  /** Quando o dinheiro entrou; por padrão, agora. */
  paidAt?: Date | null;
  /**
   * Parte variável da chave de idempotência da baixa. Passe um valor estável
   * vindo do formulário (um token por abertura de tela) e um duplo clique
   * vira uma recusa clara em vez de dois pagamentos.
   *
   * NÃO é a chave final: o servidor a prefixa com `manual:<reservationId>:`
   * (ver `chaveDaBaixaManual`). O namespace é do servidor de propósito — ver
   * a nota lá.
   */
  idempotencyKey?: string;
  agora?: Date;
};

export type PagamentoRegistrado = {
  paymentId: string;
  reservationId: string;
  code: string;
  paidCents: number;
  saldoCents: number;
  /** A baixa quitou a reserva e ela foi confirmada agora. */
  confirmou: boolean;
  /**
   * Quanto desta baixa abateu o total da estadia. Menor que o valor lançado
   * quando a intenção é caução ou extra — dinheiro que entrou, mas que não
   * paga a diária (ver `pagaAEstadia`).
   */
  abatimentoCents: number;
};

/**
 * Chave de idempotência da baixa manual — sempre montada pelo SERVIDOR.
 *
 * O namespace `manual:<reservationId>:` não é enfeite. A chave vem de um
 * `<input type="hidden">`, ou seja, de texto que o cliente escolhe; aceitá-la
 * como chave final deixava um usuário com `payments.create` gravar
 * `cobranca:<reservationId>:2` e ocupar uma chave do namespace da cobrança
 * por link — que calcula a tentativa contando os `Payment` com aquele
 * prefixo. O efeito medido: toda abertura de cobrança daquela reserva passava
 * a colidir na unique, e a reserva ficava permanentemente incobrável por
 * link, com uma mensagem que mente sobre a causa.
 *
 * Com o prefixo do servidor, o pior que a chave do cliente pode fazer é
 * colidir com outra baixa manual DA MESMA reserva — que é exatamente o que
 * ela deve fazer.
 */
function chaveDaBaixaManual(
  reservationId: string,
  doCliente: string | undefined,
  agora: Date,
): string {
  const parte = doCliente?.trim();
  return `manual:${reservationId}:${parte && parte.length > 0 ? parte : agora.toISOString()}`;
}

/**
 * Baixa manual: dinheiro, pix ou transferência combinados fora da
 * plataforma (UC-050, provedor `MANUAL`).
 *
 * O adapter de pagamento é consultado para obter a chave do provedor —
 * `createCheckout` não é chamado de propósito: ele é o caminho do provedor
 * HOSPEDADO, que devolve uma sessão e uma URL de redirect. Aqui não há
 * pagador para redirecionar nem sessão a criar; o adapter manual
 * devolveria `{ null, null }` e exigiria inventar `successUrl`/`cancelUrl`.
 * O que a baixa manual precisa do módulo de pagamentos é a identidade do
 * provedor e a disciplina do RN-009 — e nenhum campo aqui aceita dado de
 * cartão.
 */
export async function registrarPagamentoManual(
  actor: ActorContext,
  entrada: PagamentoManual,
): Promise<PagamentoRegistrado> {
  await requirePermission(actor, "payments.create");

  const agora = entrada.agora ?? new Date();
  if (!Number.isInteger(entrada.amountCents) || entrada.amountCents <= 0) {
    throw new PagamentoInvalido(
      "O valor do pagamento precisa ser maior que zero.",
    );
  }

  const provider = getProviderByKey("MANUAL");
  const intent = entrada.intent ?? "BALANCE";

  const resultado = await withTenant(
    { tenantId: actor.tenantId, userId: actor.userId },
    async (tx) => {
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
        },
      });
      if (!reserva) throw new ReservaNaoEncontrada();

      // Registrar dinheiro numa reserva que não vai acontecer é quase
      // sempre erro de digitação no id. Devolver é assunto de reembolso,
      // não de nova cobrança.
      if (reserva.status === "CANCELLED" || reserva.status === "NO_SHOW") {
        throw new PagamentoInvalido(
          "Não é possível registrar pagamento em uma reserva cancelada ou " +
            "marcada como no-show.",
        );
      }

      const saldo = saldoDevedorCents(reserva);
      // Sobra só é legítima em cobrança que não faz parte do total da
      // estadia (caução, extra). Nas demais, cobrar acima do saldo é
      // engano de digitação — e o estorno custa mais que a recusa.
      if (
        entrada.amountCents > saldo &&
        intent !== "SECURITY_DEPOSIT" &&
        intent !== "EXTRA"
      ) {
        throw new PagamentoInvalido(
          `O valor informado excede o saldo devedor da reserva ` +
            `(${(saldo / 100).toFixed(2)} ${reserva.currency}).`,
        );
      }

      const payment = await tx.payment.create({
        data: {
          reservationId: reserva.id,
          provider: provider.key,
          method: entrada.method,
          intent,
          // Baixa manual nasce já recebida: quem a lança é o operador que
          // viu o dinheiro entrar. Não há confirmação externa a esperar.
          status: "SUCCEEDED",
          amountCents: entrada.amountCents,
          currency: reserva.currency,
          description: entrada.description ?? null,
          idempotencyKey: chaveDaBaixaManual(
            reserva.id,
            entrada.idempotencyKey,
            agora,
          ),
          paidAt: entrada.paidAt ?? agora,
          createdById: actor.userId,
        },
        select: { id: true },
      });

      /**
       * Só o que paga a estadia entra em `paidCents` (RN-003/RN-006). Caução
       * e extra ficam no extrato como `Payment`, mas fora do total pago: são
       * a mesma exceção que autoriza o valor acima do saldo, logo acima, e
       * somá-los aqui quitaria a reserva com dinheiro que não é da diária.
       */
      const abatimentoCents = pagaAEstadia(intent) ? entrada.amountCents : 0;

      const atualizada =
        abatimentoCents > 0
          ? await tx.reservation.update({
              where: { id: reserva.id },
              data: { paidCents: { increment: abatimentoCents } },
              select: { paidCents: true, totalCents: true },
            })
          : { paidCents: reserva.paidCents, totalCents: reserva.totalCents };

      await writeAudit(tx, {
        action: "payment.recorded_manually",
        entityType: "Payment",
        entityId: payment.id,
        actorUserId: actor.userId,
        after: {
          reservationId: reserva.id,
          code: reserva.code,
          amountCents: entrada.amountCents,
          // A diferença entre os dois números é a caução/extra: a trilha
          // precisa mostrar por que a reserva não andou.
          abatimentoCents,
          currency: reserva.currency,
          method: entrada.method,
          intent,
          paidCents: atualizada.paidCents,
        },
      });

      const confirmacao = await confirmarReservaPorPagamento(tx, {
        reservationId: reserva.id,
        paymentId: payment.id,
        actorUserId: actor.userId,
        actorType: "USER",
        agora,
      });

      return {
        paymentId: payment.id,
        reservationId: reserva.id,
        code: reserva.code,
        paidCents: atualizada.paidCents,
        saldoCents: saldoDevedorCents(atualizada),
        confirmou: confirmacao.confirmou,
        abatimentoCents,
      };
    },
  ).catch((err: unknown) => {
    // A unique (tenantId, idempotencyKey) barrou: é o duplo clique que a
    // chave existe para barrar, não uma falha de sistema.
    if (ehPagamentoDuplicado(err)) {
      throw new PagamentoInvalido(
        "Este pagamento já foi registrado. Recarregue a reserva para ver a " +
          "baixa.",
      );
    }
    throw err;
  });

  if (resultado.confirmou) {
    await agendarTarefasDaReserva(actor.tenantId, resultado.reservationId);
  }
  return resultado;
}
