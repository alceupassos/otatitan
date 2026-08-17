import type { Metadata } from "next";
import Link from "next/link";
import { AlertCircle, CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { requireActorWith } from "@/lib/auth/session";
import {
  ERRO_CALENDARIO_MENSAGENS,
} from "@/lib/availability/errors";
import { getCalendario, listUnitsParaBloqueio } from "@/lib/availability/queries";
import {
  diasNoIntervalo,
  hojeUtc,
  inicioDoMes,
  inicioDoMesSeguinte,
  mesAnoLongo,
  parseDateOnly,
  toDateOnly,
  tryParseDateOnly,
} from "@/lib/dates";
import { hasPermission } from "@/lib/rbac/guard";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BloquearButton } from "./bloquear-button";
import { GradeCalendario } from "./grade";

export const metadata: Metadata = { title: "Calendário" };

export default async function CalendarioPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; erro?: string }>;
}) {
  const actor = await requireActorWith("availability.view");
  const { mes, erro } = await searchParams;

  // `mes` vem como YYYY-MM-01. Entrada inválida cai no mês atual em vez
  // de estourar — é parâmetro de URL, qualquer coisa pode chegar.
  const referencia = (mes && tryParseDateOnly(mes)) || hojeUtc();
  const inicio = inicioDoMes(referencia);
  const fim = inicioDoMesSeguinte(referencia);
  const dias = diasNoIntervalo(inicio, fim);

  const [linhas, unidades, podeBloquear, podeLiberar] = await Promise.all([
    getCalendario(actor, inicio, fim),
    listUnitsParaBloqueio(actor),
    hasPermission(actor, "availability.create"),
    hasPermission(actor, "availability.delete"),
  ]);

  const mesAnterior = toDateOnly(
    parseDateOnly(toDateOnly(new Date(Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth() - 1, 1)))),
  );
  const mesSeguinte = toDateOnly(fim);
  const mesAtual = toDateOnly(inicioDoMes(hojeUtc()));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Calendário
          </h1>
          <p className="text-sm text-muted-foreground">
            Ocupação por unidade. Reservas e bloqueios manuais no mesmo lugar.
          </p>
        </div>

        {podeBloquear && unidades.length > 0 && (
          <BloquearButton unidades={unidades} />
        )}
      </div>

      {erro && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>
            {ERRO_CALENDARIO_MENSAGENS[erro] ??
              "Não foi possível concluir a operação."}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex items-center gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href={`/calendario?mes=${mesAnterior}`} aria-label="Mês anterior">
            <ChevronLeft />
          </Link>
        </Button>
        {/* `first-letter:uppercase`, não `capitalize`: este maiúsculiza
            cada palavra e produz "Agosto De 2026". */}
        <span className="min-w-40 text-center text-sm font-medium first-letter:uppercase">
          {mesAnoLongo(inicio)}
        </span>
        <Button asChild variant="outline" size="sm">
          <Link href={`/calendario?mes=${mesSeguinte}`} aria-label="Mês seguinte">
            <ChevronRight />
          </Link>
        </Button>
        {toDateOnly(inicio) !== mesAtual && (
          <Button asChild variant="ghost" size="sm">
            <Link href="/calendario">Hoje</Link>
          </Button>
        )}
      </div>

      {linhas.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <CalendarDays className="size-8 text-muted-foreground" />
            <div>
              <p className="font-medium">Nenhuma unidade para exibir</p>
              <p className="text-sm text-muted-foreground">
                O calendário mostra unidades de imóveis ativos. Cadastre uma
                unidade para começar.
              </p>
            </div>
            <Button asChild>
              <Link href="/imoveis">Ir para imóveis</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <GradeCalendario
          linhas={linhas.map((l) => ({
            ...l,
            ocupacao: Object.fromEntries(l.ocupacao),
            semTarifa: [...l.semTarifa],
          }))}
          dias={dias.map(toDateOnly)}
          hoje={toDateOnly(hojeUtc())}
          mes={toDateOnly(inicio)}
          podeLiberar={podeLiberar}
        />
      )}
    </div>
  );
}
