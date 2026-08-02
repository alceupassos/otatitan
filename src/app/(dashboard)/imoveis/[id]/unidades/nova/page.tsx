import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireActorWith } from "@/lib/auth/session";
import { createUnitAction } from "@/lib/properties/actions";
import { getProperty, listAmenities } from "@/lib/properties/queries";
import { UNIT_FORM_DEFAULTS, UnitForm } from "../unit-form";

export const metadata: Metadata = { title: "Nova unidade" };

export default async function NewUnitPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireActorWith("units.create");

  const [property, amenities] = await Promise.all([
    getProperty(actor, id),
    listAmenities(actor),
  ]);
  if (!property) notFound();

  const criar = createUnitAction.bind(null, property.id);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href={`/imoveis/${property.id}`}
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          {property.name}
        </Link>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Nova unidade
        </h1>
      </div>

      <UnitForm
        action={criar}
        valores={UNIT_FORM_DEFAULTS}
        amenities={amenities}
        modo="criar"
        cancelHref={`/imoveis/${property.id}`}
      />
    </div>
  );
}
