import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Archive, ChevronLeft } from "lucide-react";
import { requireActorWith } from "@/lib/auth/session";
import { archiveUnitAction, updateUnitAction } from "@/lib/properties/actions";
import { getUnit, listAmenities } from "@/lib/properties/queries";
import { centsToInput } from "@/lib/money";
import { hasPermission } from "@/lib/rbac/guard";
import { Button } from "@/components/ui/button";
import { UnitForm } from "../unit-form";

type Params = { params: Promise<{ id: string; unitId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id, unitId } = await params;
  const actor = await requireActorWith("units.view");
  const found = await getUnit(actor, id, unitId);
  return { title: found?.unit.name ?? "Unidade" };
}

export default async function UnitDetailPage({ params }: Params) {
  const { id, unitId } = await params;
  const actor = await requireActorWith("units.view");

  const [found, amenities, podeEditar, podeExcluir] = await Promise.all([
    getUnit(actor, id, unitId),
    listAmenities(actor),
    hasPermission(actor, "units.edit"),
    hasPermission(actor, "units.delete"),
  ]);

  if (!found) notFound();
  const { property, unit } = found;

  const salvar = updateUnitAction.bind(null, property.id, unit.id);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href={`/imoveis/${property.id}`}
            className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
            {property.name}
          </Link>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            {unit.name}
          </h1>
          <p className="text-sm text-muted-foreground">{unit.internalCode}</p>
        </div>

        {podeExcluir && unit.status !== "ARCHIVED" && (
          // Sem diálogo de confirmação aqui: a action já recusa arquivar
          // unidade com ocupação futura e devolve o motivo na tela, que é
          // a proteção que realmente importa.
          <form action={archiveUnitAction}>
            <input type="hidden" name="propertyId" value={property.id} />
            <input type="hidden" name="unitId" value={unit.id} />
            <Button type="submit" variant="outline" size="sm">
              <Archive />
              Arquivar unidade
            </Button>
          </form>
        )}
      </div>

      {podeEditar ? (
        <UnitForm
          action={salvar}
          amenities={amenities}
          modo="editar"
          cancelHref={`/imoveis/${property.id}`}
          valores={{
            name: unit.name,
            internalCode: unit.internalCode,
            status: unit.status === "ARCHIVED" ? "INACTIVE" : unit.status,
            maxGuests: String(unit.maxGuests),
            bedrooms: String(unit.bedrooms),
            beds: String(unit.beds),
            bathrooms: String(unit.bathrooms),
            sizeM2: unit.sizeM2 === null ? "" : String(unit.sizeM2),
            baseRateCents: centsToInput(unit.baseRateCents),
            cleaningFeeCents: centsToInput(unit.cleaningFeeCents),
            minNights: String(unit.minNights),
            maxNights: unit.maxNights === null ? "" : String(unit.maxNights),
            amenityIds: unit.amenities.map((a) => a.amenityId),
          }}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          Você não tem permissão para editar esta unidade.
        </p>
      )}
    </div>
  );
}
