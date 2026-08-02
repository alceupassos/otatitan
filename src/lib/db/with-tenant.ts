import { prisma, type TenantTx } from "./client";
import { assertUuid, runWithTenant, type TenantCtx } from "./tenant-context";

export type { TenantTx };

/**
 * Único caminho sancionado para tocar dados tenant-scoped.
 *
 * Abre uma transação a partir do client já estendido (o `tx` herda o
 * tenant-scoping) e fixa app.current_tenant_id via SET LOCAL — escopo de
 * transação, portanto seguro com pool de conexões, porque o valor morre no
 * COMMIT/ROLLBACK e nunca vaza para a próxima query que pegar a conexão.
 */
export async function withTenant<T>(
  ctx: TenantCtx,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  const tenantId = assertUuid(ctx.tenantId);
  return runWithTenant({ ...ctx, tenantId }, () =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SET LOCAL app.current_tenant_id = '${tenantId}'`,
      );
      return fn(tx);
    }),
  );
}
