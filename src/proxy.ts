import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  AUTH_PREFIXES,
  PUBLIC_PREFIXES,
  ROLE_HOME,
  matchesPrefix,
  ruleFor,
} from "@/lib/auth/routes";
import { permissionsForRole } from "@/lib/rbac/roles";
import {
  DIRECT_HOST_PUBLIC_PREFIXES,
  isDirectBookingHost,
} from "@/lib/direct-booking/hosts";

/**
 * Proxy (o antigo `middleware` — renomeado no Next.js 16).
 *
 * Faz apenas a checagem OTIMISTA descrita em docs/06-mapa-navegacao.md:
 * lê o token do cookie e redireciona cedo. Não consulta o banco — roda em
 * toda navegação, inclusive em prefetch. A autorização que vale é
 * `requireActorWith(...)` na página/action, junto ao dado (ADR-007).
 *
 * Por isso a checagem de permissão aqui usa o mapa estático papel →
 * permissões (`SYSTEM_ROLES`), não o banco: é um pré-filtro de UX. Um
 * papel cujas permissões foram customizadas pode passar por aqui e ser
 * barrado na página — nunca o contrário, que é o que importaria.
 *
 * Host do canal direto (madre914.com.br): `/` e `/politicas` são públicos.
 * O painel (otatitan.*) continua exigindo login em `/`.
 */
export default auth((req) => {
  const { nextUrl } = req;
  const { pathname } = nextUrl;
  const session = req.auth;
  const isLoggedIn = Boolean(session?.user?.id);
  const host = req.headers.get("host");

  // Logado tentando voltar ao login: manda para o lugar certo.
  if (isLoggedIn && matchesPrefix(pathname, AUTH_PREFIXES)) {
    const home = session?.roleSlug ? ROLE_HOME[session.roleSlug] : "/dashboard";
    return NextResponse.redirect(new URL(home, nextUrl));
  }

  const publicoDoCanal =
    isDirectBookingHost(host) &&
    DIRECT_HOST_PUBLIC_PREFIXES.some(
      (p) => pathname === p || (p !== "/" && pathname.startsWith(`${p}/`)),
    );

  if (matchesPrefix(pathname, PUBLIC_PREFIXES) || publicoDoCanal) {
    return NextResponse.next();
  }

  if (!isLoggedIn) {
    // `callbackUrl` preserva o destino: depois de logar o usuário volta
    // para onde queria ir, não para uma home genérica.
    const login = new URL("/login", nextUrl);
    login.searchParams.set("callbackUrl", `${pathname}${nextUrl.search}`);
    return NextResponse.redirect(login);
  }

  // Autenticado sem empresa ativa (várias memberships, nenhuma escolhida).
  const hasTenant = Boolean(session?.tenantId && session?.roleSlug);
  if (!hasTenant) {
    return pathname === "/selecionar-empresa"
      ? NextResponse.next()
      : NextResponse.redirect(new URL("/selecionar-empresa", nextUrl));
  }

  if (pathname === "/selecionar-empresa") return NextResponse.next();

  const rule = ruleFor(pathname);
  if (!rule) return NextResponse.next();

  const roleSlug = session!.roleSlug!;
  const home = ROLE_HOME[roleSlug];

  if (rule.roles && !rule.roles.includes(roleSlug)) {
    return NextResponse.redirect(new URL(home, nextUrl));
  }

  if (rule.permission && !permissionsForRole(roleSlug).includes(rule.permission)) {
    return NextResponse.redirect(new URL(home, nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  /**
   * Roda em tudo, menos assets estáticos. Rotas de API ficam DENTRO do
   * matcher de propósito: `/api/*` (fora do que está em PUBLIC_PREFIXES)
   * também exige sessão.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
