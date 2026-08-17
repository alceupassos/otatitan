import "server-only";
import { withTenant } from "@/lib/db/with-tenant";
import { diasNoIntervalo, toDateOnly } from "@/lib/dates";
import { scopeFor, type ActorContext } from "@/lib/rbac/guard";

/**
 * Dados do calendário de ocupação.
 *
 * A fonte é `AvailabilityBlock`, o livro-razão único (ADR-005): reserva e
 * bloqueio manual moram na mesma tabela, então uma consulta responde a
 * ocupação inteira, sem combinar duas listas com risco de divergir.
 */

export type OcupacaoDia = {
  /** `YYYY-MM-DD` */
  data: string;
  blockId: string;
  origem: "RESERVATION" | "MANUAL" | "MAINTENANCE" | "OWNER_STAY" | "CHANNEL_SYNC";
  motivo: string | null;
  /** Preenchido quando a ocupação vem de uma reserva. */
  reserva: { id: string; code: string; hospede: string } | null;
  /** Primeira noite deste bloqueio (para desenhar a borda esquerda). */
  ehInicio: boolean;
  /** Última noite deste bloqueio. */
  ehFim: boolean;
};

export type LinhaCalendario = {
  unitId: string;
  unitName: string;
  internalCode: string;
  propertyId: string;
  propertyName: string;
  /** Ocupação por data (`YYYY-MM-DD` → dia ocupado). */
  ocupacao: Map<string, OcupacaoDia>;
  /** Noites da janela SEM `DailyRate` aberta (RN-011 — não vendem). */
  semTarifa: Set<string>;
};

export async function getCalendario(
  actor: ActorContext,
  inicio: Date,
  fim: Date,
): Promise<LinhaCalendario[]> {
  return withTenant(
    { tenantId: actor.tenantId, userId: actor.userId },
    async (tx) => {
      const units = await tx.unit.findMany({
        where: {
          status: { in: ["ACTIVE", "DRAFT", "INACTIVE"] },
          property: {
            status: { not: "ARCHIVED" },
            ...scopeFor(actor, "Property"),
          },
        },
        select: {
          id: true,
          name: true,
          internalCode: true,
          propertyId: true,
          property: { select: { name: true } },
        },
        orderBy: [{ property: { name: "asc" } }, { internalCode: "asc" }],
      });

      if (units.length === 0) return [];

      const blocos = await tx.availabilityBlock.findMany({
        where: {
          unitId: { in: units.map((u) => u.id) },
          isBlocking: true,
          releasedAt: null,
          // Sobreposição com a janela: começa antes do fim E termina
          // depois do início (intervalos semiabertos).
          startDate: { lt: fim },
          endDate: { gt: inicio },
        },
        select: {
          id: true,
          unitId: true,
          startDate: true,
          endDate: true,
          source: true,
          reason: true,
          reservation: {
            select: {
              id: true,
              code: true,
              primaryGuest: { select: { firstName: true, lastName: true } },
            },
          },
        },
      });

      const porUnidade = new Map<string, Map<string, OcupacaoDia>>();
      for (const u of units) porUnidade.set(u.id, new Map());

      for (const b of blocos) {
        const mapa = porUnidade.get(b.unitId);
        if (!mapa) continue;

        const dias = diasNoIntervalo(b.startDate, b.endDate);
        for (const [i, dia] of dias.entries()) {
          const chave = toDateOnly(dia);
          // Fora da janela exibida: o bloco pode começar antes e acabar
          // depois, e só interessa o pedaço visível.
          if (dia < inicio || dia >= fim) continue;

          mapa.set(chave, {
            data: chave,
            blockId: b.id,
            origem: b.source,
            motivo: b.reason,
            reserva: b.reservation
              ? {
                  id: b.reservation.id,
                  code: b.reservation.code,
                  hospede: `${b.reservation.primaryGuest.firstName} ${b.reservation.primaryGuest.lastName}`,
                }
              : null,
            ehInicio: i === 0,
            ehFim: i === dias.length - 1,
          });
        }
      }

      const tarifas = await tx.dailyRate.findMany({
        where: {
          unitId: { in: units.map((u) => u.id) },
          date: { gte: inicio, lt: fim },
          isClosed: false,
          ratePlan: { status: "ACTIVE" },
        },
        select: { unitId: true, date: true },
      });
      const cobertos = new Map<string, Set<string>>();
      for (const u of units) cobertos.set(u.id, new Set());
      for (const t of tarifas) {
        cobertos.get(t.unitId)?.add(toDateOnly(t.date));
      }
      const janela = diasNoIntervalo(inicio, fim).map(toDateOnly);

      return units.map((u) => {
        const comTarifa = cobertos.get(u.id) ?? new Set();
        const semTarifa = new Set(janela.filter((d) => !comTarifa.has(d)));
        return {
          unitId: u.id,
          unitName: u.name,
          internalCode: u.internalCode,
          propertyId: u.propertyId,
          propertyName: u.property.name,
          ocupacao: porUnidade.get(u.id)!,
          semTarifa,
        };
      });
    },
  );
}

/** Unidades disponíveis para o seletor do formulário de bloqueio. */
export async function listUnitsParaBloqueio(actor: ActorContext) {
  return withTenant({ tenantId: actor.tenantId, userId: actor.userId }, (tx) =>
    tx.unit.findMany({
      where: {
        status: { not: "ARCHIVED" },
        property: { status: { not: "ARCHIVED" }, ...scopeFor(actor, "Property") },
      },
      select: {
        id: true,
        name: true,
        internalCode: true,
        property: { select: { name: true } },
      },
      orderBy: [{ property: { name: "asc" } }, { internalCode: "asc" }],
    }),
  );
}

export type ResumoOcupacaoUnidade = {
  unitId: string;
  internalCode: string;
  propertyName: string;
  noites: number;
  ocupadas: number;
  semTarifa: number;
  vendaveis: number;
};

/**
 * Visão compacta: nas próximas N noites, o que está ocupado, o que está
 * sem diária (não vende) e o que de fato pode ser vendido.
 */
export async function getResumoOcupacao(
  actor: ActorContext,
  inicio: Date,
  fim: Date,
): Promise<ResumoOcupacaoUnidade[]> {
  const linhas = await getCalendario(actor, inicio, fim);
  const noites = diasNoIntervalo(inicio, fim).map(toDateOnly);
  return linhas.map((l) => {
    let ocupadas = 0;
    let semTarifa = 0;
    let vendaveis = 0;
    for (const d of noites) {
      if (l.ocupacao.has(d)) ocupadas++;
      else if (l.semTarifa.has(d)) semTarifa++;
      else vendaveis++;
    }
    return {
      unitId: l.unitId,
      internalCode: l.internalCode,
      propertyName: l.propertyName,
      noites: noites.length,
      ocupadas,
      semTarifa,
      vendaveis,
    };
  });
}
