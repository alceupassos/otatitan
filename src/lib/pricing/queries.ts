import "server-only";
import { withTenant, type TenantTx } from "@/lib/db/with-tenant";
import { hojeUtc } from "@/lib/dates";
import { scopeFor, type ActorContext } from "@/lib/rbac/guard";
import { cotar, type ExtrasCotacao, type PlanoCotavel, type ResultadoCotacao, type TarifaCotavel } from "./quote";

/**
 * Leitura dos insumos da cotação.
 *
 * O cálculo mora em `quote.ts` e é puro; aqui só se carrega o que ele
 * precisa. Essa separação é o que mantém o motor testável sem banco — e
 * ela só se sustenta se nenhuma regra de preço vazar para este arquivo.
 */

export type InsumosCotacao = {
  planos: PlanoCotavel[];
  tarifas: TarifaCotavel[];
};

/**
 * Planos ativos e tarifas das noites `[checkIn, checkOut)` de várias
 * unidades, em duas consultas.
 *
 * A busca de disponibilidade varre a carteira inteira: carregar plano e
 * tarifa unidade a unidade seria N+1 num caminho que o hóspede espera em
 * tempo real. Exportada para a busca reusar em vez de duplicar.
 */
export async function carregarInsumosCotacao(
  tx: TenantTx,
  unitIds: string[],
  checkIn: Date,
  checkOut: Date,
): Promise<Map<string, InsumosCotacao>> {
  const porUnidade = new Map<string, InsumosCotacao>();
  for (const id of unitIds) porUnidade.set(id, { planos: [], tarifas: [] });
  if (unitIds.length === 0) return porUnidade;

  const planos = await tx.ratePlan.findMany({
    where: { unitId: { in: unitIds }, status: "ACTIVE" },
    select: {
      id: true,
      unitId: true,
      code: true,
      name: true,
      currency: true,
      status: true,
      isDefault: true,
      priority: true,
      minNights: true,
      maxNights: true,
      minAdvanceDays: true,
      maxAdvanceDays: true,
      includesCleaningFee: true,
      cancellationPolicy: true,
      validFrom: true,
      validTo: true,
    },
  });

  // Só as noites da estadia: o dia do check-out não é vendido (RN-001),
  // por isso `lt` e não `lte`.
  const tarifas = await tx.dailyRate.findMany({
    where: {
      unitId: { in: unitIds },
      date: { gte: checkIn, lt: checkOut },
      ratePlanId: { in: planos.map((p) => p.id) },
    },
    select: {
      unitId: true,
      ratePlanId: true,
      date: true,
      priceCents: true,
      currency: true,
      minNights: true,
      isClosed: true,
      closedToArrival: true,
      closedToDeparture: true,
    },
  });

  for (const p of planos) {
    const { unitId, ...plano } = p;
    porUnidade.get(unitId)?.planos.push(plano);
  }
  for (const t of tarifas) {
    const { unitId, ...tarifa } = t;
    porUnidade.get(unitId)?.tarifas.push(tarifa);
  }

  return porUnidade;
}

export type PedidoCotacao = {
  unitId: string;
  checkIn: Date;
  checkOut: Date;
  hospedes: number;
  /** Injetável para teste; por padrão, hoje em UTC. */
  hoje?: Date;
  ratePlanId?: string;
  extras?: ExtrasCotacao;
};

export type CotacaoDeUnidade = {
  unitId: string;
  unitName: string;
  internalCode: string;
  propertyId: string;
  propertyName: string;
  maxGuests: number;
  resultado: ResultadoCotacao;
};

/**
 * Cota uma unidade (UC-030 / passo 2 do UC-040).
 *
 * Devolve `null` quando a unidade não existe OU está fora do escopo do
 * ator — os dois casos respondem igual de propósito, para não confirmar a
 * existência de um id de outro tenant.
 */
export async function cotarUnidade(
  actor: ActorContext,
  pedido: PedidoCotacao,
): Promise<CotacaoDeUnidade | null> {
  const hoje = pedido.hoje ?? hojeUtc();

  return withTenant(
    { tenantId: actor.tenantId, userId: actor.userId },
    async (tx) => {
      const unit = await tx.unit.findFirst({
        where: {
          id: pedido.unitId,
          property: { ...scopeFor(actor, "Property") },
        },
        select: {
          id: true,
          name: true,
          internalCode: true,
          propertyId: true,
          maxGuests: true,
          minNights: true,
          maxNights: true,
          cleaningFeeCents: true,
          currency: true,
          property: { select: { name: true } },
        },
      });
      if (!unit) return null;

      const insumos = await carregarInsumosCotacao(
        tx,
        [unit.id],
        pedido.checkIn,
        pedido.checkOut,
      );
      const { planos, tarifas } = insumos.get(unit.id)!;

      return {
        unitId: unit.id,
        unitName: unit.name,
        internalCode: unit.internalCode,
        propertyId: unit.propertyId,
        propertyName: unit.property.name,
        maxGuests: unit.maxGuests,
        resultado: cotar({
          unit: {
            id: unit.id,
            maxGuests: unit.maxGuests,
            minNights: unit.minNights,
            maxNights: unit.maxNights,
            cleaningFeeCents: unit.cleaningFeeCents,
            currency: unit.currency,
          },
          planos,
          tarifas,
          checkIn: pedido.checkIn,
          checkOut: pedido.checkOut,
          hospedes: pedido.hospedes,
          hoje,
          ratePlanId: pedido.ratePlanId,
          extras: pedido.extras,
        }),
      };
    },
  );
}
