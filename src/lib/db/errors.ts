import { Prisma } from "@/generated/prisma/client";

export class MissingTenantContextError extends Error {
  constructor(model: string, operation: string) {
    super(
      `Tentativa de acessar o modelo "${model}" (operação "${operation}") sem contexto de tenant. ` +
        `Todo acesso a dados tenant-scoped precisa passar por withTenant(...).`,
    );
    this.name = "MissingTenantContextError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Permissão negada.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends Error {
  constructor(message = "Recurso não encontrado.") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ConflictError";
    this.code = code;
  }
}

// ── Violações de unicidade (P2002) ────────────────────────────────────────

/**
 * A unique `alvo` foi violada?
 *
 * Reconhecer isso é o que separa "duplo clique" de "defeito de sistema", e
 * tem de ser feito em UM lugar só porque o P2002 chega em DUAS formas
 * diferentes para a mesma colisão:
 *
 * - sem driver adapter, o Prisma preenche `meta.target` com os campos da
 *   constraint (`["tenantId","idempotencyKey"]`);
 * - com `@prisma/adapter-pg` — o nosso caso (prisma.config.ts) — `meta.target`
 *   simplesmente NÃO existe. O que chega é
 *   `meta.driverAdapterError.cause.originalMessage`, com o nome da constraint
 *   do Postgres: `duplicate key value violates unique constraint
 *   "Payment_tenantId_idempotencyKey_key"`.
 *
 * Um detector que só olha `meta.target` devolve `false` justamente para a
 * colisão que ele existe para reconhecer — e aí o `PrismaClientKnownRequestError`
 * cru vaza para a tela, com o caminho do arquivo no meio da mensagem. Por isso
 * as duas formas são checadas aqui, e por isso o nome da constraint viaja
 * junto do nome do campo: só o segundo aparece em `meta.target`, só o primeiro
 * aparece na mensagem do Postgres.
 */
export type UniqueAlvo = {
  /** Nome da constraint no Postgres (o que a mensagem do driver traz). */
  constraint: string;
  /** Nome do campo Prisma (o que `meta.target` traz). */
  campo: string;
};

export function ehUniqueViolada(err: unknown, alvo: UniqueAlvo): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code !== "P2002") return false;

  const meta = err.meta as
    | {
        target?: unknown;
        driverAdapterError?: { cause?: { originalMessage?: unknown } };
      }
    | undefined;

  const target = meta?.target;
  if (target !== undefined && target !== null) {
    const campos = Array.isArray(target) ? target.map(String) : [String(target)];
    const campo = alvo.campo.toLowerCase();
    if (campos.some((c) => c.toLowerCase().includes(campo))) return true;
    // Algumas versões devolvem o nome da constraint em `target`.
    if (campos.includes(alvo.constraint)) return true;
  }

  const original = meta?.driverAdapterError?.cause?.originalMessage;
  return typeof original === "string" && original.includes(alvo.constraint);
}

/** Unique `(tenantId, idempotencyKey)` de `Payment`. */
export const UNIQUE_PAGAMENTO_IDEMPOTENTE: UniqueAlvo = {
  constraint: "Payment_tenantId_idempotencyKey_key",
  campo: "idempotencyKey",
};

/** Unique `(tenantId, code)` de `Reservation` — o código sorteado. */
export const UNIQUE_CODIGO_DE_RESERVA: UniqueAlvo = {
  constraint: "Reservation_tenantId_code_key",
  campo: "code",
};

/**
 * Colisão da chave de idempotência de um `Payment`.
 *
 * É a corrida que a chave existe para barrar: duplo clique na baixa manual,
 * dois submits simultâneos da cobrança por link. Quem chama transforma isto
 * em recusa legível — nunca em 500.
 */
export function ehPagamentoDuplicado(err: unknown): boolean {
  return ehUniqueViolada(err, UNIQUE_PAGAMENTO_IDEMPOTENTE);
}
