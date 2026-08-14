import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "./index";
import {
  requirePermission,
  resolveRoleSlug,
  type ActorContext,
} from "@/lib/rbac/guard";
import type { PermissionCode } from "@/lib/rbac/permissions";

/**
 * Camada de acesso: o único lugar de onde páginas, server actions e route
 * handlers devem tirar "quem é o ator desta requisição".
 *
 * O `proxy.ts` faz a checagem otimista (só lê o cookie, sem banco) para
 * redirecionar cedo; a checagem que vale é esta, feita junto ao dado. Ver
 * docs/09-arquitetura.md, ADR-007.
 *
 * `cache` do React memoiza por render: chamar `requireActor()` no layout e
 * em três componentes da mesma página resolve a sessão uma vez só.
 */
export const getSession = cache(async () => auth());

export type SessionActor = ActorContext & {
  email: string | null;
  name: string | null;
  tenantSlug?: string;
  tenantName?: string;
  tenantCount: number;
};

/**
 * Ator autenticado COM empresa ativa. Redireciona em vez de lançar:
 * dentro de um Server Component, mandar o usuário para o login é o
 * comportamento correto, não uma tela de erro.
 *
 * O `roleSlug` do token é ponto de partida, NÃO a resposta: ele só é gravado
 * no login e na troca de empresa, e a sessão dura horas (`SESSION_MAX_AGE_SECONDS`).
 * Quem foi rebaixado no banco continuaria com o papel antigo — e como
 * `scopeFor` decide o escopo pelo papel, um proprietário rebaixado seguia
 * enxergando as reservas da empresa inteira, com nome de hóspede e valores,
 * até a sessão expirar. Aqui o papel é reconferido no servidor
 * (`resolveRoleSlug`, cacheado junto das permissões) e é o valor RESOLVIDO
 * que entra no `ActorContext`.
 */
export async function requireActor(): Promise<SessionActor> {
  const session = await getSession();

  if (!session?.user?.id) {
    redirect("/login");
  }

  if (!session.tenantId || !session.roleSlug) {
    // Autenticado, mas sem empresa ativa no token — escolher qual.
    redirect("/selecionar-empresa");
  }

  const roleSlug = await resolveRoleSlug({
    userId: session.user.id,
    tenantId: session.tenantId,
    roleSlug: session.roleSlug,
    permVersion: session.permVersion,
  });
  if (!roleSlug) {
    // A membership foi revogada, desativada, ou o papel saiu do catálogo
    // desde o login. Não há acesso a este tenant — escolher outra empresa.
    redirect("/selecionar-empresa");
  }

  return {
    userId: session.user.id,
    tenantId: session.tenantId,
    roleSlug,
    permVersion: session.permVersion,
    isSuperadmin: session.user.isSuperadmin,
    email: session.user.email ?? null,
    name: session.user.name ?? null,
    tenantSlug: session.tenantSlug,
    tenantName: session.tenantName,
    tenantCount: session.tenantCount,
  };
}

/** Ator autenticado, ainda sem empresa escolhida (`/selecionar-empresa`). */
export async function requireUser(): Promise<{
  userId: string;
  email: string | null;
  name: string | null;
  isSuperadmin: boolean;
}> {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");

  return {
    userId: session.user.id,
    email: session.user.email ?? null,
    name: session.user.name ?? null,
    isSuperadmin: session.user.isSuperadmin,
  };
}

/**
 * Ator + permissão, em uma chamada. É o atalho que deve aparecer no topo
 * de toda página protegida e de toda server action de mutação.
 */
export async function requireActorWith(
  code: PermissionCode,
): Promise<SessionActor> {
  const actor = await requireActor();
  await requirePermission(actor, code);
  return actor;
}
