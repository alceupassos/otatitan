"use client";

import { CalendarX2, CircleAlert, Home, Lock } from "lucide-react";
import { formatMoney } from "@/lib/money";
import { contar } from "@/lib/plural";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatarDia } from "@/components/reservas/formato";
import type { ResultadoBuscaUI, UnidadeVendavelUI } from "./actions";
import { ORIGEM_OCUPACAO_LABELS } from "./tipos";

/**
 * Passo 2 — o que dá para vender e, com o mesmo destaque, o que não dá.
 *
 * Esconder a unidade recusada transformaria uma explicação acionável
 * ("falta a tarifa de 12/03") num mistério ("não tem nada disponível"). O
 * motor de cotação já devolve o motivo tipado com a data que o causou
 * (RN-011, RN-012); aqui a tela só o mostra, sem reescrever a regra.
 */

/** Quantos motivos de recusa cabem antes de virar ruído. */
const MAX_MOTIVOS = 4;

export function PassoResultado({
  resultado,
  unidadeSelecionada,
  onSelecionar,
}: {
  resultado: ResultadoBuscaUI;
  unidadeSelecionada: string | null;
  onSelecionar: (unidade: UnidadeVendavelUI) => void;
}) {
  const { vendaveis, recusadas, ocupadas, nights } = resultado;
  const nenhuma =
    vendaveis.length === 0 && recusadas.length === 0 && ocupadas.length === 0;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        {formatarDia(resultado.checkIn)} até {formatarDia(resultado.checkOut)} ·{" "}
        {contar(nights, "noite")} · {contar(resultado.hospedes, "hóspede")}
      </p>

      {nenhuma && (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Nenhuma unidade no escopo desta busca. Confira se o imóvel está
          ativo e se ele tem unidades ativas cadastradas.
        </div>
      )}

      {vendaveis.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">
            Disponíveis para venda ({vendaveis.length})
          </h3>
          <ul className="space-y-3">
            {vendaveis.map((u) => (
              <CartaoVendavel
                key={u.unitId}
                unidade={u}
                selecionada={u.unitId === unidadeSelecionada}
                onSelecionar={() => onSelecionar(u)}
              />
            ))}
          </ul>
        </section>
      )}

      {recusadas.length > 0 && (
        <section className="space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <CircleAlert className="size-4 text-amber-600" />
            Livres, mas não vendáveis ({recusadas.length})
          </h3>
          <p className="text-xs text-muted-foreground">
            Estas unidades estão desocupadas no período. O que falta é
            cadastro — corrija o que está apontado e elas voltam à oferta.
          </p>
          <ul className="space-y-3">
            {recusadas.map((u) => (
              <li
                key={u.unitId}
                className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-900/50 dark:bg-amber-950/20"
              >
                <div className="flex items-baseline gap-2">
                  <span className="font-medium">{u.internalCode}</span>
                  <span className="text-sm text-muted-foreground">
                    {u.unitName} · {u.propertyName}
                  </span>
                </div>
                <ul className="mt-2 space-y-1">
                  {u.recusas.slice(0, MAX_MOTIVOS).map((r, i) => (
                    <li key={`${r.codigo}-${r.data}-${i}`} className="text-sm">
                      {r.mensagem}
                    </li>
                  ))}
                </ul>
                {u.recusas.length > MAX_MOTIVOS && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    e mais {u.recusas.length - MAX_MOTIVOS} noite(s) na mesma
                    situação.
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {ocupadas.length > 0 && (
        <section className="space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Lock className="size-4 text-muted-foreground" />
            Ocupadas no período ({ocupadas.length})
          </h3>
          <ul className="space-y-2">
            {ocupadas.map((u) => (
              <li
                key={u.unitId}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg border p-3 text-sm"
              >
                <CalendarX2 className="size-4 text-muted-foreground" />
                <span className="font-medium">{u.internalCode}</span>
                <span className="text-muted-foreground">
                  {u.propertyName} — {ORIGEM_OCUPACAO_LABELS[u.origem]} a partir
                  de {formatarDia(u.primeiraNoiteOcupada)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function CartaoVendavel({
  unidade,
  selecionada,
  onSelecionar,
}: {
  unidade: UnidadeVendavelUI;
  selecionada: boolean;
  onSelecionar: () => void;
}) {
  const { cotacao } = unidade;
  // Diária média sobre as noites, em aritmética inteira: é o número que o
  // atendente diz ao telefone, e ele não pode divergir do total por causa
  // de um arredondamento em ponto flutuante (RN-006).
  const mediaCents = Math.round(cotacao.nightlyTotalCents / cotacao.nights);

  return (
    <li
      className={`rounded-lg border p-4 ${
        selecionada ? "border-primary ring-1 ring-primary" : ""
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-48 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{unidade.internalCode}</span>
            <span className="text-sm text-muted-foreground">
              {unidade.unitName}
            </span>
            {selecionada && <Badge variant="secondary">Selecionada</Badge>}
          </div>
          <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            <Home className="size-3" />
            {unidade.propertyName} · acomoda até{" "}
            {contar(unidade.maxGuests, "hóspede")}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Plano {cotacao.ratePlanName} ({cotacao.ratePlanCode})
            {cotacao.cleaningFeeIncluso
              ? " · limpeza incluída na diária"
              : cotacao.feesTotalCents > 0
                ? ` · limpeza ${formatMoney(cotacao.feesTotalCents, cotacao.currency)}`
                : ""}
          </div>
        </div>

        <div className="text-right">
          <div className="font-heading text-lg font-semibold">
            {formatMoney(cotacao.totalCents, cotacao.currency)}
          </div>
          <div className="text-xs text-muted-foreground">
            {formatMoney(mediaCents, cotacao.currency)} / noite em média
          </div>
        </div>

        <Button
          type="button"
          variant={selecionada ? "secondary" : "default"}
          onClick={onSelecionar}
        >
          {selecionada ? "Selecionada" : "Selecionar"}
        </Button>
      </div>
    </li>
  );
}
