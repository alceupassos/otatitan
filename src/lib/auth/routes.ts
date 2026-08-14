import type { PermissionCode } from "@/lib/rbac/permissions";
import type { RoleSlug } from "@/lib/rbac/roles";

/**
 * Mapa de rotas → exigência mínima. Transcrição de
 * docs/06-mapa-navegacao.md; ao mudar aqui, atualize lá (o teste
 * `tests/unit/auth-routes.test.ts` lê os dois e falha se divergirem).
 *
 * Isto alimenta a checagem OTIMISTA do proxy, que só lê o cookie. A
 * checagem que realmente autoriza é `requireActorWith(...)` na página ou
 * na action, junto ao dado (ADR-007).
 */
export type RouteRule = {
  /** Prefixo de caminho. A rota mais específica vence. */
  prefix: string;
  /** Permissão mínima para ver a rota (ausente = basta estar autenticado). */
  permission?: PermissionCode;
  /** Restringe a papéis específicos (portais). */
  roles?: readonly RoleSlug[];
};

/** Rotas públicas — nunca redirecionam para login. */
export const PUBLIC_PREFIXES = [
  "/login",
  "/esqueci-senha",
  "/redefinir-senha",
  "/stays",
  "/api/auth",
  "/api/webhooks",
  "/api/health",
] as const;

/** Rotas de autenticação: se já logado, não faz sentido continuar nelas. */
export const AUTH_PREFIXES = ["/login", "/esqueci-senha", "/redefinir-senha"] as const;

export const ROUTE_RULES: readonly RouteRule[] = [
  { prefix: "/dashboard" },
  // `/imoveis/novo` e `/imoveis/[id]` herdam este prefixo: a escrita
  // (`.create`/`.edit`) é exigida na página, junto ao dado, não no proxy.
  { prefix: "/imoveis", permission: "properties.view" },
  { prefix: "/tarifas", permission: "rates.view" },
  { prefix: "/calendario", permission: "availability.view" },
  /**
   * Cobre `/reservas`, `/reservas/nova` e `/reservas/[id]`. O gate do
   * proxy é o de LEITURA; `/reservas/nova` exige `reservations.create`,
   * conferido por `requireActorWith` na própria página — mesma divisão de
   * `/imoveis/novo`. Registrar aqui um prefixo mais específico não
   * aumentaria a segurança (o proxy só lê o cookie, ADR-007) e faria o
   * proxy redirecionar antes da checagem que de fato autoriza.
   */
  { prefix: "/reservas", permission: "reservations.view" },
  { prefix: "/tarefas", permission: "tasks.view" },
  { prefix: "/reports", permission: "reports.view" },
  { prefix: "/configuracoes/usuarios", permission: "users.admin" },
  { prefix: "/configuracoes/papeis", permission: "roles.admin" },
  { prefix: "/configuracoes", permission: "settings.view" },
  { prefix: "/portal-proprietario", roles: ["property_owner"] },
  { prefix: "/portal-hospede", roles: ["guest"] },
];

export function matchesPrefix(
  pathname: string,
  prefixes: readonly string[],
): boolean {
  return prefixes.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

/** Regra mais específica que cobre o caminho (maior prefixo casado). */
export function ruleFor(pathname: string): RouteRule | undefined {
  let best: RouteRule | undefined;
  for (const rule of ROUTE_RULES) {
    if (pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`)) {
      if (!best || rule.prefix.length > best.prefix.length) best = rule;
    }
  }
  return best;
}

/**
 * Para onde mandar cada papel quando ele cai numa rota que não é dele.
 * Devolver 403 seria pior UX do que levar o usuário à sua própria home.
 */
export const ROLE_HOME: Record<RoleSlug, string> = {
  company_admin: "/dashboard",
  reservations_manager: "/dashboard",
  sales_agent: "/reservas",
  finance: "/dashboard",
  operations_coordinator: "/tarefas",
  cleaning_staff: "/tarefas",
  maintenance_staff: "/tarefas",
  property_owner: "/portal-proprietario",
  guest: "/portal-hospede",
};
