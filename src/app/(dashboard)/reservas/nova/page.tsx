import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireActorWith } from "@/lib/auth/session";
import { addDias, hojeUtc, toDateOnly, tryParseDateOnly } from "@/lib/dates";
import { listProperties } from "@/lib/properties/queries";
import { hasPermission } from "@/lib/rbac/guard";
import { ORIGEM_LABELS, ORIGENS_RESERVA } from "@/lib/reservations/schemas";
import type { ValoresBusca } from "@/components/reservas/nova/actions";
import { NovaReservaFluxo } from "@/components/reservas/nova/nova-reserva";

export const metadata: Metadata = { title: "Nova reserva" };

/** Teto defensivo do campo; o limite real é `Unit.maxGuests` (o motor recusa). */
const MAX_HOSPEDES = 50;

type Props = {
  searchParams: Promise<{
    checkIn?: string;
    checkOut?: string;
    hospedes?: string;
    propertyId?: string;
  }>;
};

export default async function NovaReservaPage({ searchParams }: Props) {
  // Confere junto ao dado, não só no proxy (ADR-007). As server actions do
  // fluxo conferem de novo, porque são alcançáveis por POST direto.
  const actor = await requireActorWith("reservations.create");
  const params = await searchParams;

  // Um papel pode vender sem enxergar a carteira de imóveis; nesse caso a
  // busca simplesmente não oferece o filtro, em vez de estourar.
  const imoveis = (await hasPermission(actor, "properties.view"))
    ? (await listProperties(actor, { status: "ACTIVE" })).map((p) => ({
        id: p.id,
        name: p.name,
      }))
    : [];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link
          href="/reservas"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          Reservas
        </Link>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Nova reserva
        </h1>
        <p className="text-sm text-muted-foreground">
          O preço é sempre recalculado no servidor no momento de gravar — o
          valor confirmado na tela é o que será cobrado, ou a venda para para
          você conferir o novo.
        </p>
      </div>

      <NovaReservaFluxo
        imoveis={imoveis}
        buscaInicial={buscaInicial(params, imoveis)}
        origens={ORIGENS_RESERVA.map((o) => ({
          valor: o,
          label: ORIGEM_LABELS[o],
        }))}
      />
    </div>
  );
}

/**
 * Pré-preenchimento vindo da URL — é o que permite chegar aqui do
 * calendário ou da ficha do imóvel com o período já escolhido.
 *
 * Tudo tolerante: parâmetro inválido (link antigo, URL editada à mão) cai
 * no padrão em vez de derrubar a tela.
 */
function buscaInicial(
  params: {
    checkIn?: string;
    checkOut?: string;
    hospedes?: string;
    propertyId?: string;
  },
  imoveis: { id: string }[],
): ValoresBusca {
  const checkIn = (params.checkIn && tryParseDateOnly(params.checkIn)) || hojeUtc();

  // A saída tem que ser depois da entrada: o intervalo é semiaberto e uma
  // estadia de zero noites não existe (RN-001).
  const saidaPedida = params.checkOut ? tryParseDateOnly(params.checkOut) : null;
  const checkOut =
    saidaPedida && saidaPedida > checkIn ? saidaPedida : addDias(checkIn, 1);

  const hospedes = Number(params.hospedes);
  const propertyId =
    params.propertyId && imoveis.some((i) => i.id === params.propertyId)
      ? params.propertyId
      : "";

  return {
    checkIn: toDateOnly(checkIn),
    checkOut: toDateOnly(checkOut),
    hospedes: String(
      Number.isInteger(hospedes) && hospedes >= 1 && hospedes <= MAX_HOSPEDES
        ? hospedes
        : 2,
    ),
    propertyId,
  };
}
