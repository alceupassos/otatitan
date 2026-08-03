"use client";

import {
  diaDaSemanaCurto,
  diasNoIntervalo,
  ehFimDeSemana,
  parseDateOnly,
  toDateOnly,
} from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

type Tarifa = {
  ratePlanId: string;
  data: string;
  priceCents: number;
  minNights: number | null;
  isClosed: boolean;
  closedToArrival: boolean;
  closedToDeparture: boolean;
};

/**
 * Grade plano × dia com os preços publicados.
 *
 * Uma célula VAZIA não é "grátis": é noite sem tarifa, portanto
 * indisponível (RN-011). Por isso o vazio é marcado com "—" e explicado na
 * legenda, em vez de ficar em branco — branco parece "sem restrição".
 */
export function GradeTarifas({
  inicio,
  fim,
  hoje,
  currency,
  planos,
  tarifas,
}: {
  inicio: string;
  fim: string;
  hoje: string;
  currency: string;
  planos: { id: string; name: string; code: string }[];
  tarifas: Tarifa[];
}) {
  const dias = diasNoIntervalo(parseDateOnly(inicio), parseDateOnly(fim));

  // Índice (plano, data) → tarifa.
  const indice = new Map<string, Tarifa>();
  for (const t of tarifas) indice.set(`${t.ratePlanId}|${t.data}`, t);

  if (planos.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Crie um plano de tarifa para publicar diárias.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-10 min-w-40 border-b border-r bg-background p-2 text-left font-medium"
              >
                Plano
              </th>
              {dias.map((d) => {
                const chave = toDateOnly(d);
                return (
                  <th
                    key={chave}
                    scope="col"
                    className={cn(
                      "min-w-16 border-b border-l p-1 text-center text-xs font-normal",
                      ehFimDeSemana(d) && "bg-muted/50",
                      chave === hoje && "bg-primary/10 font-semibold",
                    )}
                  >
                    <div className="text-muted-foreground">{diaDaSemanaCurto(d)}</div>
                    <div>{d.getUTCDate()}</div>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {planos.map((p) => (
              <tr key={p.id}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 border-b border-r bg-background p-2 text-left font-normal"
                >
                  <div className="truncate font-medium">{p.name}</div>
                  <div className="text-xs text-muted-foreground">{p.code}</div>
                </th>

                {dias.map((d) => {
                  const chave = toDateOnly(d);
                  const t = indice.get(`${p.id}|${chave}`);
                  const fds = ehFimDeSemana(d);

                  if (!t) {
                    return (
                      <td
                        key={chave}
                        title="Sem tarifa publicada — noite indisponível"
                        className={cn(
                          "border-b border-l p-1 text-center text-xs text-muted-foreground/50",
                          fds && "bg-muted/40",
                        )}
                      >
                        —
                      </td>
                    );
                  }

                  return (
                    <td
                      key={chave}
                      title={[
                        formatMoney(t.priceCents, currency),
                        t.minNights !== null ? `mín. ${t.minNights} noites` : null,
                        t.isClosed ? "fechado para venda" : null,
                        t.closedToArrival ? "sem chegada" : null,
                        t.closedToDeparture ? "sem saída" : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                      className={cn(
                        "border-b border-l p-1 text-center text-xs tabular-nums",
                        fds && "bg-muted/40",
                        t.isClosed && "bg-destructive/10 text-muted-foreground line-through",
                      )}
                    >
                      {(t.priceCents / 100).toLocaleString("pt-BR", {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 0,
                      })}
                      {(t.closedToArrival || t.closedToDeparture) && (
                        <span className="ml-0.5 text-amber-600" aria-hidden="true">
                          •
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span>Valores em {currency}, sem centavos — passe o mouse para o detalhe.</span>
        <span className="flex items-center gap-1.5">
          <span className="text-muted-foreground/50">—</span> sem tarifa (indisponível)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-sm bg-destructive/20" /> fechado
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-amber-600">•</span> restrição de chegada/saída
        </span>
      </div>
    </div>
  );
}
