import type { Metadata } from "next";
import { CalendarCheck, Home, ListChecks, Wallet } from "lucide-react";
import { requireActor } from "@/lib/auth/session";
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
        revenueCents: revenue?._sum.totalCents ?? null,
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
    </div>
  );
}
