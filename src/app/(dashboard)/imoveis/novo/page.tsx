import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireActorWith } from "@/lib/auth/session";
import { createPropertyAction } from "@/lib/properties/actions";
import {
  PROPERTY_FORM_DEFAULTS,
  PropertyForm,
} from "../property-form";

export const metadata: Metadata = { title: "Novo imóvel" };

export default async function NewPropertyPage() {
  // A permissão é conferida aqui, junto do dado — não basta o proxy
  // (ADR-007). A própria action confere de novo, porque é alcançável
  // por POST direto.
  await requireActorWith("properties.create");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href="/imoveis"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          Imóveis
        </Link>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Novo imóvel
        </h1>
      </div>

      <PropertyForm
        action={createPropertyAction}
        valores={PROPERTY_FORM_DEFAULTS}
        modo="criar"
        cancelHref="/imoveis"
      />
    </div>
  );
}
