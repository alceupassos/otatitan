import { platformPrisma } from "@/lib/db/platform-client";
import { isRoleSlug, type RoleSlug } from "@/lib/rbac/roles";

/**
 * "A que empresas este usuário pertence?" é uma pergunta que precede a
 * existência de tenant ativo, então não há como respondê-la sob RLS: a
 * role de aplicação, sem `app.current_tenant_id`, não enxerga Membership
 * nenhuma. Por isso este é um dos três usos sancionados do
 * `platformPrisma` (ver o comentário em src/lib/db/platform-client.ts).
 *
 * Para compensar, o escopo aqui é deliberadamente estreito: só filtra por
 * `userId`, só devolve os campos abaixo, e nada mais neste módulo toca o
 * cliente de plataforma.
 */
export type ActiveMembership = {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  roleSlug: RoleSlug;
  permVersion: number;
};

export async function listActiveMemberships(
  userId: string,
): Promise<ActiveMembership[]> {
  const rows = await platformPrisma.membership.findMany({
    where: {
      userId,
      status: "ACTIVE",
      tenant: { status: { in: ["TRIAL", "ACTIVE"] }, deletedAt: null },
    },
    select: {
      tenantId: true,
      tenant: { select: { slug: true, name: true, permVersion: true } },
      role: { select: { slug: true } },
    },
    orderBy: { tenant: { name: "asc" } },
  });

  // Um papel fora do catálogo significa banco divergente do código; tratar
  // como acesso inválido é mais seguro do que adivinhar permissões.
  return rows.flatMap((row) =>
    isRoleSlug(row.role.slug)
      ? [
          {
            tenantId: row.tenantId,
            tenantSlug: row.tenant.slug,
            tenantName: row.tenant.name,
            roleSlug: row.role.slug,
            permVersion: row.tenant.permVersion,
          },
        ]
      : [],
  );
}

/** Membership do usuário num tenant específico, ou null se não houver. */
export async function findMembership(
  userId: string,
  tenantId: string,
): Promise<ActiveMembership | null> {
  const all = await listActiveMemberships(userId);
  return all.find((m) => m.tenantId === tenantId) ?? null;
}
