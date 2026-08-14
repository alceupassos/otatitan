"use client";

import { useActionState, useState } from "react";
import { AlertCircle, Ban } from "lucide-react";
import {
  cancelarReservaAction,
  type AcaoReservaState,
} from "@/app/(dashboard)/reservas/[id]/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

/**
 * Cancelamento (RN-005) — destrutivo o bastante para exigir confirmação
 * explícita e um motivo escrito.
 *
 * O motivo é obrigatório porque é ele que responde, meses depois, por que
 * aquelas datas voltaram ao calendário; sem ele o histórico registra que
 * a venda caiu, mas não o que aconteceu.
 *
 * O botão de confirmar é um `submit` comum, e não `AlertDialogAction`:
 * este último fecha o diálogo no clique, e a recusa do servidor (motivo
 * curto demais, transição inválida) apareceria com o formulário já sumido.
 */
export function CancelarReservaDialog({
  reservaId,
  codigoFormatado,
}: {
  reservaId: string;
  codigoFormatado: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [state, formAction, pending] = useActionState<
    AcaoReservaState | undefined,
    FormData
  >(cancelarReservaAction, undefined);

  // Fecha ao concluir. Ajuste durante o render (não em efeito): reagimos
  // a estado do React, não a sistema externo.
  const [ultimoOk, setUltimoOk] = useState(false);
  if (state?.ok && !ultimoOk) {
    setUltimoOk(true);
    setAberto(false);
  }
  if (!state?.ok && ultimoOk) setUltimoOk(false);

  const erroDoMotivo = state?.fieldErrors?.motivo?.join(" ");

  return (
    <AlertDialog open={aberto} onOpenChange={setAberto}>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm">
          <Ban />
          Cancelar reserva
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="reservaId" value={reservaId} />

          <AlertDialogHeader>
            <AlertDialogTitle>
              Cancelar a reserva {codigoFormatado}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              As datas voltam ao calendário e as tarefas em aberto desta
              estadia são canceladas. A reserva não é apagada: fica no
              histórico como cancelada, com o motivo abaixo.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {state?.error && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="motivo">Motivo do cancelamento</Label>
            <Textarea
              id="motivo"
              name="motivo"
              required
              minLength={3}
              maxLength={300}
              defaultValue={state?.values?.motivo ?? ""}
              placeholder="Desistência do hóspede, pagamento não confirmado, erro de lançamento…"
              aria-invalid={erroDoMotivo ? true : undefined}
            />
            {erroDoMotivo && (
              <p className="text-xs text-destructive" role="alert">
                {erroDoMotivo}
              </p>
            )}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel type="button">Voltar</AlertDialogCancel>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending && <Spinner />}
              Cancelar reserva
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
