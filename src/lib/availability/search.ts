import "server-only";
import { diffDias, hojeUtc, toDateOnly } from "@/lib/dates";
import { withTenant } from "@/lib/db/with-tenant";
import { carregarInsumosCotacao } from "@/lib/pricing/queries";
import { cotar, type Cotacao } from "@/lib/pricing/quote";
import type { Recusa } from "@/lib/pricing/errors";
import { scopeFor, type ActorContext } from "@/lib/rbac/guard";

/**
 * Busca de disponibilidade (UC-030).
 *
 * Duas perguntas diferentes, respondidas nesta ordem: a unidade está
 * LIVRE nessas datas (ocupação, `AvailabilityBlock`) e ela é VENDÁVEL
 * (tarifa publicada e regras de estadia, motor de cotação). Uma unidade
 * livre sem tarifa não é oferta — RN-011.
 *
 * O resultado nunca some com uma unidade em silêncio: o que não pôde ser
 * vendido volta com o motivo, para o atendente corrigir o cadastro ou
 * propor outra data em vez de dizer "não tem".
 */

export type FiltroBusca = {
  checkIn: Date;
  checkOut: Date;
  hospedes: number;
  /** Restringe a um imóvel; `null` = todos os do escopo do ator. */
  propertyId?: string | null;
  /** Injetável para teste; por padrão, hoje em UTC. */
  hoje?: Date;
};

type UnidadeBase = {
  unitId: string;
  unitName: string;
  internalCode: string;
  propertyId: string;
  propertyName: string;
  maxGuests: number;
};

export type UnidadeVendavel = UnidadeBase & { cotacao: Cotacao };

export type UnidadeRecusada = UnidadeBase & {
  /** Motivo principal, do plano mais bem colocado. */
  recusa: Recusa;
  /** Todos os motivos, para a UI listar as noites problemáticas. */
  recusas: Recusa[];
};

export type UnidadeOcupada = UnidadeBase & {
  origem: "RESERVATION" | "MANUAL" | "MAINTENANCE" | "OWNER_STAY" | "CHANNEL_SYNC";
  /** Primeira noite ocupada dentro do período pedido (`YYYY-MM-DD`). */
  primeiraNoiteOcupada: string;
};

export type ResultadoBusca = {
  checkIn: string;
  checkOut: string;
  nights: number;
  hospedes: number;
  vendaveis: UnidadeVendavel[];
  recusadas: UnidadeRecusada[];
  /** Livres de tarifa, mas já ocupadas no período. */
  ocupadas: UnidadeOcupada[];
};

export async function buscarDisponibilidade(
  actor: ActorContext,
  filtro: FiltroBusca,
): Promise<ResultadoBusca> {
  const { checkIn, checkOut, hospedes } = filtro;
  const hoje = filtro.hoje ?? hojeUtc();

  const cabecalhoBusca = {
    checkIn: toDateOnly(checkIn),
    checkOut: toDateOnly(checkOut),
    nights: diffDias(checkIn, checkOut),
    hospedes,
  };

  return withTenant(
    { tenantId: actor.tenantId, userId: actor.userId },
    async (tx) => {
      const units = await tx.unit.findMany({
        where: {
          // Só unidade ativa de imóvel ativo entra em oferta: rascunho e
          // inativa aparecem no calendário interno, não na venda.
          status: "ACTIVE",
          ...(filtro.propertyId ? { propertyId: filtro.propertyId } : {}),
          property: { status: "ACTIVE", ...scopeFor(actor, "Property") },
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
        orderBy: [{ property: { name: "asc" } }, { internalCode: "asc" }],
      });

      const resultado: ResultadoBusca = {
        ...cabecalhoBusca,
        vendaveis: [],
        recusadas: [],
        ocupadas: [],
      };
      if (units.length === 0) return resultado;

      const blocos = await tx.availabilityBlock.findMany({
        where: {
          unitId: { in: units.map((u) => u.id) },
          isBlocking: true,
          releasedAt: null,
          // Sobreposição semiaberta: começa antes da saída E termina
          // depois da entrada. Um bloqueio que acaba no dia do check-in
          // não conflita — same-day turnover é permitido (RN-001).
          startDate: { lt: checkOut },
          endDate: { gt: checkIn },
        },
        select: { unitId: true, startDate: true, source: true },
        orderBy: { startDate: "asc" },
      });

      const ocupacao = new Map<string, (typeof blocos)[number]>();
      for (const b of blocos) {
        if (!ocupacao.has(b.unitId)) ocupacao.set(b.unitId, b);
      }

      const livres = units.filter((u) => !ocupacao.has(u.id));
      const insumos = await carregarInsumosCotacao(
        tx,
        livres.map((u) => u.id),
        checkIn,
        checkOut,
      );

      for (const u of units) {
        const cabecalho: UnidadeBase = {
          unitId: u.id,
          unitName: u.name,
          internalCode: u.internalCode,
          propertyId: u.propertyId,
          propertyName: u.property.name,
          maxGuests: u.maxGuests,
        };

        const bloco = ocupacao.get(u.id);
        if (bloco) {
          resultado.ocupadas.push({
            ...cabecalho,
            origem: bloco.source,
            // O bloqueio pode ter começado antes do período pedido; o que
            // interessa mostrar é a primeira noite ocupada DENTRO dele.
            primeiraNoiteOcupada: toDateOnly(
              bloco.startDate < checkIn ? checkIn : bloco.startDate,
            ),
          });
          continue;
        }

        const { planos, tarifas } = insumos.get(u.id)!;
        const r = cotar({
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
          checkIn,
          checkOut,
          hospedes,
          hoje,
        });

        if (r.ok) resultado.vendaveis.push({ ...cabecalho, cotacao: r.cotacao });
        else {
          resultado.recusadas.push({
            ...cabecalho,
            recusa: r.recusa,
            recusas: r.recusas,
          });
        }
      }

      // Mais barata primeiro: é a ordem em que o atendente lê a lista.
      resultado.vendaveis.sort(
        (a, b) => a.cotacao.totalCents - b.cotacao.totalCents,
      );
      return resultado;
    },
  );
}
