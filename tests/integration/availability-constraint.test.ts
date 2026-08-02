import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { basePrisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/with-tenant";
import {
  cleanupTenants,
  createTestProperty,
  createTestTenant,
  createTestUnit,
} from "../helpers/db";

/**
 * A garantia de zero overbooking (RN-002) mora no banco, não na aplicação
 * (ADR-003). Estes testes atacam a constraint diretamente, sem passar por
 * nenhum serviço — se eles passam, nenhum bug de aplicação, retry, worker
 * ou código futuro de channel manager consegue criar uma sobreposição.
 */
describe("constraint anti-overbooking (availability_block_no_overlap)", () => {
  let tenant: { id: string };
  let unitId: string;
  let otherUnitId: string;

  const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

  async function block(
    unit: string,
    start: string,
    end: string,
    opts: { isBlocking?: boolean } = {},
  ) {
    return withTenant({ tenantId: tenant.id }, (tx) =>
      tx.availabilityBlock.create({
        data: {
          unitId: unit,
          startDate: d(start),
          endDate: d(end),
          source: "MANUAL",
          isBlocking: opts.isBlocking ?? true,
        },
      }),
    );
  }

  beforeAll(async () => {
    tenant = await createTestTenant("overbooking");
    const prop = await createTestProperty(tenant.id, "Pousada Teste");
    const u1 = await createTestUnit(tenant.id, prop.id, "U1");
    const u2 = await createTestUnit(tenant.id, prop.id, "U2");
    unitId = u1.id;
    otherUnitId = u2.id;
    // Ocupação base: 10 a 15 de março (noites 10,11,12,13,14).
    await block(unitId, "2026-03-10", "2026-03-15");
  });

  afterAll(async () => {
    await cleanupTenants([tenant.id]);
    await basePrisma.$disconnect();
  });

  it("permite same-day turnover — [10,15) e [15,20) não são conflito (RN-001)", async () => {
    const created = await block(unitId, "2026-03-15", "2026-03-20");
    expect(created.id).toBeTruthy();
  });

  it("permite as mesmas datas em OUTRA unidade", async () => {
    const created = await block(otherUnitId, "2026-03-10", "2026-03-15");
    expect(created.id).toBeTruthy();
  });

  it.each([
    ["sobreposição à direita", "2026-03-14", "2026-03-16"],
    ["sobreposição à esquerda", "2026-03-09", "2026-03-11"],
    ["contida dentro", "2026-03-11", "2026-03-13"],
    ["envolvendo por fora", "2026-03-05", "2026-03-25"],
    ["exatamente igual", "2026-03-10", "2026-03-15"],
  ])("rejeita %s", async (_label, start, end) => {
    await expect(block(unitId, start, end)).rejects.toThrow();
  });

  it("bloqueio não-bloqueante (isBlocking=false) não conflita — é histórico", async () => {
    const created = await block(unitId, "2026-03-11", "2026-03-13", {
      isBlocking: false,
    });
    expect(created.id).toBeTruthy();
  });

  it("liberar o bloqueio (releasedAt) libera as datas para nova reserva", async () => {
    const original = await block(unitId, "2026-06-01", "2026-06-05");
    await expect(block(unitId, "2026-06-02", "2026-06-04")).rejects.toThrow();

    await withTenant({ tenantId: tenant.id }, (tx) =>
      tx.availabilityBlock.update({
        where: { id: original.id },
        data: { isBlocking: false, releasedAt: new Date() },
      }),
    );

    const rebooked = await block(unitId, "2026-06-02", "2026-06-04");
    expect(rebooked.id).toBeTruthy();
  });

  it("SQL cru também não consegue burlar — a garantia é do banco, não do ORM", async () => {
    await expect(
      withTenant({ tenantId: tenant.id }, (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO otatitan."AvailabilityBlock"
             ("id", "tenantId", "unitId", "startDate", "endDate", "source", "isBlocking", "updatedAt")
           VALUES (gen_random_uuid(), $1::uuid, $2::uuid, '2026-03-12', '2026-03-14', 'MANUAL', true, now())`,
          tenant.id,
          unitId,
        ),
      ),
    ).rejects.toThrow(/23P01|exclusion|overlap/i);
  });

  it("rejeita intervalo invertido (endDate <= startDate)", async () => {
    await expect(block(unitId, "2026-09-10", "2026-09-10")).rejects.toThrow();
    await expect(block(unitId, "2026-09-10", "2026-09-05")).rejects.toThrow();
  });
});
