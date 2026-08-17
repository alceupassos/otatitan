import "server-only";
import { withTenant } from "@/lib/db/with-tenant";
import { scopeFor, type ActorContext } from "@/lib/rbac/guard";

/**
 * Leituras de imóveis e unidades.
 *
 * Todas passam por `withTenant` (RLS) E por `scopeFor` — a primeira separa
 * empresas, a segunda separa linhas dentro da empresa. Um proprietário tem
 * `properties.view`, mas só dos imóveis dele; sem o `scopeFor` a permissão
 * sozinha mostraria a carteira inteira da administradora.
 */

export type PropertyFilters = {
  busca?: string;
  status?: "DRAFT" | "ACTIVE" | "INACTIVE" | "ARCHIVED";
};

export async function listProperties(
  actor: ActorContext,
  filtros: PropertyFilters = {},
) {
  return withTenant({ tenantId: actor.tenantId, userId: actor.userId }, (tx) =>
    tx.property.findMany({
      where: {
        ...scopeFor(actor, "Property"),
        // Sem filtro explícito, arquivados ficam fora: eles poluem a
        // lista do dia a dia e o caminho para vê-los é escolher o status.
        ...(filtros.status ? { status: filtros.status } : { status: { not: "ARCHIVED" } }),
        ...(filtros.busca
          ? {
              OR: [
                { name: { contains: filtros.busca, mode: "insensitive" } },
                { city: { contains: filtros.busca, mode: "insensitive" } },
                { neighborhood: { contains: filtros.busca, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        name: true,
        slug: true,
        type: true,
        status: true,
        city: true,
        state: true,
        neighborhood: true,
        updatedAt: true,
        owner: { select: { name: true } },
        _count: { select: { units: true } },
      },
      orderBy: [{ status: "asc" }, { name: "asc" }],
    }),
  );
}

/** Detalhe do imóvel + unidades. `null` se não existe ou está fora do escopo. */
export async function getProperty(actor: ActorContext, id: string) {
  return withTenant(
    { tenantId: actor.tenantId, userId: actor.userId },
    async (tx) => {
      // findFirst (não findUnique) porque o filtro de escopo precisa entrar
      // no `where` — findUnique só aceita a chave única.
      const property = await tx.property.findFirst({
        where: { id, ...scopeFor(actor, "Property") },
        include: {
          owner: { select: { id: true, name: true } },
          units: {
            where: { status: { not: "ARCHIVED" } },
            orderBy: { internalCode: "asc" },
            select: {
              id: true,
              name: true,
              internalCode: true,
              status: true,
              maxGuests: true,
              bedrooms: true,
              beds: true,
              bathrooms: true,
              baseRateCents: true,
              cleaningFeeCents: true,
              currency: true,
            },
          },
        },
      });
      return property;
    },
  );
}

export async function getUnit(actor: ActorContext, propertyId: string, unitId: string) {
  return withTenant(
    { tenantId: actor.tenantId, userId: actor.userId },
    async (tx) => {
      // O escopo é aplicado no imóvel-pai: quem não enxerga o imóvel não
      // pode alcançar a unidade por dentro.
      const property = await tx.property.findFirst({
        where: { id: propertyId, ...scopeFor(actor, "Property") },
        select: { id: true, name: true },
      });
      if (!property) return null;

      const unit = await tx.unit.findFirst({
        where: { id: unitId, propertyId },
        include: { amenities: { select: { amenityId: true } } },
      });
      if (!unit) return null;

      return { property, unit };
    },
  );
}

export async function listPropertyMedia(actor: ActorContext, propertyId: string) {
  return withTenant({ tenantId: actor.tenantId, userId: actor.userId }, async (tx) => {
    const property = await tx.property.findFirst({
      where: { id: propertyId, ...scopeFor(actor, "Property") },
      select: { id: true, slug: true },
    });
    if (!property) return null;
    const media = await tx.media.findMany({
      where: { ownerType: "PROPERTY", ownerId: propertyId },
      orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        mimeType: true,
        sizeBytes: true,
        altText: true,
        isCover: true,
        bucket: true,
        createdAt: true,
      },
    });
    return { slug: property.slug, media };
  });
}

/** Catálogo de comodidades: as globais (tenantId nulo) + as do tenant. */
export async function listAmenities(actor: ActorContext) {
  return withTenant({ tenantId: actor.tenantId, userId: actor.userId }, (tx) =>
    tx.amenity.findMany({
      select: { id: true, slug: true, name: true, category: true },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    }),
  );
}
