"use client";

import { useActionState, useState } from "react";
import { AlertCircle, Banknote } from "lucide-react";
import {
  registrarPagamentoAction,
  type AcaoReservaState,
} from "@/app/(dashboard)/reservas/[id]/actions";
import { hojeUtc, toDateOnly } from "@/lib/dates";
import { centsToInput, formatMoney } from "@/lib/money";
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

export type OpcaoDeSelecao = { valor: string; rotulo: string };

/**
 * `crypto.randomUUID` só existe em contexto seguro (https ou localhost).
 * A alternativa não precisa ser criptográfica: a chave só distingue uma
 * abertura do diálogo das outras, e a unicidade de verdade é garantida
 * pela constraint `(tenantId, idempotencyKey)` no banco.
 */
function novaChaveDeIdempotencia(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `manual-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Baixa manual de pagamento (UC-050): dinheiro que entrou fora da
 * plataforma — espécie, pix, transferência.
 *
 * Não há campo de cartão aqui, e nunca haverá: PAN, CVV e validade não
 * entram no sistema (RN-009). "Maquininha" registra que o meio foi cartão,
 * não os dados dele.
 *
 * As opções de meio e de natureza chegam prontas do servidor, em vez de
 * serem redigitadas aqui, porque a lista canônica vive em
 * `@/lib/reservations/schemas` — módulo que não atravessa a fronteira para
 * o cliente.
 */
export function PagamentoManualDialog({
  reservaId,
  saldoCents,
  currency,
  meios,
  intencoes,
}: {
  reservaId: string;
  saldoCents: number;
  currency: string;
  meios: OpcaoDeSelecao[];
  intencoes: OpcaoDeSelecao[];
}) {
  const [aberto, setAberto] = useState(false);
  /**
   * Chave de idempotência: uma por abertura do diálogo (RN-009). É o que
   * faz do duplo clique uma recusa clara em vez de dois pagamentos. Uma
   * tentativa recusada por validação mantém a mesma chave — nada foi
   * gravado, então repetir com ela é exatamente o que se quer.
   */
  const [chave, setChave] = useState("");

  const [state, formAction, pending] = useActionState<
    AcaoReservaState | undefined,
    FormData
  >(registrarPagamentoAction, undefined);

  const [ultimoOk, setUltimoOk] = useState(false);
  if (state?.ok && !ultimoOk) {
    setUltimoOk(true);
    setAberto(false);
  }
  if (!state?.ok && ultimoOk) setUltimoOk(false);

  function alternar(proximo: boolean) {
    // Chave nova a cada abertura; a anterior morre com o diálogo.
    if (proximo) setChave(novaChaveDeIdempotencia());
    setAberto(proximo);
  }

  const erro = (campo: string) => state?.fieldErrors?.[campo]?.join(" ");
  const v = (campo: string) => state?.values?.[campo] ?? "";

  return (
    <Dialog open={aberto} onOpenChange={alternar}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Banknote />
          Registrar pagamento
        </Button>
      </DialogTrigger>

      <DialogContent>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="reservaId" value={reservaId} />
          <input type="hidden" name="idempotencyKey" value={chave} />

          <DialogHeader>
            <DialogTitle>Registrar pagamento</DialogTitle>
            <DialogDescription>
              {saldoCents > 0
                ? `Saldo devedor: ${formatMoney(saldoCents, currency)}. Quitar o total confirma a reserva automaticamente.`
                : "Esta reserva já está quitada. Só caução e extras aceitam valor além do total."}
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
              <Label htmlFor="valor">Valor recebido</Label>
              <Input
                id="valor"
                name="valor"
                inputMode="decimal"
                required
                defaultValue={v("valor") || centsToInput(saldoCents)}
                placeholder="1.250,00"
                aria-invalid={erro("valor") ? true : undefined}
              />
              {erro("valor") && (
                <p className="text-xs text-destructive" role="alert">
                  {erro("valor")}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="recebidoEm">Recebido em</Label>
              <Input
                id="recebidoEm"
                name="recebidoEm"
                type="date"
                defaultValue={v("recebidoEm") || toDateOnly(hojeUtc())}
                aria-invalid={erro("recebidoEm") ? true : undefined}
              />
              {erro("recebidoEm") && (
                <p className="text-xs text-destructive" role="alert">
                  {erro("recebidoEm")}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="meio">Meio</Label>
              <select
                id="meio"
                name="meio"
                key={`meio-${v("meio")}`}
                defaultValue={v("meio") || "PIX"}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
              >
                {meios.map((m) => (
                  <option key={m.valor} value={m.valor}>
                    {m.rotulo}
                  </option>
                ))}
              </select>
              {erro("meio") && (
                <p className="text-xs text-destructive" role="alert">
                  {erro("meio")}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="intencao">Natureza</Label>
              <select
                id="intencao"
                name="intencao"
                key={`intencao-${v("intencao")}`}
                defaultValue={v("intencao") || "BALANCE"}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
              >
                {intencoes.map((i) => (
                  <option key={i.valor} value={i.valor}>
                    {i.rotulo}
                  </option>
                ))}
              </select>
              {erro("intencao") && (
                <p className="text-xs text-destructive" role="alert">
                  {erro("intencao")}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="descricao">Observação</Label>
            <Input
              id="descricao"
              name="descricao"
              defaultValue={v("descricao")}
              placeholder="Pix recebido na conta da administradora, comprovante 4471…"
              aria-invalid={erro("descricao") ? true : undefined}
            />
            {erro("descricao") && (
              <p className="text-xs text-destructive" role="alert">
                {erro("descricao")}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setAberto(false)}
            >
              Fechar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              Registrar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
