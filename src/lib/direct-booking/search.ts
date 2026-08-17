import "server-only";
import { diasNoIntervalo, diffDias, toDateOnly } from "@/lib/dates";
import { withTenant } from "@/lib/db/with-tenant";
import { carregarInsumosCotacao } from "@/lib/pricing/queries";
import { cotarTodosPlanos, type ExtrasCotacao } from "@/lib/pricing/quote";
import { MADRE914 } from "./config";
import { atorCanalDireto } from "./actor";
import { resolverCanalDireto } from "./tenant";
import type { DiaCalendarioPublico, ResultadoPublico } from "./types";

export type {
  DiaCalendarioPublico,
  ResultadoPublico,
  UnidadePublicaRecusada,
  UnidadePublicaVendavel,
} from "./types";

export function extrasDoPedido(pedido: {
  pets: number;
  parking: boolean;
  hospedes: number;
}): ExtrasCotacao {
  return {
    includedGuests: MADRE914.includedGuests,
    extraGuestCentsPerNight: MADRE914.extraGuestCentsPerNight,
    pets: pedido.pets,
    petFeeCents: MADRE914.petFeeCents,
    parking: pedido.parking,
    parkingFeeCents: MADRE914.parkingFeeCents,
  };
}

/**
 * Disponibilidade do canal direto: só o imóvel configurado, todos os
 * planos vendáveis lado a lado, extras do site ao vivo aplicados no
 * servidor. Sem ator logado.
 */
export async function buscarDisponibilidadePublica(pedido: {
  checkIn: Date;
  checkOut: Date;
  hospedes: number;
  pets: number;
  parking: boolean;
  hoje?: Date;
}): Promise<ResultadoPublico> {
  const canal = await resolverCanalDireto();
  const actor = atorCanalDireto(canal.tenantId);
  const hoje = pedido.hoje ?? new Date(
    Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      new Date().getUTCDate(),
    ),
  );
  const extras = extrasDoPedido(pedido);

  return withTenant({ tenantId: canal.tenantId, userId: actor.userId }, async (tx) => {
    const units = await tx.unit.findMany({
      where: {
        propertyId: canal.propertyId,
        status: "ACTIVE",
        property: { status: "ACTIVE" },
      },
      select: {
        id: true,
        name: true,
        internalCode: true,
        maxGuests: true,
        minNights: true,
        maxNights: true,
        cleaningFeeCents: true,
        currency: true,
      },
      orderBy: { internalCode: "asc" },
    });

    const cabecalho = {
      checkIn: toDateOnly(pedido.checkIn),
      checkOut: toDateOnly(pedido.checkOut),
      nights: diffDias(pedido.checkIn, pedido.checkOut),
      hospedes: pedido.hospedes,
      pets: pedido.pets,
      parking: pedido.parking,
    };

    const vazio: ResultadoPublico = {
      ...cabecalho,
      vendaveis: [],
      recusadas: [],
      ocupadas: 0,
    };
    if (units.length === 0) return vazio;

    const blocos = await tx.availabilityBlock.findMany({
      where: {
        unitId: { in: units.map((u) => u.id) },
        isBlocking: true,
        releasedAt: null,
        startDate: { lt: pedido.checkOut },
        endDate: { gt: pedido.checkIn },
      },
      select: { unitId: true },
    });
    const ocupadas = new Set(blocos.map((b) => b.unitId));
    const livres = units.filter((u) => !ocupadas.has(u.id));

    const insumos = await carregarInsumosCotacao(
      tx,
      livres.map((u) => u.id),
      pedido.checkIn,
      pedido.checkOut,
    );

    const resultado: ResultadoPublico = {
      ...cabecalho,
      vendaveis: [],
      recusadas: [],
      ocupadas: ocupadas.size,
    };

    for (const u of livres) {
      const { planos, tarifas } = insumos.get(u.id)!;
      const r = cotarTodosPlanos({
        unit: {
          id: u.id,
          maxGuests: u.maxGuests,
          minNights: u.minNights,
          maxNights: u.maxNights,
          cleaningFeeCents: u.cleaningFeeCents,
          currency: u.currency,
        },
        planos,
        tarifas,
        checkIn: pedido.checkIn,
        checkOut: pedido.checkOut,
        hospedes: pedido.hospedes,
        hoje,
        extras,
      });
      if (r.cotacoes.length > 0) {
        resultado.vendaveis.push({
          unitId: u.id,
          unitName: u.name,
          internalCode: u.internalCode,
          maxGuests: u.maxGuests,
          planos: r.cotacoes,
        });
      } else if (r.recusas[0]) {
        resultado.recusadas.push({
          unitId: u.id,
          unitName: u.name,
          internalCode: u.internalCode,
          recusa: r.recusas[0],
        });
      }
    }

    resultado.vendaveis.sort((a, b) => {
      const pa = a.planos[0]?.totalCents ?? Number.POSITIVE_INFINITY;
      const pb = b.planos[0]?.totalCents ?? Number.POSITIVE_INFINITY;
      return pa - pb;
    });
    return resultado;
  });
}

/**
 * Resumo diário do mês: unidades ativas livres de bloqueio E com ao
 * menos uma tarifa aberta naquela noite (RN-011). Sem cotação completa
 * — o calendário só pinta disponibilidade.
 */
export async function calendarioPublico(
  inicio: Date,
  fim: Date,
): Promise<DiaCalendarioPublico[]> {
  const canal = await resolverCanalDireto();

  return withTenant({ tenantId: canal.tenantId }, async (tx) => {
    const units = await tx.unit.findMany({
      where: {
        propertyId: canal.propertyId,
        status: "ACTIVE",
        property: { status: "ACTIVE" },
      },
      select: { id: true },
    });
    const total = units.length;
    const dias = diasNoIntervalo(inicio, fim).map(toDateOnly);
    const porDia = new Map(dias.map((d) => [d, total]));

    if (total === 0) {
      return dias.map((data) => ({ data, livres: 0, total: 0 }));
    }

    const blocos = await tx.availabilityBlock.findMany({
      where: {
        unitId: { in: units.map((u) => u.id) },
        isBlocking: true,
        releasedAt: null,
        startDate: { lt: fim },
        endDate: { gt: inicio },
      },
      select: { unitId: true, startDate: true, endDate: true },
    });

    const ocupada = new Map<string, Set<string>>();
    for (const u of units) ocupada.set(u.id, new Set());
    for (const b of blocos) {
      const set = ocupada.get(b.unitId);
      if (!set) continue;
      for (const dia of diasNoIntervalo(b.startDate, b.endDate)) {
        const chave = toDateOnly(dia);
        if (chave >= toDateOnly(inicio) && chave < toDateOnly(fim)) {
          set.add(chave);
        }
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
    const comTarifa = new Map<string, Set<string>>();
    for (const t of tarifas) {
      const set = comTarifa.get(t.unitId) ?? new Set<string>();
      set.add(toDateOnly(t.date));
      comTarifa.set(t.unitId, set);
    }

    for (const d of dias) porDia.set(d, 0);
    for (const u of units) {
      const bloq = ocupada.get(u.id) ?? new Set();
      const rates = comTarifa.get(u.id) ?? new Set();
      for (const d of dias) {
        if (!bloq.has(d) && rates.has(d)) {
          porDia.set(d, (porDia.get(d) ?? 0) + 1);
        }
      }
    }

    return dias.map((data) => ({
      data,
      livres: porDia.get(data) ?? 0,
      total,
    }));
  });
}
