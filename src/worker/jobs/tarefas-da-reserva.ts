import { fromZonedTime } from "date-fns-tz";
import type { TaskPriority, TaskType } from "@/generated/prisma/enums";
import { writeAudit } from "@/lib/audit/log";
import { toDateOnly } from "@/lib/dates";
import { withTenant } from "@/lib/db/with-tenant";
import { logger } from "@/lib/logging/logger";

/**
 * RN-008 — uma reserva confirmada gera as tarefas de check-in, check-out e
 * limpeza UMA ÚNICA VEZ. Webhook de pagamento é retriado pelo provedor,
 * então a idempotência não é otimização: sem ela, cada retry criaria outra
 * limpeza na agenda da equipe.
 */

export const TIPOS_DA_RESERVA = ["CHECK_IN", "CHECK_OUT", "CLEANING"] as const;
export type TipoDaReserva = (typeof TIPOS_DA_RESERVA)[number];

/** Só reserva já confirmada gera tarefa — reprocessar um webhook antigo não
 *  pode ressuscitar a operação de uma reserva cancelada. */
const STATUS_QUE_GERAM_TAREFA = [
  "CONFIRMED",
  "CHECKED_IN",
  "CHECKED_OUT",
] as const;

/**
 * Chave de deduplicação gravada em `Task.dedupeKey`, protegida pela unique
 * `(tenantId, dedupeKey)`. Determinística por reserva + tipo: é ela que
 * transforma "criar as tarefas" numa operação que pode rodar N vezes.
 */
export function montarDedupeKey(
  reservationId: string,
  tipo: TipoDaReserva,
): string {
  return `reservation:${reservationId}:${tipo}`;
}

export type ContextoDaEstadia = {
  /** Dia de calendário do check-in (DATE puro, meia-noite UTC). */
  checkIn: Date;
  /** Dia de calendário do check-out, fim exclusivo da estadia. */
  checkOut: Date;
  /** `HH:MM` no fuso do imóvel. */
  checkInTime: string;
  checkOutTime: string;
  /** IANA, ex.: `America/Sao_Paulo`. */
  timezone: string;
};

/**
 * Instante em que a tarefa vence.
 *
 * A estadia é DATE pura (RN-007) e a hora de chegada/saída é do imóvel,
 * não do servidor — juntar as duas coisas em UTC é o único jeito de o
 * `dueAt` (timestamptz) apontar para o momento certo. Fazer isso com a
 * hora local do processo produziria tarefas com 3 horas de diferença
 * dependendo de onde o worker roda.
 *
 * Limpeza vence junto com o check-out: a equipe entra quando o hóspede sai.
 */
export function calcularDueAt(
  tipo: TipoDaReserva,
  ctx: ContextoDaEstadia,
): Date {
  const [dia, hora] =
    tipo === "CHECK_IN"
      ? [ctx.checkIn, ctx.checkInTime]
      : [ctx.checkOut, ctx.checkOutTime];

  return fromZonedTime(`${toDateOnly(dia)}T${hora}:00`, ctx.timezone);
}

const PERFIL_DA_TAREFA: Record<
  TipoDaReserva,
  { type: TaskType; priority: TaskPriority; roleSlug: string; rotulo: string }
> = {
  CHECK_IN: {
    type: "CHECK_IN",
    priority: "NORMAL",
    roleSlug: "operations_coordinator",
    rotulo: "Check-in",
  },
  CHECK_OUT: {
    type: "CHECK_OUT",
    priority: "NORMAL",
    roleSlug: "operations_coordinator",
    rotulo: "Check-out",
  },
  CLEANING: {
    type: "CLEANING",
    priority: "HIGH",
    roleSlug: "cleaning_staff",
    rotulo: "Limpeza pós check-out",
  },
};

export type ResultadoTarefas = { criadas: number; ignorada?: string };

/**
 * Cria as tarefas operacionais da reserva. Idempotente: reexecutar não
 * duplica nada.
 *
 * O worker roda fora de requisição, sem tenant na sessão — o `tenantId`
 * vem do payload do job e todo o acesso acontece dentro do `withTenant`
 * dele, nunca uma consulta transversal.
 */
export async function criarTarefasDaReserva(
  tenantId: string,
  reservationId: string,
): Promise<ResultadoTarefas> {
  return withTenant({ tenantId }, async (tx) => {
    const reserva = await tx.reservation.findFirst({
      where: { id: reservationId },
      select: {
        id: true,
        code: true,
        status: true,
        checkIn: true,
        checkOut: true,
        propertyId: true,
        unitId: true,
        primaryGuest: { select: { firstName: true, lastName: true } },
        unit: { select: { internalCode: true } },
        property: {
          select: { timezone: true, checkInTime: true, checkOutTime: true },
        },
      },
    });

    if (!reserva) return { criadas: 0, ignorada: "reserva_nao_encontrada" };

    if (
      !STATUS_QUE_GERAM_TAREFA.includes(
        reserva.status as (typeof STATUS_QUE_GERAM_TAREFA)[number],
      )
    ) {
      return { criadas: 0, ignorada: "status_nao_confirmado" };
    }

    const ctx: ContextoDaEstadia = {
      checkIn: reserva.checkIn,
      checkOut: reserva.checkOut,
      checkInTime: reserva.property.checkInTime,
      checkOutTime: reserva.property.checkOutTime,
      timezone: reserva.property.timezone,
    };

    const hospede =
      `${reserva.primaryGuest.firstName} ${reserva.primaryGuest.lastName}`.trim();
    const unidade = reserva.unit.internalCode;

    // `skipDuplicates` vira ON CONFLICT DO NOTHING sobre a unique
    // (tenantId, dedupeKey): a idempotência é do banco, não de um
    // "verifica se já existe" que perderia a corrida com um retry
    // simultâneo do webhook.
    const { count } = await tx.task.createMany({
      data: TIPOS_DA_RESERVA.map((tipo) => {
        const perfil = PERFIL_DA_TAREFA[tipo];
        return {
          type: perfil.type,
          title: `${perfil.rotulo} — ${unidade} · ${hospede} (${reserva.code})`,
          dueAt: calcularDueAt(tipo, ctx),
          priority: perfil.priority,
          propertyId: reserva.propertyId,
          unitId: reserva.unitId,
          reservationId: reserva.id,
          assignedRoleSlug: perfil.roleSlug,
          dedupeKey: montarDedupeKey(reserva.id, tipo),
          createdBySystem: true,
        };
      }),
      skipDuplicates: true,
    });

    if (count > 0) {
      await writeAudit(tx, {
        action: "reservation.tasks_created",
        entityType: "Reservation",
        entityId: reserva.id,
        actorType: "JOB",
        actorLabel: "worker:tarefas-da-reserva",
        after: { criadas: count, tipos: TIPOS_DA_RESERVA },
      });

      logger.info(
        { tenantId, reservationId: reserva.id, criadas: count },
        "Tarefas da reserva criadas",
      );
    }

    return { criadas: count };
  });
}
