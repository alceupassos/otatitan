import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { diasNoIntervalo, parseDateOnly } from "@/lib/dates";
import { buscarDisponibilidadePublica } from "@/lib/direct-booking/search";
import { CanalDiretoNaoConfigurado } from "@/lib/direct-booking/tenant";
import { withTenant } from "@/lib/db/with-tenant";
import {
  cleanupTenants,
  createTestProperty,
  createTestTenant,
  createTestUnit,
} from "../helpers/db";

/**
 * Canal direto contra o banco: só o imóvel configurado entra na busca, e
 * noite sem tarifa não vende (RN-011). Precisa de Postgres.
 */

const DIARIA = 50_000;
const CHECK_IN = parseDateOnly("2027-06-10");
const CHECK_OUT = parseDateOnly("2027-06-12");

describe("canal direto — isolamento e RN-011", () => {
  const ids: string[] = [];
  let tenantSlug = "";
  let propertySlug = "";

  beforeAll(async () => {
    const tenant = await createTestTenant("direct");
    ids.push(tenant.id);
    tenantSlug = tenant.slug;
    const property = await createTestProperty(tenant.id, "MADRE 914");
    propertySlug = property.slug;
    await withTenant({ tenantId: tenant.id }, (tx) =>
      tx.property.update({ where: { id: property.id }, data: { status: "ACTIVE" } }),
    );
    const unit = await createTestUnit(tenant.id, property.id, "312");
    await withTenant({ tenantId: tenant.id }, async (tx) => {
      await tx.unit.update({
        where: { id: unit.id },
        data: { maxGuests: 6, minNights: 2, sizeM2: 40, cleaningFeeCents: 0 },
      });
      const plano = await tx.ratePlan.create({
        data: {
          unitId: unit.id,
          code: "PADRAO",
          name: "Padrão",
          status: "ACTIVE",
          isDefault: true,
          minNights: 2,
          includesCleaningFee: true,
          cancellationPolicy: "MODERATE",
        },
      });
      await tx.dailyRate.createMany({
        data: diasNoIntervalo(CHECK_IN, CHECK_OUT).map((date) => ({
          unitId: unit.id,
          ratePlanId: plano.id,
          date,
          priceCents: DIARIA,
          currency: "BRL",
        })),
      });
    });

    process.env.DIRECT_BOOKING_TENANT_SLUG = tenantSlug;
    process.env.DIRECT_BOOKING_PROPERTY_SLUG = propertySlug;
  });

  afterAll(async () => {
    delete process.env.DIRECT_BOOKING_TENANT_SLUG;
    delete process.env.DIRECT_BOOKING_PROPERTY_SLUG;
    await cleanupTenants(ids);
  });

  it("cota o studio quando há tarifa publicada", async () => {
    const r = await buscarDisponibilidadePublica({
      checkIn: CHECK_IN,
      checkOut: CHECK_OUT,
      hospedes: 2,
      pets: 0,
      parking: false,
      hoje: parseDateOnly("2027-01-01"),
    });
    expect(r.vendaveis).toHaveLength(1);
    expect(r.vendaveis[0]!.internalCode).toBe("312");
    expect(r.vendaveis[0]!.planos[0]!.nightlyTotalCents).toBe(2 * DIARIA);
  });

  it("não vende noite sem tarifa", async () => {
    const r = await buscarDisponibilidadePublica({
      checkIn: parseDateOnly("2027-08-17"),
      checkOut: parseDateOnly("2027-08-19"),
      hospedes: 2,
      pets: 0,
      parking: false,
      hoje: parseDateOnly("2027-01-01"),
    });
    expect(r.vendaveis).toHaveLength(0);
    expect(r.recusadas.some((u) => u.recusa.codigo === "SEM_TARIFA")).toBe(true);
  });

  it("recusa se o tenant não está configurado", async () => {
    const slug = process.env.DIRECT_BOOKING_TENANT_SLUG;
    delete process.env.DIRECT_BOOKING_TENANT_SLUG;
    await expect(
      buscarDisponibilidadePublica({
        checkIn: CHECK_IN,
        checkOut: CHECK_OUT,
        hospedes: 2,
        pets: 0,
        parking: false,
      }),
    ).rejects.toBeInstanceOf(CanalDiretoNaoConfigurado);
    process.env.DIRECT_BOOKING_TENANT_SLUG = slug;
  });
});
