"use client";

import Link from "next/link";
import { useActionState } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import type { FormState } from "@/lib/properties/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";

export type UnitFormValues = {
  name: string;
  internalCode: string;
  status: string;
  maxGuests: string;
  bedrooms: string;
  beds: string;
  bathrooms: string;
  sizeM2: string;
  baseRateCents: string;
  cleaningFeeCents: string;
  minNights: string;
  maxNights: string;
  amenityIds: string[];
};

export const UNIT_FORM_DEFAULTS: UnitFormValues = {
  name: "",
  internalCode: "",
  status: "DRAFT",
  maxGuests: "2",
  bedrooms: "1",
  beds: "1",
  bathrooms: "1",
  sizeM2: "",
  baseRateCents: "",
  cleaningFeeCents: "0",
  minNights: "1",
  maxNights: "",
  amenityIds: [],
};

export type Amenity = {
  id: string;
  name: string;
  category: string;
};

const CATEGORIA_LABELS: Record<string, string> = {
  ESSENTIALS: "Essenciais",
  KITCHEN: "Cozinha",
  OUTDOOR: "Área externa",
  LEISURE: "Lazer",
  ACCESSIBILITY: "Acessibilidade",
  SAFETY: "Segurança",
  OTHER: "Outros",
};

function Erro({ campo, state }: { campo: string; state?: FormState }) {
  const msgs = state?.fieldErrors?.[campo];
  if (!msgs?.length) return null;
  return (
    <p className="text-xs text-destructive" role="alert">
      {msgs.join(" ")}
    </p>
  );
}

export function UnitForm({
  action,
  valores,
  amenities,
  modo,
  cancelHref,
}: {
  action: (state: FormState | undefined, formData: FormData) => Promise<FormState>;
  valores: UnitFormValues;
  amenities: Amenity[];
  modo: "criar" | "editar";
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState<
    FormState | undefined,
    FormData
  >(action, undefined);

  const v = (campo: keyof Omit<UnitFormValues, "amenityIds">) =>
    state?.values?.[campo] ?? valores[campo];

  /**
   * `key` no `<select>`: `defaultValue` só vale na montagem, e um select
   * não-controlado volta à primeira opção no re-render que acontece após
   * um erro de validação — perdendo em silêncio a situação escolhida.
   * Trocar a key quando o valor do servidor muda força a remontagem.
   */
  const selectKey = (campo: keyof Omit<UnitFormValues, "amenityIds">) =>
    `${campo}-${v(campo)}`;

  const salvou =
    modo === "editar" && state !== undefined && !state.error && !state.fieldErrors;

  const porCategoria = amenities.reduce<Record<string, Amenity[]>>((acc, a) => {
    (acc[a.category] ??= []).push(a);
    return acc;
  }, {});

  return (
    <form action={formAction} className="space-y-6">
      {state?.error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      {salvou && (
        <Alert>
          <CheckCircle2 />
          <AlertDescription>Alterações salvas.</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Identificação</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="name">Nome</Label>
            <Input id="name" name="name" defaultValue={v("name")} required autoFocus />
            <Erro campo="name" state={state} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="internalCode">Código interno</Label>
            <Input
              id="internalCode"
              name="internalCode"
              defaultValue={v("internalCode")}
              required
              placeholder="APT-101"
            />
            <p className="text-xs text-muted-foreground">
              Único dentro do imóvel. Usado na operação e nos relatórios.
            </p>
            <Erro campo="internalCode" state={state} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="status">Situação</Label>
            <select
              id="status"
              name="status"
              key={selectKey("status")}
              defaultValue={v("status")}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
            >
              <option value="DRAFT">Rascunho</option>
              <option value="ACTIVE">Ativa</option>
              <option value="INACTIVE">Inativa</option>
            </select>
            <Erro campo="status" state={state} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="sizeM2">Área (m²)</Label>
            <Input id="sizeM2" name="sizeM2" type="number" min={1} defaultValue={v("sizeM2")} />
            <Erro campo="sizeM2" state={state} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Capacidade</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="maxGuests">Hóspedes</Label>
            <Input id="maxGuests" name="maxGuests" type="number" min={1} defaultValue={v("maxGuests")} required />
            <Erro campo="maxGuests" state={state} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bedrooms">Quartos</Label>
            <Input id="bedrooms" name="bedrooms" type="number" min={0} defaultValue={v("bedrooms")} required />
            <Erro campo="bedrooms" state={state} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="beds">Camas</Label>
            <Input id="beds" name="beds" type="number" min={0} defaultValue={v("beds")} required />
            <Erro campo="beds" state={state} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bathrooms">Banheiros</Label>
            <Input id="bathrooms" name="bathrooms" type="number" min={0} defaultValue={v("bathrooms")} required />
            <Erro campo="bathrooms" state={state} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Valores e estadia</CardTitle>
          <CardDescription>
            Estes são os valores de referência da unidade. A tarifa efetiva de
            cada noite vem do plano de tarifas.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="baseRateCents">Diária base (R$)</Label>
            <Input
              id="baseRateCents"
              name="baseRateCents"
              inputMode="decimal"
              defaultValue={v("baseRateCents")}
              placeholder="450,00"
            />
            <Erro campo="baseRateCents" state={state} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cleaningFeeCents">Taxa de limpeza (R$)</Label>
            <Input
              id="cleaningFeeCents"
              name="cleaningFeeCents"
              inputMode="decimal"
              defaultValue={v("cleaningFeeCents")}
              required
              placeholder="0,00"
            />
            <Erro campo="cleaningFeeCents" state={state} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="minNights">Estadia mínima (noites)</Label>
            <Input id="minNights" name="minNights" type="number" min={1} defaultValue={v("minNights")} required />
            <Erro campo="minNights" state={state} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="maxNights">Estadia máxima (noites)</Label>
            <Input id="maxNights" name="maxNights" type="number" min={1} defaultValue={v("maxNights")} placeholder="sem limite" />
            <Erro campo="maxNights" state={state} />
          </div>
        </CardContent>
      </Card>

      {amenities.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Comodidades</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {Object.entries(porCategoria).map(([categoria, itens]) => (
              <fieldset key={categoria} className="space-y-2">
                <legend className="text-sm font-medium">
                  {CATEGORIA_LABELS[categoria] ?? categoria}
                </legend>
                <div className="grid gap-2 sm:grid-cols-3">
                  {itens.map((a) => (
                    <label
                      key={a.id}
                      className="flex items-center gap-2 text-sm"
                      htmlFor={`amenity-${a.id}`}
                    >
                      <Checkbox
                        id={`amenity-${a.id}`}
                        name="amenityIds"
                        value={a.id}
                        defaultChecked={valores.amenityIds.includes(a.id)}
                      />
                      {a.name}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending && <Spinner />}
          {modo === "criar" ? "Cadastrar unidade" : "Salvar alterações"}
        </Button>
        <Button asChild variant="ghost">
          <Link href={cancelHref}>Cancelar</Link>
        </Button>
      </div>
    </form>
  );
}
