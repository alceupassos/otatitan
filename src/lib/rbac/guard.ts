import { withTenant } from "@/lib/db/with-tenant";
import { cacheGet, cacheSet } from "@/lib/cache/redis";
import { ForbiddenError, NotFoundError } from "@/lib/db/errors";
import { isPermissionCode, type PermissionCode } from "./permissions";
import { SELF_SCOPED_ROLES, type RoleSlug } from "./roles";

const CACHE_TTL_SECONDS = 60;

export type ActorContext = {
  userId: string;
  tenantId: string;
  roleSlug: RoleSlug;
  /** Versão das permissões do tenant — bumpar invalida o cache inteiro. */
  permVersion: number;
  isSuperadmin?: boolean;
};

/**
 * Resolve as permissões efetivas do usuário no tenant.
 *
 * Fonte de verdade é sempre o banco (papel → RolePermission → Permission),
 * inclusive para papéis customizados. O JWT carrega só `roleSlug` e
 * `permVersion`; a lista completa fica fora do token para não inchar e
 * para não ficar velha quando um papel muda.
 *
 * A chave de cache inclui permVersion: mudar um papel incrementa
 * `Tenant.permVersion` e toda entrada antiga vira inalcançável de uma vez,
 * sem varrer chaves.
 */
export async function resolvePermissions(
  actor: ActorContext,
): Promise<Set<PermissionCode>> {
  const cacheKey = `perms:${actor.userId}:${actor.tenantId}:${actor.permVersion}`;

  const cached = await cacheGet(cacheKey);
  if (cached) {
    try {
      return new Set(JSON.parse(cached) as PermissionCode[]);
    } catch {
      // Cache corrompido — segue para o banco.
    }
  }

  const codes = await withTenant(
    { tenantId: actor.tenantId, userId: actor.userId },
    async (tx) => {
      const membership = await tx.membership.findFirst({
        where: { userId: actor.userId, status: "ACTIVE" },
        include: {
          role: { include: { rolePermissions: { include: { permission: true } } } },
        },
      });
      if (!membership) return [];
      return membership.role.rolePermissions
        .map((rp) => rp.permission.code)
        .filter(isPermissionCode);
    },
  );

  await cacheSet(cacheKey, JSON.stringify(codes), CACHE_TTL_SECONDS);
  return new Set(codes);
}

export async function hasPermission(
  actor: ActorContext,
  code: PermissionCode,
): Promise<boolean> {
  const perms = await resolvePermissions(actor);
  return perms.has(code);
}

/** Lança ForbiddenError se o ator não tiver a permissão. */
export async function requirePermission(
  actor: ActorContext,
  code: PermissionCode,
): Promise<void> {
  if (!(await hasPermission(actor, code))) {
    throw new ForbiddenError(`Permissão necessária: ${code}`);
  }
}

export async function requireAnyPermission(
  actor: ActorContext,
  codes: PermissionCode[],
): Promise<void> {
  const perms = await resolvePermissions(actor);
  if (!codes.some((c) => perms.has(c))) {
    throw new ForbiddenError(
      `Requer ao menos uma destas permissões: ${codes.join(", ")}`,
    );
  }
}

/**
 * Filtro "não devolve nada", para papel que não tem acesso ao modelo.
 *
 * `{ id: { in: [] } }` e não `{ id: "__sem_acesso__" }`: `id` é UUID, e
 * comparar com um texto qualquer faz o Postgres estourar 22P02 em vez de
 * retornar zero linhas — o mesmo modo de falha errado que a migration
 * `rls_nullif_hardening` corrigiu no RLS (ADR-002). Nunca foi vazamento,
 * mas erro de banco onde a resposta certa é uma lista vazia.
 */
const DENY_ALL = { id: { in: [] as string[] } };

/**
 * Papéis com escopo restrito (proprietário, hóspede, equipe de campo) só
 * enxergam as próprias linhas. Retorna o fragmento de `where` a somar à
 * consulta — permissão sozinha nunca basta para esses papéis
 * (docs/07-matriz-permissoes.md).
 *
 * Retorna `{}` para papéis de escopo pleno (admin, gestor etc.).
 */
export function scopeFor(
  actor: ActorContext,
  model: "Property" | "Unit" | "Reservation" | "Task",
): Record<string, unknown> {
  if (!SELF_SCOPED_ROLES.has(actor.roleSlug)) return {};

  switch (actor.roleSlug) {
    case "property_owner":
      // Proprietário: só imóveis cujo Owner está vinculado ao seu usuário.
      switch (model) {
        case "Property":
          return { owner: { userId: actor.userId } };
        case "Unit":
          return { property: { owner: { userId: actor.userId } } };
        case "Reservation":
          return { property: { owner: { userId: actor.userId } } };
        default:
          return DENY_ALL;
      }

    case "guest":
      // Hóspede: só a própria reserva.
      return model === "Reservation"
        ? { primaryGuest: { userId: actor.userId } }
        : DENY_ALL;

    case "cleaning_staff":
    case "maintenance_staff":
      // Equipe de campo: só as próprias tarefas.
      return model === "Task"
        ? { assignedToUserId: actor.userId }
        : DENY_ALL;

    default:
      return {};
  }
}

/**
 * Confirma que o recurso existe E está no escopo do ator.
 *
 * Lança NotFoundError (nunca ForbiddenError) quando o recurso é de outro
 * tenant ou fora do escopo: responder 403 revelaria que aquele id existe
 * em algum lugar (docs/12-plano-testes.md).
 */
export function assertFound<T>(row: T | null, mensagem = "Recurso não encontrado."): T {
  if (row === null || row === undefined) {
    throw new NotFoundError(mensagem);
  }
  return row;
}

export function requireSuperadmin(actor: ActorContext): void {
  if (!actor.isSuperadmin) {
    throw new ForbiddenError("Requer superadministrador da plataforma.");
  }
}
