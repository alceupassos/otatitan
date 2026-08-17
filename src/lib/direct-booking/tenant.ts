import "server-only";
import { basePrisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/with-tenant";
import {
  directBookingPropertySlug,
  directBookingTenantSlug,
} from "./config";

export class CanalDiretoNaoConfigurado extends Error {
  constructor() {
    super(
      "Canal direto sem DIRECT_BOOKING_TENANT_SLUG — o marketing funciona, a disponibilidade não.",
    );
    this.name = "CanalDiretoNaoConfigurado";
  }
}

export type CanalDiretoResolvido = {
  tenantId: string;
  propertyId: string;
  propertySlug: string;
  propertyName: string;
};

/**
 * Resolve o tenant e o imóvel do canal direto.
 *
 * Tenant não é RLS-scoped (plataforma); o imóvel é lido dentro de
 * `withTenant`. Sem slug de tenant no ambiente, o canal não inventa
 * empresa — recusa.
 */
export async function resolverCanalDireto(): Promise<CanalDiretoResolvido> {
  const tenantSlug = directBookingTenantSlug();
  if (!tenantSlug) throw new CanalDiretoNaoConfigurado();

  const tenant = await basePrisma.tenant.findUnique({
    where: { slug: tenantSlug },
    select: { id: true, status: true },
  });
  if (!tenant || tenant.status === "SUSPENDED" || tenant.status === "CANCELLED") {
    throw new CanalDiretoNaoConfigurado();
  }

  const propertySlug = directBookingPropertySlug();
  const property = await withTenant({ tenantId: tenant.id }, (tx) =>
    tx.property.findFirst({
      where: { slug: propertySlug, status: "ACTIVE" },
      select: { id: true, slug: true, name: true },
    }),
  );
  if (!property) throw new CanalDiretoNaoConfigurado();

  return {
    tenantId: tenant.id,
    propertyId: property.id,
    propertySlug: property.slug,
    propertyName: property.name,
  };
}
