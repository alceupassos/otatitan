import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, Star } from "lucide-react";
import { requireActorWith } from "@/lib/auth/session";
import { definirPadraoAction } from "@/lib/rates/actions";
import { getUnidadeTarifas } from "@/lib/rates/queries";
import {
  POLITICA_LABELS,
  STATUS_PLANO_LABELS,
} from "@/lib/rates/schemas";
import {
  hojeUtc,
  inicioDoMes,
  inicioDoMesSeguinte,
  mesAnoLongo,
  toDateOnly,
  tryParseDateOnly,
} from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { contar } from "@/lib/plural";
import { hasPermission } from "@/lib/rbac/guard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { GradeTarifas } from "./grade-tarifas";
import { NovoPlanoButton } from "./novo-plano-button";
import { AplicarTarifasCard } from "./aplicar-tarifas";

type Params = {
  params: Promise<{ unitId: string }>;
  searchParams: Promise<{ mes?: string }>;
};

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { unitId } = await params;
  const actor = await requireActorWith("rates.view");
  const dados = await getUnidadeTarifas(actor, unitId, hojeUtc(), hojeUtc());
  return { title: dados ? `Tarifas — ${dados.unit.internalCode}` : "Tarifas" };
}

export default async function TarifasUnidadePage({ params, searchParams }: Params) {
  const { unitId } = await params;
  const { mes } = await searchParams;

  const actor = await requireActorWith("rates.view");

  const referencia = (mes && tryParseDateOnly(mes)) || hojeUtc();
  const inicio = inicioDoMes(referencia);
  const fim = inicioDoMesSeguinte(referencia);

  const [dados, podeCriar, podeEditar] = await Promise.all([
    getUnidadeTarifas(actor, unitId, inicio, fim),
    hasPermission(actor, "rates.create"),
    hasPermission(actor, "rates.edit"),
  ]);

  if (!dados) notFound();
  const { unit, planos, tarifas } = dados;

  const ativos = planos.filter((p) => p.status !== "ARCHIVED");
  const mesAnterior = toDateOnly(
    new Date(Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth() - 1, 1)),
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link
          href="/tarifas"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          Tarifas
        </Link>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          {unit.internalCode} — {unit.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          {unit.property.name} · estadia mínima da unidade:{" "}
          {contar(unit.minNights, "noite")}
          {unit.baseRateCents !== null &&
            ` · diária base ${formatMoney(unit.baseRateCents, unit.currency)}`}
        </p>
      </div>

      {/* ── Planos ─────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Planos de tarifa</CardTitle>
              <CardDescription>
                O plano padrão é o usado quando a reserva não especifica outro.
              </CardDescription>
            </div>
            {podeCriar && <NovoPlanoButton unitId={unit.id} temPlano={ativos.length > 0} />}
          </div>
        </CardHeader>

        <CardContent>
          {ativos.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Nenhum plano ainda. Sem plano ativo, a unidade não recebe reserva.
            </p>
          ) : (
            <ul className="divide-y">
              {ativos.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-48 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{p.name}</span>
                      {p.isDefault && (
                        <Badge variant="secondary" className="gap-1">
                          <Star className="size-3" />
                          Padrão
                        </Badge>
                      )}
                      {p.status !== "ACTIVE" && (
                        <Badge variant="outline">
                          {STATUS_PLANO_LABELS[p.status]}
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {p.code} · {POLITICA_LABELS[p.cancellationPolicy]} ·{" "}
                      mín. {contar(p.minNights, "noite")}
                      {p.maxNights !== null && `, máx. ${p.maxNights}`}
                      {p.includesCleaningFee && " · limpeza incluída"}
                    </div>
                  </div>

                  <div className="text-right text-xs text-muted-foreground">
                    {contar(p._count.dailyRates, "diária")} publicada
                    {p._count.dailyRates === 1 ? "" : "s"}
                  </div>

                  {podeEditar && !p.isDefault && (
                    <form action={definirPadraoAction}>
                      <input type="hidden" name="unitId" value={unit.id} />
                      <input type="hidden" name="planId" value={p.id} />
                      <Button type="submit" variant="outline" size="sm">
                        Tornar padrão
                      </Button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ── Editor em lote ─────────────────────────────────────────────── */}
      {podeEditar && ativos.length > 0 && (
        <AplicarTarifasCard
          unitId={unit.id}
          planos={ativos.map((p) => ({ id: p.id, name: p.name, code: p.code }))}
          mesVisivel={toDateOnly(inicio)}
        />
      )}

      {/* ── Grade do mês ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>Diárias publicadas</CardTitle>
            <div className="flex items-center gap-2">
              <Button asChild variant="outline" size="sm">
                <Link
                  href={`/tarifas/${unit.id}?mes=${mesAnterior}`}
                  aria-label="Mês anterior"
                >
                  <ChevronLeft />
                </Link>
              </Button>
              <span className="min-w-36 text-center text-sm font-medium first-letter:uppercase">
                {mesAnoLongo(inicio)}
              </span>
              <Button asChild variant="outline" size="sm">
                <Link
                  href={`/tarifas/${unit.id}?mes=${toDateOnly(fim)}`}
                  aria-label="Mês seguinte"
                >
                  <ChevronRight />
                </Link>
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <GradeTarifas
            inicio={toDateOnly(inicio)}
            fim={toDateOnly(fim)}
            hoje={toDateOnly(hojeUtc())}
            currency={unit.currency}
            planos={ativos.map((p) => ({ id: p.id, name: p.name, code: p.code }))}
            tarifas={tarifas.map((t) => ({
              ratePlanId: t.ratePlanId,
              data: toDateOnly(t.date),
              priceCents: t.priceCents,
              minNights: t.minNights,
              isClosed: t.isClosed,
              closedToArrival: t.closedToArrival,
              closedToDeparture: t.closedToDeparture,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
