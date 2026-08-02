import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Building2 } from "lucide-react";
import { selectTenantAction } from "@/lib/auth/actions";
import { listActiveMemberships } from "@/lib/auth/memberships";
import { requireUser } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/rbac/roles";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Selecionar empresa",
};

export default async function SelectTenantPage() {
  const user = await requireUser();
  const memberships = await listActiveMemberships(user.userId);

  if (memberships.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Nenhuma empresa</CardTitle>
          <CardDescription>
            Sua conta não está vinculada a nenhuma empresa ativa. Fale com o
            administrador para receber um convite.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // Uma só: não faz sentido pedir escolha. O token já entrou com ela no
  // login; chegar aqui significa acesso direto à URL.
  if (memberships.length === 1) {
    redirect("/dashboard");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Selecionar empresa</CardTitle>
        <CardDescription>
          Você tem acesso a mais de uma empresa. Escolha com qual quer
          trabalhar.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-2">
        {memberships.map((m) => (
          <form key={m.tenantId} action={selectTenantAction}>
            <input type="hidden" name="tenantId" value={m.tenantId} />
            <Button
              type="submit"
              variant="outline"
              className="h-auto w-full justify-start gap-3 py-3 text-left"
            >
              <Building2 className="shrink-0 text-muted-foreground" />
              <span className="flex flex-col items-start">
                <span className="font-medium">{m.tenantName}</span>
                <span className="text-xs text-muted-foreground">
                  {ROLE_LABELS[m.roleSlug]}
                </span>
              </span>
            </Button>
          </form>
        ))}
      </CardContent>
    </Card>
  );
}
