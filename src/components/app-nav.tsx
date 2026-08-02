"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  Home,
  LayoutDashboard,
  ListChecks,
  Settings,
  Tag,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PermissionCode } from "@/lib/rbac/permissions";

/**
 * Navegação principal. Recebe as permissões já resolvidas pelo servidor
 * (via props) — um client component não pode consultar o banco, e mandar
 * o catálogo inteiro para o navegador seria vazamento desnecessário.
 *
 * Esconder um item aqui é conveniência, não segurança: quem digitar a URL
 * ainda é barrado pelo proxy e, definitivamente, por `requireActorWith`
 * na página (ADR-007).
 */
type Item = {
  href: string;
  label: string;
  icon: typeof Home;
  permission?: PermissionCode;
};

const ITENS: Item[] = [
  { href: "/dashboard", label: "Painel", icon: LayoutDashboard },
  { href: "/imoveis", label: "Imóveis", icon: Home, permission: "properties.view" },
  { href: "/calendario", label: "Calendário", icon: CalendarDays, permission: "availability.view" },
  { href: "/reservas", label: "Reservas", icon: CalendarDays, permission: "reservations.view" },
  { href: "/tarifas", label: "Tarifas", icon: Tag, permission: "rates.view" },
  { href: "/tarefas", label: "Tarefas", icon: ListChecks, permission: "tasks.view" },
  { href: "/configuracoes", label: "Configurações", icon: Settings, permission: "settings.view" },
];

export function AppNav({ permissions }: { permissions: string[] }) {
  const pathname = usePathname();
  const permitidas = new Set(permissions);

  const visiveis = ITENS.filter(
    (i) => !i.permission || permitidas.has(i.permission),
  );

  return (
    <nav className="flex items-center gap-1 overflow-x-auto" aria-label="Principal">
      {visiveis.map(({ href, label, icon: Icon }) => {
        // `startsWith` para que /imoveis/abc mantenha "Imóveis" marcado.
        const ativo = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={ativo ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
              ativo
                ? "bg-secondary font-medium text-secondary-foreground"
                : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
