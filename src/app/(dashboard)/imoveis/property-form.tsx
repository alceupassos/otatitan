"use client";

import Link from "next/link";
import { useActionState } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import type { FormState } from "@/lib/properties/actions";
import {
  PROPERTY_TYPE_LABELS,
  PROPERTY_TYPES,
  UFS,
} from "@/lib/properties/schemas";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

export type PropertyFormValues = {
  name: string;
  type: string;
  status: string;
  description: string;
  addressLine1: string;
  addressLine2: string;
  neighborhood: string;
  city: string;
  state: string;
  postalCode: string;
  checkInTime: string;
  checkOutTime: string;
  houseRules: string;
};

export const PROPERTY_FORM_DEFAULTS: PropertyFormValues = {
  name: "",
  type: "APARTMENT",
  status: "DRAFT",
  description: "",
  addressLine1: "",
  addressLine2: "",
  neighborhood: "",
  city: "",
  state: "",
  postalCode: "",
  checkInTime: "15:00",
  checkOutTime: "11:00",
  houseRules: "",
};

/** Mensagem de erro de um campo, se houver. */
function Erro({ campo, state }: { campo: string; state?: FormState }) {
  const msgs = state?.fieldErrors?.[campo];
  if (!msgs?.length) return null;
  return (
    <p className="text-xs text-destructive" role="alert">
      {msgs.join(" ")}
    </p>
  );
}

export function PropertyForm({
  action,
  valores,
  modo,
  cancelHref,
}: {
  action: (state: FormState | undefined, formData: FormData) => Promise<FormState>;
  valores: PropertyFormValues;
  modo: "criar" | "editar";
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState<
    FormState | undefined,
    FormData
  >(action, undefined);

  // Depois de um erro, prevalece o que o usuário digitou — reexibir o
  // valor salvo apagaria a correção em andamento.
  const v = (campo: keyof PropertyFormValues) =>
    state?.values?.[campo] ?? valores[campo];

  /**
   * `<select>` precisa de `key` para sobreviver a um erro de validação.
   *
   * `defaultValue` só é aplicado na montagem. Um `<input>` não-controlado
   * conserva o que está no DOM entre re-renders, mas o `<select>` volta à
   * primeira opção — então UF e situação escolhidas eram silenciosamente
   * perdidas quando a submissão falhava por outro campo. Trocar a `key`
   * quando o valor vindo do servidor muda força a remontagem, e aí o
   * `defaultValue` novo vale.
   */
  const selectKey = (campo: keyof PropertyFormValues) => `${campo}-${v(campo)}`;

  // `editar` responde `{}` em caso de sucesso (não redireciona); `criar`
  // redireciona, então nunca chega aqui com sucesso.
  const salvou =
    modo === "editar" &&
    state !== undefined &&
    !state.error &&
    !state.fieldErrors;

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
          <CardTitle>Dados básicos</CardTitle>
          <CardDescription>
            Só o nome é obrigatório — o resto pode ser completado depois.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="name">Nome do imóvel</Label>
            <Input id="name" name="name" defaultValue={v("name")} required autoFocus />
            <Erro campo="name" state={state} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="type">Tipo</Label>
            <select
              id="type"
              name="type"
              key={selectKey("type")}
              defaultValue={v("type")}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
            >
              {PROPERTY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {PROPERTY_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            <Erro campo="type" state={state} />
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
              <option value="ACTIVE">Ativo</option>
              <option value="INACTIVE">Inativo</option>
            </select>
            <p className="text-xs text-muted-foreground">
              Só imóveis ativos aparecem em busca de disponibilidade.
            </p>
            <Erro campo="status" state={state} />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="description">Descrição</Label>
            <Textarea
              id="description"
              name="description"
              rows={4}
              defaultValue={v("description")}
              placeholder="Como você descreveria este imóvel para um hóspede?"
            />
            <Erro campo="description" state={state} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Endereço</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-6">
          <div className="space-y-2 sm:col-span-4">
            <Label htmlFor="addressLine1">Logradouro e número</Label>
            <Input id="addressLine1" name="addressLine1" defaultValue={v("addressLine1")} />
            <Erro campo="addressLine1" state={state} />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="addressLine2">Complemento</Label>
            <Input id="addressLine2" name="addressLine2" defaultValue={v("addressLine2")} />
            <Erro campo="addressLine2" state={state} />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="neighborhood">Bairro</Label>
            <Input id="neighborhood" name="neighborhood" defaultValue={v("neighborhood")} />
            <Erro campo="neighborhood" state={state} />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="city">Cidade</Label>
            <Input id="city" name="city" defaultValue={v("city")} />
            <Erro campo="city" state={state} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="state">UF</Label>
            <select
              id="state"
              name="state"
              key={selectKey("state")}
              defaultValue={v("state")}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
            >
              <option value="">—</option>
              {UFS.map((uf) => (
                <option key={uf} value={uf}>
                  {uf}
                </option>
              ))}
            </select>
            <Erro campo="state" state={state} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="postalCode">CEP</Label>
            <Input
              id="postalCode"
              name="postalCode"
              defaultValue={v("postalCode")}
              placeholder="00000-000"
              inputMode="numeric"
            />
            <Erro campo="postalCode" state={state} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Horários e regras</CardTitle>
          <CardDescription>
            Os horários valem no fuso do imóvel e definem o prazo das tarefas
            de check-in e limpeza.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="checkInTime">Check-in a partir de</Label>
            <Input id="checkInTime" name="checkInTime" type="time" defaultValue={v("checkInTime")} required />
            <Erro campo="checkInTime" state={state} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="checkOutTime">Check-out até</Label>
            <Input id="checkOutTime" name="checkOutTime" type="time" defaultValue={v("checkOutTime")} required />
            <Erro campo="checkOutTime" state={state} />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="houseRules">Regras da casa</Label>
            <Textarea
              id="houseRules"
              name="houseRules"
              rows={4}
              defaultValue={v("houseRules")}
              placeholder="Silêncio após as 22h, não são permitidas festas…"
            />
            <Erro campo="houseRules" state={state} />
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending && <Spinner />}
          {modo === "criar" ? "Cadastrar imóvel" : "Salvar alterações"}
        </Button>
        <Button asChild variant="ghost">
          <Link href={cancelHref}>Cancelar</Link>
        </Button>
      </div>
    </form>
  );
}
