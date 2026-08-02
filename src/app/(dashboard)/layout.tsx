import type { ReactNode } from "react";
import { LogOut } from "lucide-react";
import { logoutAction } from "@/lib/auth/actions";
import { requireActor } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/rbac/roles";
import { Button } from "@/components/ui/button";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  // Nota: o guia do Next avisa que layout não re-renderiza a cada
  // navegação, então esta checagem não substitui a da página. Ela está
  // aqui só para montar o cabeçalho — cada página protegida chama
  // `requireActorWith(...)` por conta própria.
  const actor = await requireActor();

  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-baseline gap-3">
          <span className="font-heading font-semibold">Otatitan</span>
          <span className="text-sm text-muted-foreground">
            {actor.tenantName}
          </span>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right text-sm leading-tight">
            <div>{actor.name}</div>
            <div className="text-xs text-muted-foreground">
              {ROLE_LABELS[actor.roleSlug]}
            </div>
          </div>
          <form action={logoutAction}>
            <Button type="submit" variant="ghost" size="sm">
              <LogOut />
              Sair
            </Button>
          </form>
        </div>
      </header>

      <main className="flex-1 px-6 py-6">{children}</main>
    </div>
  );
}
