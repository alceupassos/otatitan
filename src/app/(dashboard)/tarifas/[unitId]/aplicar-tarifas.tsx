"use client";

import { useActionState } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import {
  aplicarTarifasAction,
  type RatesFormState,
} from "@/lib/rates/actions";
import { DIAS_SEMANA_LABELS } from "@/lib/rates/schemas";
import { hojeUtc, toDateOnly } from "@/lib/dates";
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

function Erro({ campo, state }: { campo: string; state?: RatesFormState }) {
  const msgs = state?.fieldErrors?.[campo];
  if (!msgs?.length) return null;
  return (
    <p className="text-xs text-destructive" role="alert">
      {msgs.join(" ")}
    </p>
  );
}

export function AplicarTarifasCard({
  unitId,
  planos,
  mesVisivel,
}: {
  unitId: string;
  planos: { id: string; name: string; code: string }[];
  mesVisivel: string;
}) {
  const aplicar = aplicarTarifasAction.bind(null, unitId);
  const [state, formAction, pending] = useActionState<
    RatesFormState | undefined,
    FormData
  >(aplicar, undefined);

  const v = (campo: string) => state?.values?.[campo] ?? "";
  // Começa no mês que a grade está mostrando: quem navegou até março
  // quer publicar tarifa de março.
  const padraoDe = v("de") || (mesVisivel > toDateOnly(hojeUtc()) ? mesVisivel : toDateOnly(hojeUtc()));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Publicar diárias</CardTitle>
        <CardDescription>
          Aplica o mesmo preço a um intervalo de datas. Republicar um período
          já publicado substitui os valores — é o fluxo normal de reajuste.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form action={formAction} className="space-y-4">
          {state?.error && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
          {state?.ok && state.resumo && (
            <Alert>
              <CheckCircle2 />
              <AlertDescription>{state.resumo}</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="ratePlanId">Plano</Label>
              <select
                id="ratePlanId"
                name="ratePlanId"
                key={`plano-${v("ratePlanId")}`}
                defaultValue={v("ratePlanId") || planos[0]?.id}
                required
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
              >
                {planos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.code})
                  </option>
                ))}
              </select>
              <Erro campo="ratePlanId" state={state} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="de">De</Label>
              <Input id="de" name="de" type="date" defaultValue={padraoDe} required />
              <Erro campo="de" state={state} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ate">Até (inclusive)</Label>
              <Input id="ate" name="ate" type="date" defaultValue={v("ate") || padraoDe} required />
              <Erro campo="ate" state={state} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="priceCents">Diária (R$)</Label>
              <Input
                id="priceCents"
                name="priceCents"
                inputMode="decimal"
                defaultValue={v("priceCents")}
                placeholder="450,00"
                required
              />
              <Erro campo="priceCents" state={state} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="minNights">Estadia mínima nestas datas</Label>
              <Input
                id="minNights"
                name="minNights"
                type="number"
                min={1}
                defaultValue={v("minNights")}
                placeholder="usa a do plano"
              />
              <Erro campo="minNights" state={state} />
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Aplicar só a</legend>
            <div className="flex flex-wrap gap-3">
              {DIAS_SEMANA_LABELS.map((d) => (
                <label
                  key={d.valor}
                  htmlFor={`dia-${d.valor}`}
                  className="flex items-center gap-1.5 text-sm"
                >
                  <Checkbox id={`dia-${d.valor}`} name="diasSemana" value={d.valor} />
                  {d.label}
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Nenhum marcado = todos os dias. Útil para preço de fim de semana.
            </p>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Restrições</legend>
            <div className="flex flex-wrap gap-4">
              <label htmlFor="isClosed" className="flex items-center gap-2 text-sm">
                <Checkbox id="isClosed" name="isClosed" />
                Fechado para venda
              </label>
              <label htmlFor="closedToArrival" className="flex items-center gap-2 text-sm">
                <Checkbox id="closedToArrival" name="closedToArrival" />
                Sem chegada
              </label>
              <label htmlFor="closedToDeparture" className="flex items-center gap-2 text-sm">
                <Checkbox id="closedToDeparture" name="closedToDeparture" />
                Sem saída
              </label>
            </div>
          </fieldset>

          <Button type="submit" disabled={pending}>
            {pending && <Spinner />}
            Publicar
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
