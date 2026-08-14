import Link from "next/link";
import { formatMoney } from "@/lib/money";
import { contar } from "@/lib/plural";
import type { ReservaDaLista } from "@/lib/reservations/queries";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatarDia } from "./formato";
import { HoldRestante } from "./hold-restante";
import { StatusReserva } from "./status-reserva";

/**
 * Lista de reservas.
 *
 * `agoraMs` chega da página, um único instante para a tela inteira: se
 * cada linha lesse o próprio relógio, duas reservas criadas no mesmo
 * segundo poderiam mostrar contagens diferentes sem motivo.
 */
export function TabelaDeReservas({
  itens,
  agoraMs,
}: {
  itens: ReservaDaLista[];
  agoraMs: number;
}) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Código</TableHead>
            <TableHead>Hóspede</TableHead>
            <TableHead>Unidade</TableHead>
            <TableHead>Estadia</TableHead>
            <TableHead>Situação</TableHead>
            <TableHead className="text-right">Recebido</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {itens.map((r) => {
            const saldo = r.saldoCents;
            // Só reserva pendente segura data por tempo limitado: nos demais
            // status o campo é resíduo e não deve virar contagem na tela.
            const holdExpiraEm = r.status === "PENDING" ? r.holdExpiresAt : null;

            return (
              <TableRow key={r.id}>
                <TableCell>
                  <Link
                    href={`/reservas/${r.id}`}
                    className="font-mono font-medium underline-offset-4 hover:underline"
                  >
                    {r.codigoFormatado}
                  </Link>
                </TableCell>

                <TableCell>{r.hospedeNome}</TableCell>

                <TableCell>
                  {r.unidade}
                  <div className="text-xs text-muted-foreground">{r.imovel}</div>
                </TableCell>

                <TableCell className="whitespace-nowrap">
                  {formatarDia(r.checkIn)} → {formatarDia(r.checkOut)}
                  <div className="text-xs text-muted-foreground">
                    {contar(r.nights, "noite")} · {contar(r.hospedes, "hóspede")}
                  </div>
                </TableCell>

                <TableCell>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusReserva status={r.status} />
                    {holdExpiraEm && (
                      <HoldRestante
                        restanteSegundos={Math.round(
                          (holdExpiraEm.getTime() - agoraMs) / 1000,
                        )}
                      />
                    )}
                  </div>
                </TableCell>

                <TableCell className="text-right tabular-nums whitespace-nowrap">
                  {formatMoney(r.paidCents, r.currency)}
                  <div className="text-xs text-muted-foreground">
                    {saldo > 0
                      ? `de ${formatMoney(r.totalCents, r.currency)}`
                      : "quitada"}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
