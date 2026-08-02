import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { tenantExtension } from "./extensions";

declare global {
  var __otatitanBasePrisma: PrismaClient | undefined;
}

function createClient() {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  });
  return new PrismaClient({ adapter });
}

// Conecta como otatitan_app (ver scripts/db-roles.sql) — sujeita a RLS em
// toda tabela tenant-scoped.
export const basePrisma = globalThis.__otatitanBasePrisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__otatitanBasePrisma = basePrisma;
}

/**
 * Client com o tenant-scoping aplicado. A extensão é aplicada AQUI, no
 * nível do client, e não dentro da transação — em Prisma 7 o client de
 * transação (`tx`) não expõe `$extends`, mas herda as extensões do client
 * de onde a transação foi aberta.
 *
 * Não usar diretamente para dados tenant-scoped: use withTenant(...), que
 * é o que fixa app.current_tenant_id na transação (sem isso o RLS nega
 * tudo, por design fail-closed).
 */
export const prisma = basePrisma.$extends(tenantExtension);

export type TenantTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
