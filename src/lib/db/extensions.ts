import { Prisma } from "@/generated/prisma/client";
import { getTenantCtx } from "./tenant-context";
import { MissingTenantContextError } from "./errors";

/**
 * Modelos tenant-scoped — filtro estrito de leitura e escrita, sempre
 * igual ao tenant do contexto atual.
 *
 * AuditLog e WebhookEvent entram aqui mesmo tendo tenantId nulável: nulo
 * significa "ação de plataforma", e essas linhas são escritas/lidas pelo
 * platformPrisma, que é outro client, sem esta extensão. Pelo client da
 * aplicação, toda linha é sempre do tenant do contexto.
 *
 * Manter em sincronia com o banco — scripts/check-tenant-columns.ts falha
 * o CI se alguma tabela com coluna tenantId ficar de fora desta lista.
 */
const STRICT_TENANT_MODELS = new Set([
  "Owner",
  "Property",
  "Unit",
  "UnitAmenity",
  "Media",
  "Guest",
  "RatePlan",
  "DailyRate",
  "AvailabilityBlock",
  "Reservation",
  "ReservationGuest",
  "Payment",
  "Task",
  "Consent",
  "Membership",
  "AuditLog",
  "WebhookEvent",
]);

/**
 * Modelos onde tenantId nulo = catálogo/template global: legível por
 * qualquer tenant, mas escrita sempre carimbada com o tenant atual
 * (linhas globais só nascem pelo seed, via platformPrisma).
 * Ver migration enable_rls.
 */
const NULLABLE_READTHROUGH_MODELS = new Set(["Amenity", "Role"]);

const OPERATIONS_WITH_WHERE = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
  "count",
  "aggregate",
  "groupBy",
]);

function tenantFilter(model: string, tenantId: string) {
  if (NULLABLE_READTHROUGH_MODELS.has(model)) {
    return { OR: [{ tenantId }, { tenantId: null }] };
  }
  return { tenantId };
}

/**
 * Anexa o filtro de tenant preservando as chaves de topo do `where` do
 * chamador. Duas razões para não fazer `{ AND: [userWhere, filter] }`:
 * (1) `update`/`delete` exigem ao menos um campo único no topo do `where`;
 * (2) fazer spread do filtro por cima clobbaria um `OR` do chamador.
 * Empilhar dentro de `AND` resolve os dois casos.
 */
function mergeWhere(userWhere: unknown, filter: object) {
  const w = (userWhere ?? {}) as Record<string, unknown>;
  const existingAnd = w.AND;
  const andList = Array.isArray(existingAnd)
    ? existingAnd
    : existingAnd
      ? [existingAnd]
      : [];
  return { ...w, AND: [...andList, filter] };
}

function injectTenantId(data: unknown, tenantId: string) {
  if (Array.isArray(data)) {
    return data.map((item) => ({ ...item, tenantId }));
  }
  return { ...(data as Record<string, unknown>), tenantId };
}

/**
 * Prisma Client Extension — camada 3 do isolamento multi-tenant
 * (docs/09-arquitetura.md, ADR-002). Injeta o filtro de tenantId em toda
 * operação sobre modelo tenant-scoped, a partir do contexto ativo em
 * AsyncLocalStorage (ver tenant-context.ts).
 *
 * É ergonomia + defesa em profundidade: a garantia real contra vazamento
 * entre tenants é o Postgres RLS (camada 2). Um bug aqui não torna a
 * aplicação insegura — faz a query falhar ou vir vazia, não vazar.
 */
export const tenantExtension = Prisma.defineExtension((client) =>
  client.$extends({
    name: "tenant-scoping",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const isStrict = STRICT_TENANT_MODELS.has(model);
          const isNullable = NULLABLE_READTHROUGH_MODELS.has(model);
          if (!isStrict && !isNullable) {
            return query(args);
          }

          const ctx = getTenantCtx();
          if (!ctx) {
            throw new MissingTenantContextError(model, operation);
          }

          const { tenantId } = ctx;
          const filter = tenantFilter(model, tenantId);
          const a = args as Record<string, unknown>;

          if (
            operation === "create" ||
            operation === "createMany" ||
            operation === "createManyAndReturn"
          ) {
            a.data = injectTenantId(a.data, tenantId);
            return query(a);
          }

          if (operation === "upsert") {
            a.create = injectTenantId(a.create, tenantId);
            a.where = mergeWhere(a.where, filter);
            return query(a);
          }

          // findUnique não aceita filtro adicional na chave única e não pode
          // ser redirecionado para findFirst aqui (o `client` do closure é o
          // client de fora, o que escaparia da transação — e do
          // SET LOCAL app.current_tenant_id, fazendo o RLS negar tudo).
          // Então filtramos o resultado depois. O RLS já impede a leitura
          // cruzada; isto é o cinto de segurança da camada de aplicação.
          if (operation === "findUnique" || operation === "findUniqueOrThrow") {
            const row = (await query(a)) as { tenantId?: string | null } | null;
            if (row && row.tenantId !== tenantId) {
              if (isNullable && row.tenantId === null) return row;
              if (operation === "findUniqueOrThrow") {
                throw new Prisma.PrismaClientKnownRequestError(
                  "Registro não encontrado no tenant atual.",
                  { code: "P2025", clientVersion: Prisma.prismaVersion.client },
                );
              }
              return null;
            }
            return row;
          }

          if (OPERATIONS_WITH_WHERE.has(operation)) {
            a.where = mergeWhere(a.where, filter);
            return query(a);
          }

          return query(a);
        },
      },
    },
  }),
);
