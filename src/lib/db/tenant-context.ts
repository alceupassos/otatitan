import { AsyncLocalStorage } from "node:async_hooks";

export type TenantCtx = {
  tenantId: string;
  userId?: string;
  requestId?: string;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Único ponto do código que interpola uma string diretamente em SQL
 * (via SET LOCAL, que não aceita parâmetros bindados). Por isso o valor
 * é sempre validado como UUID antes de chegar aqui — nunca aceitar
 * tenantId vindo direto de um body/query de request.
 */
export function assertUuid(value: string): string {
  if (!UUID_RE.test(value)) {
    throw new Error(`Valor não é um UUID válido: "${value}"`);
  }
  return value;
}

const als = new AsyncLocalStorage<TenantCtx>();

export function getTenantCtx(): TenantCtx | undefined {
  return als.getStore();
}

export function requireTenantCtx(): TenantCtx {
  const ctx = als.getStore();
  if (!ctx) {
    throw new Error("Nenhum contexto de tenant ativo (fora de withTenant).");
  }
  return ctx;
}

export function runWithTenant<T>(ctx: TenantCtx, fn: () => Promise<T>): Promise<T> {
  return als.run(ctx, fn);
}
