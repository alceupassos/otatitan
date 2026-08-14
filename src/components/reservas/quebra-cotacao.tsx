import { Info, Lock } from "lucide-react";
import { diaDaSemanaCurto, parseDateOnly } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { contar } from "@/lib/plural";
import type { NoiteCotada } from "@/lib/pricing/quote";
import { VERSAO_COTACAO } from "@/lib/pricing/quote";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatarDia, formatarInstante } from "./formato";

/**
 * A conta que foi feita NO DIA DA VENDA (RN-003).
 *
 * Nada aqui é recotado: `quoteSnapshot` é o preço congelado, e é ele que
 * responde ao hóspede que questionar a cobrança meses depois. Mostrar a
 * tarifa publicada hoje no lugar do que foi cobrado seria mentir sobre o
 * que a pessoa pagou — e a tarifa de temporada muda toda semana.
 */

type Numerico = number | null;

function num(valor: unknown): Numerico {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : null;
}

function str(valor: unknown): string | null {
  return typeof valor === "string" && valor !== "" ? valor : null;
}

export type CotacaoCongelada = {
  versao: Numerico;
  cotadaEm: string | null;
  ratePlanCode: string | null;
  noites: NoiteCotada[];
  nightlyTotalCents: Numerico;
  feesTotalCents: Numerico;
  taxesTotalCents: Numerico;
  discountsTotalCents: Numerico;
  totalCents: Numerico;
  cleaningFeeIncluso: boolean;
  cancellationPolicy: string | null;
};

/**
 * Lê o JSON gravado na coluna sem confiar nele.
 *
 * A coluna é `Json`: pode guardar um snapshot de uma versão anterior do
 * motor de cotação, ou nada, se a reserva veio de uma importação. Ler
 * campo a campo e devolver `null` no que não bater é o que impede uma
 * reserva antiga de derrubar a tela do operador.
 */
export function lerCotacaoCongelada(valor: unknown): CotacaoCongelada | null {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return null;
  const s = valor as Record<string, unknown>;

  const noites: NoiteCotada[] = [];
  if (Array.isArray(s.noites)) {
    for (const bruta of s.noites) {
      if (!bruta || typeof bruta !== "object") continue;
      const n = bruta as Record<string, unknown>;
      const data = str(n.data);
      const preco = num(n.priceCents);
      if (data !== null && preco !== null) noites.push({ data, priceCents: preco });
    }
  }

  return {
    versao: num(s.versao),
    cotadaEm: str(s.cotadaEm),
    ratePlanCode: str(s.ratePlanCode),
    noites,
    nightlyTotalCents: num(s.nightlyTotalCents),
    feesTotalCents: num(s.feesTotalCents),
    taxesTotalCents: num(s.taxesTotalCents),
    discountsTotalCents: num(s.discountsTotalCents),
    totalCents: num(s.totalCents),
    cleaningFeeIncluso: s.cleaningFeeIncluso === true,
    cancellationPolicy: str(s.cancellationPolicy),
  };
}

type Reserva = {
  currency: string;
  nights: number;
  nightlyTotalCents: number;
  feesTotalCents: number;
  taxesTotalCents: number;
  discountsTotalCents: number;
  totalCents: number;
};

function Linha({
  rotulo,
  valorCents,
  currency,
  destaque,
  nota,
}: {
  rotulo: string;
  valorCents: number;
  currency: string;
  destaque?: boolean;
  nota?: string;
}) {
  return (
    <div
      className={
        destaque
          ? "flex items-baseline justify-between gap-4 border-t pt-2 text-base font-medium"
          : "flex items-baseline justify-between gap-4 text-sm"
      }
    >
      <span className={destaque ? undefined : "text-muted-foreground"}>
        {rotulo}
        {nota && <span className="ml-1 text-xs text-muted-foreground">({nota})</span>}
      </span>
      <span className="tabular-nums">{formatMoney(valorCents, currency)}</span>
    </div>
  );
}

export function QuebraDaCotacao({
  snapshot,
  reserva,
  ratePlan,
}: {
  snapshot: unknown;
  reserva: Reserva;
  ratePlan: { code: string; name: string } | null;
}) {
  const congelada = lerCotacaoCongelada(snapshot);
  const moeda = reserva.currency;

  // Os totais gravados nas colunas da reserva vieram DESTA mesma cotação
  // (são escritos na mesma transação), então servem de fallback fiel
  // quando o snapshot não pôde ser lido.
  const diarias = congelada?.nightlyTotalCents ?? reserva.nightlyTotalCents;
  const taxas = congelada?.feesTotalCents ?? reserva.feesTotalCents;
  const impostos = congelada?.taxesTotalCents ?? reserva.taxesTotalCents;
  const descontos = congelada?.discountsTotalCents ?? reserva.discountsTotalCents;
  const total = congelada?.totalCents ?? reserva.totalCents;

  const versaoDoSnapshot = congelada?.versao ?? null;
  const versaoAntiga =
    versaoDoSnapshot !== null && versaoDoSnapshot !== VERSAO_COTACAO;

  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Lock className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Preço congelado no fechamento da venda — é o que foi cobrado, não a
          tarifa de hoje.
          {congelada?.cotadaEm &&
            ` Cotado em ${formatarInstante(new Date(congelada.cotadaEm))}.`}
          {ratePlan && ` Plano ${ratePlan.name} (${ratePlan.code}).`}
        </span>
      </p>

      {versaoAntiga && (
        <Alert>
          <Info />
          <AlertDescription>
            Esta reserva foi cotada pela versão {versaoDoSnapshot} do motor de
            preços; a versão atual é a {VERSAO_COTACAO}. Os valores abaixo são
            os do fechamento e continuam válidos.
          </AlertDescription>
        </Alert>
      )}

      {congelada && congelada.noites.length > 0 ? (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Noite</TableHead>
                <TableHead className="text-right">Diária</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {congelada.noites.map((n) => (
                <TableRow key={n.data}>
                  <TableCell>
                    {formatarDia(n.data)}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {diaDaSemanaCurto(parseDateOnly(n.data))}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(n.priceCents, moeda)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <Alert>
          <Info />
          <AlertDescription>
            A quebra noite a noite não está disponível para esta reserva. Os
            totais abaixo são os gravados no fechamento.
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-1.5">
        <Linha
          rotulo={`Diárias (${contar(reserva.nights, "noite")})`}
          valorCents={diarias}
          currency={moeda}
        />
        <Linha
          rotulo="Taxa de limpeza"
          valorCents={taxas}
          currency={moeda}
          nota={
            congelada?.cleaningFeeIncluso
              ? "já embutida na diária do plano"
              : undefined
          }
        />
        {impostos !== 0 && (
          <Linha rotulo="Impostos" valorCents={impostos} currency={moeda} />
        )}
        {descontos !== 0 && (
          <Linha rotulo="Descontos" valorCents={-descontos} currency={moeda} />
        )}
        <Linha rotulo="Total" valorCents={total} currency={moeda} destaque />
      </div>

      {congelada?.cancellationPolicy && (
        <p className="text-xs text-muted-foreground">
          Política de cancelamento vigente na venda:{" "}
          {congelada.cancellationPolicy}.
        </p>
      )}
    </div>
  );
}
