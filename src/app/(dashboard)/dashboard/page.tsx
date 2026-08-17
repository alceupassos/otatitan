import type { Metadata } from "next";
import { CalendarCheck, Home, ListChecks, Wallet } from "lucide-react";
import Link from "next/link";
import { requireActor } from "@/lib/auth/session";
import { addDias, hojeUtc } from "@/lib/dates";
import { getResumoOcupacao } from "@/lib/availability/queries";
import { withTenant } from "@/lib/db/with-tenant";
import { resolvePermissions, scopeFor } from "@/lib/rbac/guard";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Painel",
};

function money(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export default async function DashboardPage() {
  // `/dashboard` não exige permissão específica (docs/06): basta
  // membership ativa. O que cada cartão mostra é que depende da permissão.
  const actor = await requireActor();
  const perms = await resolvePermissions(actor);

  const data = await withTenant(
    { tenantId: actor.tenantId, userId: actor.userId },
    async (tx) => {
      const hoje = new Date();
      hoje.setUTCHours(0, 0, 0, 0);

      const [properties, reservations, tasks, revenue] = await Promise.all([
        perms.has("properties.view")
          ? tx.property.count({
              where: { status: "ACTIVE", ...scopeFor(actor, "Property") },
            })
          : null,
        perms.has("reservations.view")
          ? tx.reservation.count({
              where: {
                status: { in: ["CONFIRMED", "CHECKED_IN"] },
                checkOut: { gte: hoje },
                ...scopeFor(actor, "Reservation"),
              },
            })
          : null,
        perms.has("tasks.view")
          ? tx.task.count({
              where: {
                status: { in: ["OPEN", "IN_PROGRESS"] },
                ...scopeFor(actor, "Task"),
              },
            })
          : null,
        perms.has("reports.view")
          ? tx.reservation.aggregate({
              _sum: { totalCents: true },
              where: {
                status: { in: ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"] },
                checkIn: { gte: hoje },
                ...scopeFor(actor, "Reservation"),
              },
            })
          : null,
      ]);

      return {
        properties,
        reservations,
        tasks,
        // `_sum` volta null quando nenhuma linha casa o filtro. Sem o `?? 0`
        // aqui, "nenhuma reserva ainda" viraria o mesmo valor que "sem
        // permissão para ver receita", e o cartão desapareceria da tela de
        // quem tem a permissão — foi o que aconteceu no primeiro acesso em
        // produção, com o banco vazio.
        revenueCents: revenue === null ? null : (revenue._sum.totalCents ?? 0),
      };
    },
  );

  const cards = [
    {
      key: "properties",
      label: "Imóveis ativos",
      value: data.properties,
      icon: Home,
      hint: "Publicados e disponíveis",
    },
    {
      key: "reservations",
      label: "Reservas em curso",
      value: data.reservations,
      icon: CalendarCheck,
      hint: "Confirmadas ou com hóspede na casa",
    },
    {
      key: "tasks",
      label: "Tarefas abertas",
      value: data.tasks,
      icon: ListChecks,
      hint: "Limpeza, manutenção e check-ins",
    },
    {
      key: "revenue",
      label: "Receita futura",
      value: data.revenueCents === null ? null : money(data.revenueCents),
      icon: Wallet,
      hint: "Reservas com entrada a partir de hoje",
    },
  ].filter((card) => card.value !== null);

  const hoje = hojeUtc();
  const ocupacao = perms.has("availability.view")
    ? await getResumoOcupacao(actor, hoje, addDias(hoje, 21))
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Olá, {actor.name?.split(" ")[0]}
        </h1>
        <p className="text-sm text-muted-foreground">
          Visão geral de {actor.tenantName}.
        </p>
      </div>

      {cards.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Sem indicadores para o seu perfil</CardTitle>
            <CardDescription>
              Use o menu para acessar as áreas do seu dia a dia.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map(({ key, label, value, icon: Icon, hint }) => (
            <Card key={key}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardDescription>{label}</CardDescription>
                  <Icon className="size-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="font-heading text-2xl font-semibold">
                  {value}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {ocupacao.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Ocupação das próximas 21 noites</CardTitle>
            <CardDescription>
              Noite sem diária publicada não vende (RN-011).{" "}
              <Link href="/calendario" className="underline underline-offset-4">
                Abrir calendário
              </Link>
              {" · "}
              <Link href="/tarifas" className="underline underline-offset-4">
                Cobertura de tarifas
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto text-sm">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="pb-2 font-medium">Unidade</th>
                    <th className="pb-2 font-medium">Ocupadas</th>
                    <th className="pb-2 font-medium">Sem tarifa</th>
                    <th className="pb-2 font-medium">Vendáveis</th>
                  </tr>
                </thead>
                <tbody>
                  {ocupacao.map((u) => (
                    <tr key={u.unitId} className="border-t">
                      <td className="py-2">
                        <Link
                          href={`/calendario`}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {u.internalCode}
                        </Link>
                        <div className="text-xs text-muted-foreground">{u.propertyName}</div>
                      </td>
                      <td className="py-2 tabular-nums">{u.ocupadas}/{u.noites}</td>
                      <td className="py-2 tabular-nums text-amber-700">{u.semTarifa}</td>
                      <td className="py-2 tabular-nums">{u.vendaveis}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
