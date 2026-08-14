import type { ReservationStatus } from "@/generated/prisma/enums";
import { writeAudit } from "@/lib/audit/log";
import { platformPrisma } from "@/lib/db/platform-client";
import { withTenant, type TenantTx } from "@/lib/db/with-tenant";
import { logger } from "@/lib/logging/logger";

/**
 * RN-004 — uma reserva `PENDING` segura a unidade até `holdExpiresAt`
 * (30 min após a criação). Passado o prazo sem pagamento confirmado, este
 * job libera o `AvailabilityBlock` e encerra a reserva.
 *
 * O schema não tem `ReservationStatus.EXPIRED`; o estado terminal é
 * `CANCELLED` + `cancellationReason`, que é exatamente o que RN-005
 * descreve (libera a disponibilidade, preserva o histórico).
 */
export const MOTIVO_HOLD_EXPIRADO =
  "Hold expirado sem pagamento confirmado (RN-004).";

/**
 * Pagamento que impede a expiração. `SUCCEEDED` é o dinheiro que entrou;
 * `PROCESSING` é dinheiro em trânsito — liberar a unidade debaixo de uma
 * cobrança que ainda pode ser aprovada produziria overbooking com
 * aparência de bug do cliente.
 */
export const STATUS_DE_PAGAMENTO_QUE_SEGURA = [
  "SUCCEEDED",
  "PROCESSING",
] as const;

export type CandidataAExpirar = {
  status: ReservationStatus;
  holdExpiresAt: Date | null;
  paidCents: number;
  temPagamentoEmCurso: boolean;
};

export type DecisaoHold =
  | { expira: true }
  | {
      expira: false;
      motivo: "nao_pendente" | "sem_hold" | "hold_vigente" | "ja_pago";
    };

/**
 * Decide se um hold venceu. Função pura de propósito: é a regra que dá
 * errado em produção (reserva paga sumindo do calendário), e testá-la não
 * pode depender de Redis nem de Postgres no ar.
 *
 * O limite é inclusivo (`holdExpiresAt <= agora`) para casar com o `lte`
 * da consulta — divergir aqui deixaria reservas presas em PENDING para
 * sempre no minuto exato do vencimento.
 */
export function avaliarHold(
  reserva: CandidataAExpirar,
  agora: Date,
): DecisaoHold {
  if (reserva.status !== "PENDING") {
    return { expira: false, motivo: "nao_pendente" };
  }
  if (reserva.holdExpiresAt === null) {
    return { expira: false, motivo: "sem_hold" };
  }
  if (reserva.holdExpiresAt.getTime() > agora.getTime()) {
    return { expira: false, motivo: "hold_vigente" };
  }
  if (reserva.paidCents > 0 || reserva.temPagamentoEmCurso) {
    return { expira: false, motivo: "ja_pago" };
  }
  return { expira: true };
}

export type ResultadoExpiracao = { avaliadas: number; expiradas: number };

/**
 * Cancela UMA candidata, se ela ainda merecer isso no instante do UPDATE.
 *
 * A decisão de `avaliarHold` vem de um snapshot lido no começo da varredura,
 * e uma varredura de dezenas de holds leva o suficiente para o mundo mudar no
 * meio: um sinal registrado pelo operador entre a leitura e o UPDATE deixava
 * a reserva ser cancelada com dinheiro dentro, com motivo falso na trilha e a
 * data devolvida ao mercado (medido: `paidCents: 50000`, `status: CANCELLED`).
 *
 * Por isso o guard inteiro é REAVALIADO aqui, dentro do `where` — o único
 * ponto que o Postgres reexecuta sob concorrência. `avaliarHold` continua
 * sendo a regra pura e testável, mas deixa de ser a última palavra.
 *
 * Devolve se a reserva foi cancelada agora.
 */
export async function cancelarHoldVencido(
  tx: TenantTx,
  reserva: { id: string; code: string; holdExpiresAt: Date | null },
  agora: Date,
): Promise<boolean> {
  const { count } = await tx.reservation.updateMany({
    where: {
      id: reserva.id,
      status: "PENDING",
      // Releitura das MESMAS condições de `avaliarHold`, agora sob o lock da
      // linha: hold vencido, sem dinheiro dentro e sem cobrança em curso.
      holdExpiresAt: { lte: agora },
      paidCents: 0,
      payments: {
        none: { status: { in: [...STATUS_DE_PAGAMENTO_QUE_SEGURA] } },
      },
    },
    data: {
      status: "CANCELLED",
      cancelledAt: agora,
      cancellationReason: MOTIVO_HOLD_EXPIRADO,
    },
  });
  if (count === 0) return false;

  // O guard `releasedAt: null` impede sobrescrever um carimbo já
  // gravado — liberar duas vezes falsearia a hora da liberação.
  await tx.availabilityBlock.updateMany({
    where: { reservationId: reserva.id, releasedAt: null },
    data: { releasedAt: agora },
  });

  await writeAudit(tx, {
    action: "reservation.hold_expired",
    entityType: "Reservation",
    entityId: reserva.id,
    actorType: "JOB",
    actorLabel: "worker:expirar-holds",
    before: { status: "PENDING", holdExpiresAt: reserva.holdExpiresAt },
    after: { status: "CANCELLED", cancellationReason: MOTIVO_HOLD_EXPIRADO },
  });

  return true;
}

/**
 * Expira os holds vencidos de um tenant.
 *
 * O worker roda fora de requisição, então não há tenant na sessão: o
 * `AsyncLocalStorage` está vazio e qualquer acesso a modelo tenant-scoped
 * pelo client da aplicação lança `MissingTenantContextError` (e, mesmo que
 * não lançasse, o RLS negaria tudo por ser fail-closed). Por isso cada
 * tenant é processado dentro do próprio `withTenant` — nunca uma consulta
 * transversal.
 */
export async function expirarHoldsDoTenant(
  tenantId: string,
  agora = new Date(),
): Promise<ResultadoExpiracao> {
  return withTenant({ tenantId }, async (tx) => {
    const candidatas = await tx.reservation.findMany({
      where: { status: "PENDING", holdExpiresAt: { lte: agora } },
      select: {
        id: true,
        code: true,
        unitId: true,
        status: true,
        holdExpiresAt: true,
        paidCents: true,
        payments: {
          where: { status: { in: [...STATUS_DE_PAGAMENTO_QUE_SEGURA] } },
          select: { id: true },
          take: 1,
        },
      },
    });

    let expiradas = 0;

    for (const reserva of candidatas) {
      const decisao = avaliarHold(
        {
          status: reserva.status,
          holdExpiresAt: reserva.holdExpiresAt,
          paidCents: reserva.paidCents,
          temPagamentoEmCurso: reserva.payments.length > 0,
        },
        agora,
      );

      if (!decisao.expira) continue;

      // Idempotência por update condicional, não por ler-e-depois-escrever:
      // duas execuções no mesmo minuto disputam a mesma linha e só uma vê
      // `status: PENDING`. `false` significa que a outra já tratou — ou que
      // a reserva deixou de merecer a expiração desde a leitura.
      const cancelou = await cancelarHoldVencido(tx, reserva, agora);
      if (!cancelou) continue;

      expiradas += 1;
      logger.info(
        { tenantId, reservationId: reserva.id, code: reserva.code },
        "Hold expirado — unidade liberada",
      );
    }

    return { avaliadas: candidatas.length, expiradas };
  });
}

/**
 * Varre todos os tenants ativos.
 *
 * `Tenant` não é tenant-scoped (não tem RLS nem entra na extensão), e
 * "quais tenants existem" é pergunta anterior a haver tenant ativo — o
 * mesmo caso da resolução de memberships no login. Daí o `platformPrisma`.
 */
export async function expirarHolds(agora = new Date()): Promise<ResultadoExpiracao> {
  const tenants = await platformPrisma.tenant.findMany({
    where: { deletedAt: null, status: { in: ["TRIAL", "ACTIVE"] } },
    select: { id: true },
  });

  const total: ResultadoExpiracao = { avaliadas: 0, expiradas: 0 };

  for (const { id: tenantId } of tenants) {
    // Um tenant com dado inconsistente não pode abortar a varredura dos
    // outros — o job é global, a falha é local.
    try {
      const parcial = await expirarHoldsDoTenant(tenantId, agora);
      total.avaliadas += parcial.avaliadas;
      total.expiradas += parcial.expiradas;
    } catch (err) {
      logger.error(
        { tenantId, err: (err as Error).message },
        "Falha ao expirar holds do tenant",
      );
    }
  }

  return total;
}
