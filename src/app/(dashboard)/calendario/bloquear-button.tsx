"use client";

import { useActionState, useState } from "react";
import { AlertCircle, Ban } from "lucide-react";
import {
  criarBloqueioAction,
  type CalendarioFormState,
} from "@/lib/availability/actions";
import { MOTIVOS_BLOQUEIO, MOTIVO_LABELS } from "@/lib/availability/schemas";
import { hojeUtc, toDateOnly } from "@/lib/dates";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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

type Unidade = {
  id: string;
  name: string;
  internalCode: string;
  property: { name: string };
};

function Erro({ campo, state }: { campo: string; state?: CalendarioFormState }) {
  const msgs = state?.fieldErrors?.[campo];
  if (!msgs?.length) return null;
  return (
    <p className="text-xs text-destructive" role="alert">
      {msgs.join(" ")}
    </p>
  );
}

export function BloquearButton({ unidades }: { unidades: Unidade[] }) {
  const [aberto, setAberto] = useState(false);
  const [state, formAction, pending] = useActionState<
    CalendarioFormState | undefined,
    FormData
  >(criarBloqueioAction, undefined);

  // Fecha ao concluir. Ajuste durante o render (não em efeito): reagimos
  // a estado do React, não a sistema externo.
  const [ultimoOk, setUltimoOk] = useState(false);
  if (state?.ok && !ultimoOk) {
    setUltimoOk(true);
    setAberto(false);
  }
  if (!state?.ok && ultimoOk) setUltimoOk(false);

  const hoje = toDateOnly(hojeUtc());
  const v = (campo: string) => state?.values?.[campo] ?? "";

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Ban />
          Bloquear datas
        </Button>
      </DialogTrigger>

      <DialogContent>
        <form action={formAction} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Bloquear datas</DialogTitle>
            <DialogDescription>
              Informe a primeira e a última noite. A unidade fica indisponível
              nesse período — a data de saída seguinte continua livre para
              outra entrada.
            </DialogDescription>
          </DialogHeader>

          {state?.error && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="unitId">Unidade</Label>
            <select
              id="unitId"
              name="unitId"
              key={`unitId-${v("unitId")}`}
              defaultValue={v("unitId")}
              required
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
            >
              <option value="">Selecione…</option>
              {unidades.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.internalCode} — {u.property.name}
                </option>
              ))}
            </select>
            <Erro campo="unitId" state={state} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="primeiraNoite">Primeira noite</Label>
              <Input
                id="primeiraNoite"
                name="primeiraNoite"
                type="date"
                defaultValue={v("primeiraNoite") || hoje}
                required
              />
              <Erro campo="primeiraNoite" state={state} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ultimaNoite">Última noite</Label>
              <Input
                id="ultimaNoite"
                name="ultimaNoite"
                type="date"
                defaultValue={v("ultimaNoite") || hoje}
                required
              />
              <Erro campo="ultimaNoite" state={state} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="motivo">Motivo</Label>
            <select
              id="motivo"
              name="motivo"
              key={`motivo-${v("motivo")}`}
              defaultValue={v("motivo") || "MAINTENANCE"}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
            >
              {MOTIVOS_BLOQUEIO.map((m) => (
                <option key={m} value={m}>
                  {MOTIVO_LABELS[m]}
                </option>
              ))}
            </select>
            <Erro campo="motivo" state={state} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="observacao">Observação</Label>
            <Input
              id="observacao"
              name="observacao"
              defaultValue={v("observacao")}
              placeholder="Pintura da sala, revisão hidráulica…"
            />
            <Erro campo="observacao" state={state} />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              Bloquear
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
