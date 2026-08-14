import { ExternalLink, Wallet } from "lucide-react";
import type {
  PaymentIntentKind,
  PaymentMethod,
  PaymentProviderKey,
  PaymentStatus,
} from "@/generated/prisma/enums";
import { formatMoney } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatarInstante } from "./formato";
import {
  INTENCAO_LABELS,
  MEIO_LABELS,
  PAGAMENTO_STATUS_LABELS,
  PAGAMENTO_STATUS_VARIANTE,
  PROVEDOR_LABELS,
} from "./rotulos";

export type PagamentoDaReserva = {
  id: string;
  provider: PaymentProviderKey;
  method: PaymentMethod;
  intent: PaymentIntentKind;
  status: PaymentStatus;
  amountCents: number;
  currency: string;
  cardBrand: string | null;
  cardLast4: string | null;
  receiptUrl: string | null;
  description: string | null;
  failureMessage: string | null;
  paidAt: Date | null;
  createdAt: Date;
};

/**
 * Extrato da reserva.
 *
 * O saldo devedor vem calculado do domínio (`saldoDevedorCents`) e não da
 * soma das linhas desta tabela: `Reservation.paidCents` é a fonte de
 * verdade do quanto entrou, e refazer a conta aqui criaria uma segunda
 * resposta para a mesma pergunta.
 *
 * `cardLast4` e a bandeira são o MÁXIMO que existe sobre um cartão — o
 * número, o CVV e a validade nunca entram no sistema (RN-009).
 */
export function PagamentosDaReserva({
  pagamentos,
  currency,
  totalCents,
  paidCents,
  saldoCents,
}: {
  /** `null` quando o ator não tem `payments.view` — os totais ele já vê. */
  pagamentos: PagamentoDaReserva[] | null;
  currency: string;
  totalCents: number;
  paidCents: number;
  saldoCents: number;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <p className="text-xs text-muted-foreground">Total da reserva</p>
          <p className="tabular-nums">{formatMoney(totalCents, currency)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Recebido</p>
          <p className="tabular-nums">{formatMoney(paidCents, currency)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Saldo devedor</p>
          <p
            className={
              saldoCents > 0
                ? "font-medium tabular-nums text-destructive"
                : "font-medium tabular-nums"
            }
          >
            {saldoCents > 0 ? formatMoney(saldoCents, currency) : "Quitada"}
          </p>
        </div>
      </div>

      {pagamentos === null ? (
        <p className="text-sm text-muted-foreground">
          O extrato lançamento a lançamento exige permissão de pagamentos.
        </p>
      ) : pagamentos.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Wallet />
            </EmptyMedia>
            <EmptyTitle>Nenhum pagamento registrado</EmptyTitle>
            <EmptyDescription>
              Enquanto o total não entrar, a reserva não se confirma sozinha.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quando</TableHead>
                <TableHead>Natureza</TableHead>
                <TableHead>Meio</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="text-right">Valor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagamentos.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="whitespace-nowrap">
                    {formatarInstante(p.paidAt ?? p.createdAt)}
                    {!p.paidAt && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        (lançado)
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {INTENCAO_LABELS[p.intent]}
                    {p.description && (
                      <div className="text-xs text-muted-foreground">
                        {p.description}
                      </div>
                    )}
                    {p.failureMessage && (
                      <div className="text-xs text-destructive">
                        {p.failureMessage}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {MEIO_LABELS[p.method]}
                    {p.cardLast4 && ` ${p.cardBrand ?? ""} ••${p.cardLast4}`}
                    <div className="text-xs">{PROVEDOR_LABELS[p.provider]}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={PAGAMENTO_STATUS_VARIANTE[p.status]}>
                      {PAGAMENTO_STATUS_LABELS[p.status]}
                    </Badge>
                    {p.receiptUrl && (
                      <a
                        href={p.receiptUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 flex items-center gap-1 text-xs underline-offset-4 hover:underline"
                      >
                        <ExternalLink className="size-3" />
                        Comprovante
                      </a>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(p.amountCents, p.currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
