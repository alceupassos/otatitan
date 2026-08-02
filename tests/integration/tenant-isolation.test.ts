import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { basePrisma, prisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/with-tenant";
import { MissingTenantContextError } from "@/lib/db/errors";
import {
  cleanupTenants,
  createTestProperty,
  createTestTenant,
} from "../helpers/db";

/**
 * Isolamento multi-tenant — as 6 asserções de docs/12-plano-testes.md.
 *
 * Crítico: estes testes conectam como otatitan_app (DATABASE_URL), NUNCA
 * como superuser. Um superuser bypassa RLS e faria todos eles passarem em
 * falso ("verde falso"), que é o modo clássico de errar este teste.
 */
describe("isolamento multi-tenant", () => {
  let tenantA: { id: string };
  let tenantB: { id: string };
  let propA: { id: string; name: string };
  let propB: { id: string; name: string };

  beforeAll(async () => {
    tenantA = await createTestTenant("a");
    tenantB = await createTestTenant("b");
    propA = await createTestProperty(tenantA.id, "Casa A");
    propB = await createTestProperty(tenantB.id, "Casa B");
  });

  afterAll(async () => {
    await cleanupTenants([tenantA.id, tenantB.id]);
    await basePrisma.$disconnect();
  });

  it("(a) findMany do tenant A não retorna linhas do tenant B", async () => {
    const rows = await withTenant({ tenantId: tenantA.id }, (tx) =>
      tx.property.findMany({}),
    );
    expect(rows.map((r) => r.id)).toContain(propA.id);
    expect(rows.map((r) => r.id)).not.toContain(propB.id);
    expect(rows.every((r) => r.tenantId === tenantA.id)).toBe(true);
  });

  it("(b) tenant A não encontra linha de B por id", async () => {
    const viaFindFirst = await withTenant({ tenantId: tenantA.id }, (tx) =>
      tx.property.findFirst({ where: { id: propB.id } }),
    );
    expect(viaFindFirst).toBeNull();

    // findUnique é o caminho reescrito na extensão — precisa ser igualmente seguro.
    const viaFindUnique = await withTenant({ tenantId: tenantA.id }, (tx) =>
      tx.property.findUnique({ where: { id: propB.id } }),
    );
    expect(viaFindUnique).toBeNull();
  });

  it("(c) tenant A não atualiza nem apaga linha de B", async () => {
    const updated = await withTenant({ tenantId: tenantA.id }, (tx) =>
      tx.property.updateMany({
        where: { id: propB.id },
        data: { name: "INVADIDO" },
      }),
    );
    expect(updated.count).toBe(0);

    const deleted = await withTenant({ tenantId: tenantA.id }, (tx) =>
      tx.property.deleteMany({ where: { id: propB.id } }),
    );
    expect(deleted.count).toBe(0);

    // A linha de B continua intacta.
    const stillThere = await withTenant({ tenantId: tenantB.id }, (tx) =>
      tx.property.findFirst({ where: { id: propB.id } }),
    );
    expect(stillThere?.name).toBe("Casa B");
  });

  it("(d) create com tenantId forjado é sobrescrito pelo tenant do contexto", async () => {
    const created = await withTenant({ tenantId: tenantA.id }, (tx) =>
      tx.property.create({
        data: {
          // Tentativa de injetar o tenant de outra empresa:
          tenantId: tenantB.id,
          name: "Tentativa de injeção",
          slug: `injecao-${Date.now()}`,
          type: "HOUSE",
        },
      }),
    );
    expect(created.tenantId).toBe(tenantA.id);
    expect(created.tenantId).not.toBe(tenantB.id);
  });

  it("(g) platformPrisma enxerga através dos tenants — e é o ÚNICO que consegue", async () => {
    const { platformPrisma } = await import("@/lib/db/platform-client");
    const ids = await platformPrisma.property
      .findMany({ select: { id: true } })
      .then((rows) => rows.map((r) => r.id));

    // A role de plataforma tem política permissiva: vê os dois tenants.
    expect(ids).toContain(propA.id);
    expect(ids).toContain(propB.id);
    await platformPrisma.$disconnect();
  });

  it("(h) o DEFAULT da coluna carimba o tenant mesmo em INSERT cru sem tenantId", async () => {
    // Camada 4: nem um INSERT em SQL puro que "esquece" o tenantId cria
    // linha órfã ou de outro tenant — o default da coluna lê o mesmo GUC
    // que o RLS usa (ver migration 20260801221003_tenant_id_db_default).
    const [row] = await withTenant({ tenantId: tenantA.id }, (tx) =>
      tx.$queryRawUnsafe<{ tenantId: string }[]>(
        `INSERT INTO otatitan."Property" ("id", "name", "slug", "type", "updatedAt")
         VALUES (gen_random_uuid(), 'Sem tenant explícito', $1, 'HOUSE', now())
         RETURNING "tenantId"`,
        `sem-tenant-${Date.now()}`,
      ),
    );
    expect(row.tenantId).toBe(tenantA.id);
  });

  it("(e) SQL cru dentro de withTenant(A) só vê linhas de A — prova o RLS, não só a extensão", async () => {
    const rows = await withTenant({ tenantId: tenantA.id }, (tx) =>
      tx.$queryRawUnsafe<{ tenantId: string }[]>(
        'SELECT "tenantId" FROM otatitan."Property"',
      ),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.tenantId === tenantA.id)).toBe(true);
  });

  it("(f) sem contexto de tenant: a extensão lança e o SQL cru não vê nada (fail-closed)", async () => {
    await expect(prisma.property.findMany({})).rejects.toThrow(
      MissingTenantContextError,
    );

    // E o RLS, independente da extensão, nega tudo sem app.current_tenant_id.
    // Roda depois de outros withTenant(...) de propósito: numa conexão de
    // pool reciclada o GUC volta a '' (não a NULL), e a política precisa
    // tratar isso como "sem tenant" em vez de estourar (ver migration
    // 20260801220000_rls_nullif_hardening).
    const rows = await basePrisma.$queryRawUnsafe<{ tenantId: string }[]>(
      'SELECT "tenantId" FROM otatitan."Property"',
    );
    expect(rows).toHaveLength(0);
  });
});
