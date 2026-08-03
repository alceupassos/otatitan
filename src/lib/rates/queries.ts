import "server-only";
import { withTenant } from "@/lib/db/with-tenant";
import { diasNoIntervalo, toDateOnly } from "@/lib/dates";
import { scopeFor, type ActorContext } from "@/lib/rbac/guard";

/**
 * Leituras de tarifas.
 *
 * A pergunta que importa não é "quais tarifas existem" e sim "quais
 * noites estão vendáveis": pela RN-011, noite sem `DailyRate` é
 * indisponível. Por isso as consultas aqui sempre reportam COBERTURA, não
 * só a lista de preços.
 */

export type UnidadeComTarifa = {
  unitId: string;
  unitName: string;
  internalCode: string;
  propertyId: string;
  propertyName: string;
  baseRateCents: number | null;
  currency: string;
  planoPadrao: { id: string; name: string; code: string } | null;
  totalPlanos: number;
  /** Noites com tarifa publicada nos próximos 90 dias. */
  diasCobertos: number;
  /** Primeira data, a partir de hoje, SEM tarifa publicada. */
  primeiraLacuna: string | null;
};

const JANELA_COBERTURA_DIAS = 90;

export async function listUnidadesComTarifa(
  actor: ActorContext,
  hoje: Date,
): Promise<UnidadeComTarifa[]> {
  const fim = new Date(hoje.getTime() + JANELA_COBERTURA_DIAS * 86_400_000);

  return withTenant(
    { tenantId: actor.tenantId, userId: actor.userId },
    async (tx) => {
      const units = await tx.unit.findMany({
        where: {
          status: { not: "ARCHIVED" },
          property: { status: { not: "ARCHIVED" }, ...scopeFor(actor, "Property") },
        },
        select: {
          id: true,
          name: true,
          internalCode: true,
          propertyId: true,
          baseRateCents: true,
          currency: true,
          property: { select: { name: true } },
          ratePlans: {
            where: { status: { not: "ARCHIVED" } },
            select: { id: true, name: true, code: true, isDefault: true, status: true },
          },
        },
        orderBy: [{ property: { name: "asc" } }, { internalCode: "asc" }],
      });

      if (units.length === 0) return [];

      // Uma consulta para todas as unidades, em vez de N+1: a cobertura é
      // só a contagem de datas distintas com tarifa na janela.
      const tarifas = await tx.dailyRate.findMany({
        where: {
          unitId: { in: units.map((u) => u.id) },
          date: { gte: hoje, lt: fim },
          isClosed: false,
        },
        select: { unitId: true, date: true },
      });

      const porUnidade = new Map<string, Set<string>>();
      for (const t of tarifas) {
        const chave = toDateOnly(t.date);
        const conjunto = porUnidade.get(t.unitId) ?? new Set<string>();
        conjunto.add(chave);
        porUnidade.set(t.unitId, conjunto);
      }

      const janela = diasNoIntervalo(hoje, fim).map(toDateOnly);

      return units.map((u) => {
        const cobertos = porUnidade.get(u.id) ?? new Set<string>();
        const padrao = u.ratePlans.find((p) => p.isDefault && p.status === "ACTIVE");
        return {
          unitId: u.id,
          unitName: u.name,
          internalCode: u.internalCode,
          propertyId: u.propertyId,
          propertyName: u.property.name,
          baseRateCents: u.baseRateCents,
          currency: u.currency,
          planoPadrao: padrao
            ? { id: padrao.id, name: padrao.name, code: padrao.code }
            : null,
          totalPlanos: u.ratePlans.length,
          diasCobertos: cobertos.size,
          primeiraLacuna: janela.find((d) => !cobertos.has(d)) ?? null,
        };
      });
    },
  );
}

export async function getUnidadeTarifas(
  actor: ActorContext,
  unitId: string,
  inicio: Date,
  fim: Date,
) {
  return withTenant(
    { tenantId: actor.tenantId, userId: actor.userId },
    async (tx) => {
      const unit = await tx.unit.findFirst({
        where: {
          id: unitId,
          property: scopeFor(actor, "Property"),
        },
        select: {
          id: true,
          name: true,
          internalCode: true,
          baseRateCents: true,
          cleaningFeeCents: true,
          currency: true,
          minNights: true,
          maxNights: true,
          propertyId: true,
          property: { select: { id: true, name: true } },
        },
      });
      if (!unit) return null;

      const planos = await tx.ratePlan.findMany({
        where: { unitId },
        select: {
          id: true,
          code: true,
          name: true,
          status: true,
          isDefault: true,
          currency: true,
          minNights: true,
          maxNights: true,
          minAdvanceDays: true,
          maxAdvanceDays: true,
          includesCleaningFee: true,
          cancellationPolicy: true,
          _count: { select: { dailyRates: true } },
        },
        orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      });

      const tarifas = await tx.dailyRate.findMany({
        where: { unitId, date: { gte: inicio, lt: fim } },
        select: {
          id: true,
          ratePlanId: true,
          date: true,
          priceCents: true,
          minNights: true,
          isClosed: true,
          closedToArrival: true,
          closedToDeparture: true,
          source: true,
        },
        orderBy: { date: "asc" },
      });

      return { unit, planos, tarifas };
    },
  );
}
