"use client";

import { useActionState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  DoorClosed,
  DoorOpen,
  Link as LinkIcon,
} from "lucide-react";
import {
  abrirCobrancaAction,
  transicionarReservaAction,
  type AcaoReservaState,
} from "@/app/(dashboard)/reservas/[id]/actions";
import type { ReservationStatus } from "@/generated/prisma/enums";
import { podeTransicionar } from "@/lib/reservations/estados";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { CancelarReservaDialog } from "./cancelar-reserva-dialog";
import {
  PagamentoManualDialog,
  type OpcaoDeSelecao,
} from "./pagamento-manual-dialog";

/**
 * Barra de ações do detalhe da reserva.
 *
 * Um botão só aparece quando as DUAS condições valem: a máquina de estados
 * permite a transição (`podeTransicionar`, `estados.ts`) e o ator tem a
 * permissão. Esconder é conveniência, não segurança — quem chamar a action
 * na mão continua sendo barrado pelo domínio, que confere permissão e
 * transição junto ao dado.
 *
 * Confirmar, check-in e check-out compartilham um formulário só: cada
 * botão é um `submit` que envia o próprio `name="acao"`. Assim há um único
 * lugar de estado, e a tela não fica com três regiões de erro concorrendo.
 */
export function AcoesReserva({
  reservaId,
  codigoFormatado,
  status,
  saldoCents,
  currency,
  permissoes,
  meiosPagamento,
  intencoes,
}: {
  reservaId: string;
  codigoFormatado: string;
  status: ReservationStatus;
  saldoCents: number;
  currency: string;
  permissoes: { editar: boolean; cancelar: boolean; pagar: boolean };
  meiosPagamento: OpcaoDeSelecao[];
  intencoes: OpcaoDeSelecao[];
}) {
  const [state, formAction, pending] = useActionState<
    AcaoReservaState | undefined,
    FormData
  >(transicionarReservaAction, undefined);

  const [cobrancaState, cobrancaAction, cobrancaPending] = useActionState<
    AcaoReservaState | undefined,
    FormData
  >(abrirCobrancaAction, undefined);

  const podeConfirmar = permissoes.editar && podeTransicionar(status, "CONFIRMED");
  const podeCheckIn = permissoes.editar && podeTransicionar(status, "CHECKED_IN");
  const podeCheckOut = permissoes.editar && podeTransicionar(status, "CHECKED_OUT");
  const podeCancelar = permissoes.cancelar && podeTransicionar(status, "CANCELLED");

  // Registrar dinheiro numa reserva que não vai acontecer é quase sempre
  // erro de digitação — o domínio recusa, e a tela nem oferece.
  const podePagar =
    permissoes.pagar && status !== "CANCELLED" && status !== "NO_SHOW";

  /**
   * Cobrar por link exige, além da permissão, um saldo devedor de verdade:
   * `abrirCobranca` recusa saldo zero, e oferecer o botão numa reserva
   * quitada só produziria uma recusa na cara de quem clicou.
   *
   * O prazo do hold não é conferido aqui de propósito. Ele corre entre a
   * renderização e o clique, e um botão que some sozinho na tela seria pior
   * que a recusa explicando que a reserva venceu — que é o que o domínio
   * devolve (RN-004).
   */
  const podeCobrarPorLink = podePagar && saldoCents > 0;

  const temAlgo =
    podeConfirmar ||
    podeCheckIn ||
    podeCheckOut ||
    podeCancelar ||
    podePagar ||
    podeCobrarPorLink;

  if (!temAlgo) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhuma ação disponível para esta reserva no estado atual.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(podeConfirmar || podeCheckIn || podeCheckOut) && (
          <form action={formAction} className="flex flex-wrap gap-2">
            <input type="hidden" name="reservaId" value={reservaId} />

            {podeConfirmar && (
              <Button type="submit" name="acao" value="confirmar" size="sm" disabled={pending}>
                {pending ? <Spinner /> : <CheckCircle2 />}
                Confirmar
              </Button>
            )}
            {podeCheckIn && (
              <Button
                type="submit"
                name="acao"
                value="check-in"
                size="sm"
                disabled={pending}
              >
                {pending ? <Spinner /> : <DoorOpen />}
                Registrar check-in
              </Button>
            )}
            {podeCheckOut && (
              <Button
                type="submit"
                name="acao"
                value="check-out"
                size="sm"
                disabled={pending}
              >
                {pending ? <Spinner /> : <DoorClosed />}
                Registrar check-out
              </Button>
            )}
          </form>
        )}

        {podeCobrarPorLink && (
          <form action={cobrancaAction}>
            <input type="hidden" name="reservaId" value={reservaId} />
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              disabled={cobrancaPending}
            >
              {cobrancaPending ? <Spinner /> : <LinkIcon />}
              Cobrar por link
            </Button>
          </form>
        )}

        {podePagar && (
          <PagamentoManualDialog
            reservaId={reservaId}
            saldoCents={saldoCents}
            currency={currency}
            meios={meiosPagamento}
            intencoes={intencoes}
          />
        )}

        {podeCancelar && (
          <CancelarReservaDialog
            reservaId={reservaId}
            codigoFormatado={codigoFormatado}
          />
        )}
      </div>

      {/*
        A cobrança tem região de erro própria: no caminho feliz ela nem
        volta para cá (a action redireciona para o checkout), então o que
        aparece aqui é sempre uma recusa — saldo zerado, hold vencido ou
        provedor fora do ar — e misturá-la com o estado das transições
        deixaria a mensagem sumir no submit seguinte.
      */}
      {cobrancaState?.error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{cobrancaState.error}</AlertDescription>
        </Alert>
      )}

      {state?.error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      {state?.ok && state.mensagem && (
        <Alert>
          <CheckCircle2 />
          <AlertDescription>{state.mensagem}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
