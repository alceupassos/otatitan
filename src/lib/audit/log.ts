import type { TenantTx } from "@/lib/db/client";
import type { ActorType } from "@/generated/prisma/enums";

export type AuditInput = {
  action: string; // ex: "reservation.created"
  entityType: string; // ex: "Reservation"
  entityId?: string;
  actorType?: ActorType;
  actorUserId?: string;
  actorLabel?: string;
  before?: unknown;
  after?: unknown;
  ip?: string;
  userAgent?: string;
  requestId?: string;
};

/**
 * Campos que nunca entram no snapshot de auditoria. A auditoria é
 * append-only e retida por muito tempo — deixar segredo ou documento de
 * hóspede aqui transformaria a trilha num passivo de LGPD
 * (docs/11-seguranca-lgpd.md).
 */
const NEVER_AUDIT = new Set([
  "passwordHash",
  "mfaSecretEnc",
  "mfaRecoveryCodesEnc",
  "tokenHash",
  "documentNumberEnc",
  "taxIdEnc",
]);

function sanitize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(sanitize);

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = NEVER_AUDIT.has(k) ? "[REDIGIDO]" : sanitize(v);
  }
  return out;
}

/**
 * Grava uma linha de auditoria (RN-010).
 *
 * Recebe o `tx` de propósito: a auditoria tem que ser escrita DENTRO da
 * mesma transação da ação auditada. Se a ação der rollback, o registro de
 * auditoria também some — nada de trilha registrando algo que não
 * aconteceu, nem ação crítica sem trilha.
 */
export async function writeAudit(tx: TenantTx, input: AuditInput) {
  return tx.auditLog.create({
    data: {
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      actorType: input.actorType ?? "USER",
      actorUserId: input.actorUserId,
      actorLabel: input.actorLabel,
      before: input.before === undefined ? undefined : (sanitize(input.before) as never),
      after: input.after === undefined ? undefined : (sanitize(input.after) as never),
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    },
  });
}
