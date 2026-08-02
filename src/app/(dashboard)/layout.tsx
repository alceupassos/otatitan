import type { ReactNode } from "react";
import { LogOut } from "lucide-react";
import { logoutAction } from "@/lib/auth/actions";
import { requireActor } from "@/lib/auth/session";
import { resolvePermissions } from "@/lib/rbac/guard";
import { ROLE_LABELS } from "@/lib/rbac/roles";
import { AppNav } from "@/components/app-nav";
import { Button } from "@/components/ui/button";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  // Nota: layout não re-renderiza a cada navegação, então esta checagem
  // não substitui a da página. Ela existe para montar o cabeçalho — cada
  // página protegida chama `requireActorWith(...)` por conta própria.
  const actor = await requireActor();
  const permissions = await resolvePermissions(actor);

  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b">
        <div className="flex items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-baseline gap-3">
            <span className="font-heading font-semibold">Otatitan</span>
            <span className="truncate text-sm text-muted-foreground">
              {actor.tenantName}
            </span>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden text-right text-sm leading-tight sm:block">
              <div>{actor.name}</div>
              <div className="text-xs text-muted-foreground">
                {ROLE_LABELS[actor.roleSlug]}
              </div>
            </div>
            <form action={logoutAction}>
              <Button type="submit" variant="ghost" size="sm">
                <LogOut />
                <span className="hidden sm:inline">Sair</span>
              </Button>
            </form>
          </div>
        </div>

        <div className="px-4 pb-2">
          <AppNav permissions={[...permissions]} />
        </div>
      </header>

      <main className="flex-1 px-6 py-6">{children}</main>
    </div>
  );
}
