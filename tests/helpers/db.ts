import { randomUUID } from "node:crypto";
import { basePrisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/with-tenant";

export { basePrisma, withTenant };

/**
 * Cria um tenant de teste. Tenant não é tenant-scoped (não tem RLS), então
 * pode ser criado direto pela role de aplicação, sem contexto.
 */
export async function createTestTenant(label: string) {
  const slug = `test-${label}-${randomUUID().slice(0, 8)}`;
  return basePrisma.tenant.create({
    data: { slug, name: `Tenant ${label}`, status: "ACTIVE" },
  });
}

export async function createTestProperty(tenantId: string, name: string) {
  return withTenant({ tenantId }, (tx) =>
    tx.property.create({
      data: {
        name,
        slug: `${name.toLowerCase().replace(/\s+/g, "-")}-${randomUUID().slice(0, 6)}`,
        type: "HOUSE",
        status: "ACTIVE",
        city: "Angra dos Reis",
        state: "RJ",
      },
    }),
  );
}

export async function createTestUnit(
  tenantId: string,
  propertyId: string,
  internalCode: string,
) {
  return withTenant({ tenantId }, (tx) =>
    tx.unit.create({
      data: {
        propertyId,
        name: `Unidade ${internalCode}`,
        internalCode,
        maxGuests: 4,
        bedrooms: 2,
        beds: 2,
        status: "ACTIVE",
        baseRateCents: 50_000,
        cleaningFeeCents: 12_000,
      },
    }),
  );
}

/** Remove os tenants de teste e tudo em cascata. */
export async function cleanupTenants(tenantIds: string[]) {
  for (const tenantId of tenantIds) {
    await withTenant({ tenantId }, async (tx) => {
      await tx.media.deleteMany({});
      await tx.consent.deleteMany({});
      await tx.availabilityBlock.deleteMany({});
      await tx.reservationGuest.deleteMany({});
      await tx.payment.deleteMany({});
      await tx.task.deleteMany({});
      await tx.reservation.deleteMany({});
      await tx.dailyRate.deleteMany({});
      await tx.ratePlan.deleteMany({});
      await tx.unitAmenity.deleteMany({});
      await tx.unit.deleteMany({});
      await tx.property.deleteMany({});
      await tx.guest.deleteMany({});
      await tx.owner.deleteMany({});
    });
    await basePrisma.tenant.delete({ where: { id: tenantId } });
  }
}
