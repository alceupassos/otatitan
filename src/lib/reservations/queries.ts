import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { ReservationStatus } from "@/generated/prisma/enums";
import { toDateOnly } from "@/lib/dates";
import { withTenant, type TenantTx } from "@/lib/db/with-tenant";
import { nomeCompleto } from "@/lib/guests/schemas";
import { carregarInsumosCotacao } from "@/lib/pricing/queries";
import { cotar, type ResultadoCotacao } from "@/lib/pricing/quote";
import { scopeFor, type ActorContext } from "@/lib/rbac/guard";
import { formatarCodigo } from "./codigo";
import { saldoDevedorCents } from "./estados";
import {
  interpretarBusca,
  POR_PAGINA_MAXIMO,
  POR_PAGINA_PADRAO,
} from "./schemas";

/**
 * Leituras de reservas.
 *
 * Duas camadas de recorte, sempre: `withTenant` (RLS) separa empresas e
 * `scopeFor(actor, "Reservation")` separa linhas dentro da empresa — um
 * proprietário só enxerga as reservas dos imóveis dele, um hóspede só a
 * própria. Permissão sozinha não recorta nada
 * (docs/07-matriz-permissoes.md).
 *
 * A checagem de `reservations.view` é do chamador (página ou route
 * handler), como nos demais módulos de leitura do projeto.
 */

export type FiltroReservas = {
  status?: ReservationStatus[];
  /** Início do período consultado (inclusivo). */
  de?: Date | null;
  /** Fim do período consultado (inclusivo — é um dia escolhido no calendário). */
  ate?: Date | null;
  propertyId?: string | null;
  unitId?: string | null;
  /** Código da reserva ou nome do hóspede. */
  busca?: string | null;
  pagina?: number;
  porPagina?: number;
  ordem?: "recentes" | "chegada";
};

export type ReservaDaLista = {
  id: string;
  code: string;
  codigoFormatado: string;
  status: ReservationStatus;
  source: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  hospedes: number;
  hospedeNome: string;
  unidade: string;
  unidadeId: string;
  imovel: string;
  imovelId: string;
  currency: string;
  totalCents: number;
  paidCents: number;
  saldoCents: number;
  holdExpiresAt: Date | null;
  createdAt: Date;
};

export type PaginaDeReservas = {
  itens: ReservaDaLista[];
  total: number;
  pagina: number;
  porPagina: number;
  paginas: number;
};

/**
 * Recorte de período por SOBREPOSIÇÃO, não por data de início.
 *
 * A pergunta do operador ("o que tenho em março?") inclui a estadia que
 * começou em fevereiro e termina em março. Filtrar só por `checkIn`
 * esconderia exatamente as reservas em curso — as que mais importam.
 * `checkOut > de` e não `>=` porque a saída não é noite ocupada (RN-001).
 */
function recorteDePeriodo(
  de: Date | null | undefined,
  ate: Date | null | undefined,
): Prisma.ReservationWhereInput {
  return {
    ...(de ? { checkOut: { gt: de } } : {}),
    ...(ate ? { checkIn: { lte: ate } } : {}),
  };
}

function recorteDeBusca(
  termo: string | null | undefined,
): Prisma.ReservationWhereInput {
  const { codigo, palavras } = interpretarBusca(termo ?? null);
  const alternativas: Prisma.ReservationWhereInput[] = [];

  // O código é gravado sem separador e em maiúsculas; `interpretarBusca`
  // devolve o termo já nessa forma, então "a7k2-9qf3" acha "A7K29QF3".
  if (codigo) alternativas.push({ code: { contains: codigo } });

  if (palavras.length > 0) {
    // Todas as palavras precisam aparecer, em qualquer ordem e em qualquer
    // um dos dois campos: quem digita "souza ana" está procurando Ana
    // Souza, e exigir a ordem do cadastro devolveria lista vazia.
    alternativas.push({
      primaryGuest: {
        AND: palavras.map((p) => ({
          OR: [
            { firstName: { contains: p, mode: "insensitive" as const } },
            { lastName: { contains: p, mode: "insensitive" as const } },
          ],
        })),
      },
    });
  }

  return alternativas.length > 0 ? { OR: alternativas } : {};
}

const SELECT_LISTA = {
  id: true,
  code: true,
  status: true,
  source: true,
  checkIn: true,
  checkOut: true,
  nights: true,
  adults: true,
  children: true,
  infants: true,
  currency: true,
  totalCents: true,
  paidCents: true,
  holdExpiresAt: true,
  createdAt: true,
  unitId: true,
  propertyId: true,
  primaryGuest: { select: { firstName: true, lastName: true } },
  unit: { select: { name: true, internalCode: true } },
  property: { select: { name: true } },
} satisfies Prisma.ReservationSelect;

export async function listarReservas(
  actor: ActorContext,
  filtros: FiltroReservas = {},
): Promise<PaginaDeReservas> {
  const pagina = Math.max(1, filtros.pagina ?? 1);
  const porPagina = Math.min(
    Math.max(1, filtros.porPagina ?? POR_PAGINA_PADRAO),
    POR_PAGINA_MAXIMO,
  );

  const where: Prisma.ReservationWhereInput = {
    ...scopeFor(actor, "Reservation"),
    ...(filtros.status && filtros.status.length > 0
      ? { status: { in: filtros.status } }
      : {}),
    ...(filtros.propertyId ? { propertyId: filtros.propertyId } : {}),
    ...(filtros.unitId ? { unitId: filtros.unitId } : {}),
    ...recorteDePeriodo(filtros.de, filtros.ate),
    ...recorteDeBusca(filtros.busca),
  };

  // "chegada" para a operação do dia (quem entra primeiro no topo);
  // "recentes" para a tela de vendas, onde o que interessa é o que acabou
  // de ser lançado. `code` fecha a ordenação para a paginação não repetir
  // nem pular linha quando duas reservas empatam.
  const orderBy: Prisma.ReservationOrderByWithRelationInput[] =
    filtros.ordem === "chegada"
      ? [{ checkIn: "asc" }, { code: "asc" }]
      : [{ createdAt: "desc" }, { code: "asc" }];

  return withTenant(
    { tenantId: actor.tenantId, userId: actor.userId },
    async (tx) => {
      const total = await tx.reservation.count({ where });
      const linhas = await tx.reservation.findMany({
        where,
        select: SELECT_LISTA,
        orderBy,
        skip: (pagina - 1) * porPagina,
        take: porPagina,
      });

      return {
        itens: linhas.map((r) => ({
          id: r.id,
          code: r.code,
          codigoFormatado: formatarCodigo(r.code),
          status: r.status,
          source: r.source,
          checkIn: toDateOnly(r.checkIn),
          checkOut: toDateOnly(r.checkOut),
          nights: r.nights,
          hospedes: r.adults + r.children,
          hospedeNome: nomeCompleto(r.primaryGuest),
          unidade: r.unit.internalCode,
          unidadeId: r.unitId,
          imovel: r.property.name,
          imovelId: r.propertyId,
          currency: r.currency,
          totalCents: r.totalCents,
          paidCents: r.paidCents,
          saldoCents: saldoDevedorCents(r),
          holdExpiresAt: r.holdExpiresAt,
          createdAt: r.createdAt,
        })),
        total,
        pagina,
        porPagina,
        paginas: Math.max(1, Math.ceil(total / porPagina)),
      };
    },
  );
}

/**
 * Detalhe da reserva — hóspede, unidade, pagamentos, bloqueio e tarefas.
 *
 * `null` quando não existe OU está fora do escopo do ator: os dois casos
 * respondem igual, para não confirmar a existência de um id alheio.
 */
export async function obterReserva(actor: ActorContext, id: string) {
  return withTenant(
    { tenantId: actor.tenantId, userId: actor.userId },
    async (tx) => {
      const reserva = await tx.reservation.findFirst({
        where: { id, ...scopeFor(actor, "Reservation") },
        select: {
          ...SELECT_LISTA,
          quoteSnapshot: true,
          nightlyTotalCents: true,
          feesTotalCents: true,
          taxesTotalCents: true,
          discountsTotalCents: true,
          confirmedAt: true,
          cancelledAt: true,
          cancellationReason: true,
          checkedInAt: true,
          checkedOutAt: true,
          guestNotes: true,
          internalNotes: true,
          channelReservationId: true,
          updatedAt: true,
          ratePlan: { select: { id: true, code: true, name: true } },
          primaryGuestId: true,
          // Sobrepõe o `primaryGuest` enxuto da lista. A ficha completa do
          // hóspede mora na tela de hóspedes; aqui vai só o contato de que
          // o operador precisa para receber a chegada — `documentNumberEnc`
          // nunca é lido (docs/11-seguranca-lgpd.md).
          primaryGuest: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
              documentType: true,
              documentLast4: true,
              country: true,
            },
          },
          payments: {
            select: {
              id: true,
              provider: true,
              method: true,
              intent: true,
              status: true,
              amountCents: true,
              currency: true,
              cardBrand: true,
              cardLast4: true,
              receiptUrl: true,
              description: true,
              failureMessage: true,
              paidAt: true,
              createdAt: true,
            },
            orderBy: { createdAt: "asc" },
          },
          availabilityBlock: {
            select: {
              id: true,
              startDate: true,
              endDate: true,
              isBlocking: true,
              releasedAt: true,
            },
          },
          tasks: {
            select: {
              id: true,
              type: true,
              title: true,
              status: true,
              priority: true,
              dueAt: true,
              assignedRoleSlug: true,
              assignedToUserId: true,
              completedAt: true,
            },
            orderBy: { dueAt: "asc" },
          },
        },
      });
      if (!reserva) return null;

      return {
        ...reserva,
        codigoFormatado: formatarCodigo(reserva.code),
        hospedes: reserva.adults + reserva.children,
        hospedeNome: nomeCompleto(reserva.primaryGuest),
        saldoCents: saldoDevedorCents(reserva),
      };
    },
  );
}

export type ReservaDetalhe = NonNullable<
  Awaited<ReturnType<typeof obterReserva>>
>;

// ── Insumos da criação (usados por actions.ts, dentro da transação) ───────

export type UnidadeParaReserva = {
  id: string;
  name: string;
  internalCode: string;
  propertyId: string;
  propertyName: string;
  maxGuests: number;
  minNights: number;
  maxNights: number | null;
  cleaningFeeCents: number;
  currency: string;
};

/**
 * Carrega a unidade DENTRO da transação da reserva.
 *
 * O escopo é aplicado no imóvel-pai (`scopeFor(actor, "Property")`): quem
 * não enxerga o imóvel não alcança a unidade por dentro. Não filtra por
 * `status` de propósito — quem decide se a unidade está em oferta é a
 * busca (`buscarDisponibilidade`); aqui, recusar por status daria
 * "unidade não encontrada" para uma unidade que o operador está vendo na
 * tela, e o motivo real (cadastro inativo) ficaria invisível.
 */
export async function carregarUnidadeParaReserva(
  tx: TenantTx,
  actor: ActorContext,
  unitId: string,
): Promise<UnidadeParaReserva | null> {
  const unit = await tx.unit.findFirst({
    where: { id: unitId, property: { ...scopeFor(actor, "Property") } },
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

  const { property, ...resto } = unit;
  return { ...resto, propertyName: property.name };
}

/**
 * Recalcula a cotação na MESMA transação em que a reserva será inserida
 * (RN-003).
 *
 * A pré-cotação feita antes da transação serve para recusar cedo (e não
 * criar hóspede órfão); esta é a que vale, porque é a única que enxerga as
 * tarifas sob o mesmo snapshot do INSERT. É o valor daqui que vai para as
 * colunas e para `quoteSnapshot`.
 */
export async function cotarNaTransacao(
  tx: TenantTx,
  unidade: UnidadeParaReserva,
  pedido: { checkIn: Date; checkOut: Date; hospedes: number; hoje: Date; agora?: Date },
): Promise<ResultadoCotacao> {
  const insumos = await carregarInsumosCotacao(
    tx,
    [unidade.id],
    pedido.checkIn,
    pedido.checkOut,
  );
  const { planos, tarifas } = insumos.get(unidade.id)!;

  return cotar({
    unit: {
      id: unidade.id,
      maxGuests: unidade.maxGuests,
      minNights: unidade.minNights,
      maxNights: unidade.maxNights,
      cleaningFeeCents: unidade.cleaningFeeCents,
      currency: unidade.currency,
    },
    planos,
    tarifas,
    checkIn: pedido.checkIn,
    checkOut: pedido.checkOut,
    hospedes: pedido.hospedes,
    hoje: pedido.hoje,
    agora: pedido.agora,
  });
}
