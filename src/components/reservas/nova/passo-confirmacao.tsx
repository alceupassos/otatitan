"use client";

import { useActionState, useState } from "react";
import { AlertCircle, CircleAlert, Clock, TriangleAlert } from "lucide-react";
import { diaDaSemanaCurto, formatarData, parseDateOnly } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { contar } from "@/lib/plural";
import { MINUTOS_DE_HOLD } from "@/lib/reservations/estados";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { formatarDia } from "@/components/reservas/formato";
import {
  criarReservaAction,
  type EstadoNovaReserva,
  type UnidadeVendavelUI,
} from "./actions";
import type { FormaDeCobranca, HospedeValores } from "./tipos";

/**
 * Passo 4 — a conta, noite a noite, e a forma de cobrança.
 *
 * RN-003: o total daqui NÃO é o preço da reserva. Ele viaja como
 * `totalConferidoCents` só para o servidor detectar divergência; o valor
 * gravado é sempre o que ele recalcular dentro da transação. Se mudou, a
 * action volta com a cotação nova e esta tela exige um segundo clique —
 * ninguém é cobrado por um número que não viu.
 */

export function PassoConfirmacao({
  unidade,
  hospede,
  origens,
}: {
  unidade: UnidadeVendavelUI;
  hospede: HospedeValores;
  origens: { valor: string; label: string }[];
}) {
  const [state, formAction, pendente] = useActionState<
    EstadoNovaReserva | undefined,
    FormData
  >(criarReservaAction, undefined);

  // A cotação nova vem do servidor quando o preço mudou; a partir daí é
  // ELA que a tela mostra e que vai no `totalConferidoCents` do próximo
  // envio. Derivar (em vez de guardar em estado) garante que os dois
  // nunca fiquem em desacordo.
  const cotacao = state?.cotacaoNova ?? unidade.cotacao;
  const precoMudou = state?.cotacaoNova !== undefined;

  const [criancas, setCriancas] = useState(0);
  const [bebes, setBebes] = useState(0);
  // Padrão é o caminho que EXISTE. A cobrança por link ainda não tem action
  // de domínio (ver o campo abaixo), e deixá-la marcada por omissão faria
  // toda venda terminar num beco.
  const [cobranca, setCobranca] = useState<FormaDeCobranca>("manual");

  const adultos = cotacao.hospedes - criancas;

  return (
    <form action={formAction} className="space-y-6">
      {/* ── Divergência de preço (RN-003) ───────────────────────────── */}
      {precoMudou && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>O valor mudou desde a busca</AlertTitle>
          <AlertDescription>
            <p>
              A reserva <strong>não</strong> foi criada. O total era{" "}
              {state?.totalAnteriorCents !== undefined &&
                formatMoney(state.totalAnteriorCents, cotacao.currency)}{" "}
              e passou a ser{" "}
              <strong>{formatMoney(cotacao.totalCents, cotacao.currency)}</strong>
              . A quebra abaixo já está atualizada — confirme para cobrar o
              novo valor.
            </p>
          </AlertDescription>
        </Alert>
      )}

      {state?.error && !precoMudou && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      {state?.recusas && state.recusas.length > 0 && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>Esta unidade deixou de ser vendável</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-4">
              {state.recusas.map((r, i) => (
                <li key={`${r.codigo}-${r.data}-${i}`}>{r.mensagem}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {state?.ocupada && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>
            Refaça a busca para ver o que ainda está livre no período.
          </AlertDescription>
        </Alert>
      )}

      {/* ── Resumo da estadia ───────────────────────────────────────── */}
      <div className="rounded-lg border p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="font-medium">
              {unidade.internalCode} — {unidade.unitName}
            </div>
            <div className="text-sm text-muted-foreground">
              {unidade.propertyName}
            </div>
          </div>
          <div className="text-sm text-muted-foreground">
            {formatarDia(cotacao.checkIn)} até {formatarDia(cotacao.checkOut)} ·{" "}
            {contar(cotacao.nights, "noite")}
          </div>
        </div>

        <Separator className="my-3" />

        <ul className="space-y-1 text-sm">
          {cotacao.noites.map((n) => {
            const dia = parseDateOnly(n.data);
            return (
              <li key={n.data} className="flex justify-between gap-4">
                <span className="text-muted-foreground">
                  {diaDaSemanaCurto(dia)}, {formatarData(dia)}
                </span>
                <span className="tabular-nums">
                  {formatMoney(n.priceCents, cotacao.currency)}
                </span>
              </li>
            );
          })}
        </ul>

        <Separator className="my-3" />

        <dl className="space-y-1 text-sm">
          <Linha rotulo={`Diárias (${contar(cotacao.nights, "noite")})`}>
            {formatMoney(cotacao.nightlyTotalCents, cotacao.currency)}
          </Linha>

          {/* Quando o plano embute a limpeza, ela já está diluída na diária:
              somá-la de novo cobraria duas vezes. */}
          <Linha rotulo="Taxa de limpeza">
            {cotacao.cleaningFeeIncluso
              ? "incluída na diária"
              : formatMoney(cotacao.feesTotalCents, cotacao.currency)}
          </Linha>

          {cotacao.discountsTotalCents > 0 && (
            <Linha rotulo="Descontos">
              −{formatMoney(cotacao.discountsTotalCents, cotacao.currency)}
            </Linha>
          )}
          {cotacao.taxesTotalCents > 0 && (
            <Linha rotulo="Impostos">
              {formatMoney(cotacao.taxesTotalCents, cotacao.currency)}
            </Linha>
          )}

          <Separator className="my-2" />

          <div className="flex justify-between gap-4">
            <dt className="font-medium">Total</dt>
            <dd className="font-heading text-lg font-semibold tabular-nums">
              {formatMoney(cotacao.totalCents, cotacao.currency)}
            </dd>
          </div>
        </dl>

        <p className="mt-3 text-xs text-muted-foreground">
          Plano {cotacao.ratePlanName} ({cotacao.ratePlanCode}) · política de
          cancelamento: {cotacao.cancellationPolicy}
        </p>
      </div>

      {/* ── Composição dos hóspedes ─────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="criancas">Crianças</Label>
          <select
            id="criancas"
            name="criancas"
            value={criancas}
            onChange={(e) => setCriancas(Number(e.target.value))}
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
          >
            {Array.from({ length: cotacao.hospedes }, (_, i) => i).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          {/* O total de hóspedes é o que foi cotado e não muda aqui: mexer
              nele mudaria o preço, e o preço é o da tela acima. */}
          <p className="text-xs text-muted-foreground">
            {contar(adultos, "adulto")} dos {cotacao.hospedes} cotados.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="bebes">Bebês</Label>
          <Input
            id="bebes"
            name="bebes"
            type="number"
            min={0}
            value={bebes}
            onChange={(e) => setBebes(Math.max(0, Number(e.target.value) || 0))}
          />
          <p className="text-xs text-muted-foreground">
            Não contam contra a lotação nem alteram o preço.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="origem">Origem</Label>
          <select
            id="origem"
            name="origem"
            defaultValue="DIRECT"
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
          >
            {origens.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="guestNotes">Observações do hóspede</Label>
          <Textarea
            id="guestNotes"
            name="guestNotes"
            rows={3}
            placeholder="Chegada tarde da noite, berço, vaga extra…"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="internalNotes">Observações internas</Label>
          <Textarea
            id="internalNotes"
            name="internalNotes"
            rows={3}
            placeholder="Visível só para a equipe."
          />
        </div>
      </div>

      {/* ── Forma de cobrança ───────────────────────────────────────── */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Como será cobrado</legend>

        <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 has-checked:border-primary">
          <input
            type="radio"
            name="cobranca"
            value="manual"
            className="mt-1"
            checked={cobranca === "manual"}
            onChange={() => setCobranca("manual")}
          />
          <span className="text-sm">
            <span className="font-medium">Registrar pagamento manual</span>
            <span className="block text-muted-foreground">
              Dinheiro, pix ou transferência combinados fora da plataforma. A
              baixa é lançada na tela da reserva.
            </span>
          </span>
        </label>

        {/* Oferecer o link como escolha viável seria prometer um envio que
            não acontece: o adapter sabe abrir checkout, mas nenhuma action
            cria o `Payment` PENDING que ele cobraria. Fica visível e
            desabilitado — some quando a action existir. */}
        <label className="flex items-start gap-3 rounded-md border border-dashed p-3 opacity-60">
          <input
            type="radio"
            name="cobranca"
            value="link"
            className="mt-1"
            disabled
            checked={cobranca === "link"}
            onChange={() => setCobranca("link")}
          />
          <span className="text-sm">
            <span className="font-medium">
              Link de pagamento do provedor (indisponível nesta versão)
            </span>
            <span className="block text-muted-foreground">
              Nenhum dado de cartão trafegaria por aqui (RN-009), mas a
              cobrança hospedada ainda não é gerada pelo sistema.
            </span>
          </span>
        </label>
      </fieldset>

      <Alert>
        <Clock />
        <AlertDescription>
          A reserva nasce pendente e segura a unidade por {MINUTOS_DE_HOLD}{" "}
          minutos. Sem pagamento confirmado até lá, as datas voltam ao
          calendário automaticamente.
        </AlertDescription>
      </Alert>

      {/* ── Campos que o servidor revalida ──────────────────────────── */}
      <input type="hidden" name="unitId" value={unidade.unitId} />
      <input type="hidden" name="checkIn" value={cotacao.checkIn} />
      <input type="hidden" name="checkOut" value={cotacao.checkOut} />
      <input type="hidden" name="adultos" value={adultos} />
      {/* RN-003: só para conferência. O total gravado é o do servidor. */}
      <input
        type="hidden"
        name="totalConferidoCents"
        value={cotacao.totalCents}
      />
      <CamposDoHospede hospede={hospede} />

      {state?.fieldErrors && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Confira a ficha do hóspede</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-4">
              {Object.entries(state.fieldErrors).map(([campo, msgs]) => (
                <li key={campo}>{msgs.join(" ")}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <Button type="submit" disabled={pendente}>
        {pendente && <Spinner />}
        {precoMudou
          ? `Confirmar com o novo valor (${formatMoney(cotacao.totalCents, cotacao.currency)})`
          : `Criar reserva (${formatMoney(cotacao.totalCents, cotacao.currency)})`}
      </Button>
    </form>
  );
}

function Linha({
  rotulo,
  children,
}: {
  rotulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{rotulo}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  );
}

/**
 * A ficha do passo anterior, revalidada pelo `hospedeSchema` no servidor.
 *
 * `documentNumber` só é enviado quando o operador de fato digitou um: é o
 * número em claro, e o servidor o cifra antes de gravar
 * (docs/11-seguranca-lgpd.md).
 */
function CamposDoHospede({ hospede }: { hospede: HospedeValores }) {
  return (
    <>
      <input type="hidden" name="firstName" value={hospede.firstName} />
      <input type="hidden" name="lastName" value={hospede.lastName} />
      <input type="hidden" name="email" value={hospede.email} />
      <input type="hidden" name="phone" value={hospede.phone} />
      <input type="hidden" name="documentType" value={hospede.documentType} />
      {hospede.documentNumber !== "" && (
        <input
          type="hidden"
          name="documentNumber"
          value={hospede.documentNumber}
        />
      )}
      <input type="hidden" name="birthDate" value={hospede.birthDate} />
      <input type="hidden" name="nationality" value={hospede.nationality} />
      <input type="hidden" name="country" value={hospede.country} />
      <input type="hidden" name="notes" value={hospede.notes} />
      <input
        type="hidden"
        name="marketingOptIn"
        value={hospede.marketingOptIn ? "true" : ""}
      />
    </>
  );
}
