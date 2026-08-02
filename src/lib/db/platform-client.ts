import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

declare global {
  var __otatitanPlatformPrisma: PrismaClient | undefined;
}

function createPlatformClient() {
  const adapter = new PrismaPg({
    connectionString: process.env.PLATFORM_DATABASE_URL,
    max: 5,
  });
  return new PrismaClient({ adapter });
}

/**
 * Conecta como otatitan_platform (ver scripts/db-init/01-roles.sh) — só a role de
 * plataforma vê tudo, através de uma política RLS permissiva explícita.
 * Uso restrito a: (1) superadmin/impersonação auditada, (2) o passo
 * inicial do handler de webhook, que grava WebhookEvent antes de resolver
 * qual tenant é o dono do evento, (3) a resolução de memberships no login
 * (src/lib/auth/memberships.ts) — descobrir a que tenants um usuário
 * pertence é, por definição, uma pergunta anterior a haver tenant ativo.
 * Toda chamada real deve ser registrada em AuditLog.
 */
export const platformPrisma =
  globalThis.__otatitanPlatformPrisma ?? createPlatformClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__otatitanPlatformPrisma = platformPrisma;
}
