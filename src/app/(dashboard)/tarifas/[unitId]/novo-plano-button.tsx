"use client";

import { useActionState, useState } from "react";
import { AlertCircle, Plus } from "lucide-react";
import { criarRatePlanAction, type RatesFormState } from "@/lib/rates/actions";
import {
  POLITICAS_CANCELAMENTO,
  POLITICA_DESCRICOES,
  POLITICA_LABELS,
} from "@/lib/rates/schemas";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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

export function NovoPlanoButton({
  unitId,
  temPlano,
}: {
  unitId: string;
  temPlano: boolean;
}) {
  const criar = criarRatePlanAction.bind(null, unitId);
  const [aberto, setAberto] = useState(false);
  const [state, formAction, pending] = useActionState<
    RatesFormState | undefined,
    FormData
  >(criar, undefined);

  const [ultimoOk, setUltimoOk] = useState(false);
  if (state?.ok && !ultimoOk) {
    setUltimoOk(true);
    setAberto(false);
  }
  if (!state?.ok && ultimoOk) setUltimoOk(false);

  const v = (campo: string) => state?.values?.[campo] ?? "";

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus />
          Novo plano
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <form action={formAction} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Novo plano de tarifa</DialogTitle>
            <DialogDescription>
              {temPlano
                ? "Um plano define regras de estadia e cancelamento; as diárias são publicadas depois."
                : "Este é o primeiro plano da unidade, então entra como padrão e ativo — sem ele a unidade não recebe reserva."}
            </DialogDescription>
          </DialogHeader>

          {state?.error && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Nome</Label>
              <Input
                id="name"
                name="name"
                defaultValue={v("name") || "Tarifa padrão"}
                required
                autoFocus
              />
              <Erro campo="name" state={state} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="code">Código</Label>
              <Input
                id="code"
                name="code"
                defaultValue={v("code") || "PADRAO"}
                required
                placeholder="PADRAO"
              />
              <Erro campo="code" state={state} />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="cancellationPolicy">Política de cancelamento</Label>
              <select
                id="cancellationPolicy"
                name="cancellationPolicy"
                key={`pol-${v("cancellationPolicy")}`}
                defaultValue={v("cancellationPolicy") || "MODERATE"}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
              >
                {POLITICAS_CANCELAMENTO.map((p) => (
                  <option key={p} value={p}>
                    {POLITICA_LABELS[p]} — {POLITICA_DESCRICOES[p]}
                  </option>
                ))}
              </select>
              <Erro campo="cancellationPolicy" state={state} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="minNights">Estadia mínima</Label>
              <Input
                id="minNights"
                name="minNights"
                type="number"
                min={1}
                defaultValue={v("minNights") || "1"}
                required
              />
              <Erro campo="minNights" state={state} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="maxNights">Estadia máxima</Label>
              <Input
                id="maxNights"
                name="maxNights"
                type="number"
                min={1}
                defaultValue={v("maxNights")}
                placeholder="sem limite"
              />
              <Erro campo="maxNights" state={state} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="minAdvanceDays">Antecedência mínima (dias)</Label>
              <Input
                id="minAdvanceDays"
                name="minAdvanceDays"
                type="number"
                min={0}
                defaultValue={v("minAdvanceDays") || "0"}
                required
              />
              <Erro campo="minAdvanceDays" state={state} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="maxAdvanceDays">Antecedência máxima (dias)</Label>
              <Input
                id="maxAdvanceDays"
                name="maxAdvanceDays"
                type="number"
                min={0}
                defaultValue={v("maxAdvanceDays")}
                placeholder="sem limite"
              />
              <Erro campo="maxAdvanceDays" state={state} />
            </div>
          </div>

          <div className="space-y-3">
            <label htmlFor="includesCleaningFee" className="flex items-center gap-2 text-sm">
              <Checkbox id="includesCleaningFee" name="includesCleaningFee" />
              A diária já inclui a taxa de limpeza
            </label>

            {temPlano && (
              <>
                <label htmlFor="isDefault" className="flex items-center gap-2 text-sm">
                  <Checkbox id="isDefault" name="isDefault" />
                  Tornar este o plano padrão da unidade
                </label>
                <div className="space-y-2">
                  <Label htmlFor="status">Situação</Label>
                  <select
                    id="status"
                    name="status"
                    key={`st-${v("status")}`}
                    defaultValue={v("status") || "ACTIVE"}
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
                  >
                    <option value="ACTIVE">Ativo</option>
                    <option value="DRAFT">Rascunho</option>
                  </select>
                </div>
              </>
            )}
            {/* Primeiro plano entra sempre ativo — o campo vai oculto para
                que o schema receba o valor esperado. */}
            {!temPlano && <input type="hidden" name="status" value="ACTIVE" />}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              Criar plano
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
