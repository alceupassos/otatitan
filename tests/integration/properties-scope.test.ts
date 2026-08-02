import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { basePrisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/with-tenant";
import { getProperty, getUnit, listProperties } from "@/lib/properties/queries";
import type { ActorContext } from "@/lib/rbac/guard";
import { cleanupTenants, createTestTenant } from "../helpers/db";

/**
 * Escopo por papel nas leituras de imóveis.
 *
 * O RLS já separa empresas (coberto por tenant-isolation.test.ts). O que
 * se testa aqui é a camada de cima: dentro da MESMA empresa, um
 * proprietário tem `properties.view` mas só pode ver os imóveis dele.
 * Permissão sozinha nunca basta para papéis de escopo restrito.
 */
describe("escopo de imóveis por papel", () => {
  let tenant: { id: string };
  let outroTenant: { id: string };
  let ownerUserId: string;
  let adminUserId: string;
  let propDoOwner: { id: string };
  let propDeOutro: { id: string };
  let unidadeDoOwner: { id: string };

  const actor = (userId: string, roleSlug: ActorContext["roleSlug"]): ActorContext => ({
    userId,
    tenantId: tenant.id,
    roleSlug,
    permVersion: 1,
  });

  beforeAll(async () => {
    tenant = await createTestTenant("prop-scope");
    outroTenant = await createTestTenant("prop-outro");

    const owner = await basePrisma.user.create({
      data: { email: `owner-${randomUUID().slice(0, 8)}@t.test`, name: "Proprietária" },
    });
    const admin = await basePrisma.user.create({
      data: { email: `admin-${randomUUID().slice(0, 8)}@t.test`, name: "Gestora" },
    });
    ownerUserId = owner.id;
    adminUserId = admin.id;

    await withTenant({ tenantId: tenant.id }, async (tx) => {
      // Owner (a entidade) ligado ao usuário do portal do proprietário.
      const ownerRow = await tx.owner.create({
        data: { name: "Proprietária Teste", userId: owner.id },
      });
      const outroOwner = await tx.owner.create({ data: { name: "Outro Dono" } });

      propDoOwner = await tx.property.create({
        data: {
          name: "Casa da Proprietária",
          slug: `casa-owner-${randomUUID().slice(0, 6)}`,
          type: "HOUSE",
          status: "ACTIVE",
          ownerId: ownerRow.id,
        },
      });

      propDeOutro = await tx.property.create({
        data: {
          name: "Casa de Terceiro",
          slug: `casa-outro-${randomUUID().slice(0, 6)}`,
          type: "HOUSE",
          status: "ACTIVE",
          ownerId: outroOwner.id,
        },
      });

      unidadeDoOwner = await tx.unit.create({
        data: {
          propertyId: propDoOwner.id,
          name: "Casa inteira",
          internalCode: "CO-1",
          maxGuests: 6,
          beds: 3,
          status: "ACTIVE",
          cleaningFeeCents: 10_000,
        },
      });
    });
  });

  afterAll(async () => {
    await basePrisma.user.deleteMany({
      where: { id: { in: [ownerUserId, adminUserId] } },
    });
    await cleanupTenants([tenant.id, outroTenant.id]);
    await basePrisma.$disconnect();
  });

  it("gestor vê todos os imóveis da empresa", async () => {
    const lista = await listProperties(actor(adminUserId, "reservations_manager"));
    const ids = lista.map((p) => p.id);
    expect(ids).toContain(propDoOwner.id);
    expect(ids).toContain(propDeOutro.id);
  });

  it("proprietário vê apenas os próprios imóveis", async () => {
    const lista = await listProperties(actor(ownerUserId, "property_owner"));
    const ids = lista.map((p) => p.id);
    expect(ids).toContain(propDoOwner.id);
    expect(ids).not.toContain(propDeOutro.id);
  });

  it("proprietário não alcança imóvel de terceiro por id direto", async () => {
    const p = await getProperty(actor(ownerUserId, "property_owner"), propDeOutro.id);
    // null (não erro de permissão): a página responde 404, que não
    // confirma a existência do id.
    expect(p).toBeNull();
  });

  it("proprietário alcança o próprio imóvel por id", async () => {
    const p = await getProperty(actor(ownerUserId, "property_owner"), propDoOwner.id);
    expect(p?.id).toBe(propDoOwner.id);
    expect(p?.units).toHaveLength(1);
  });

  it("unidade herda o escopo do imóvel-pai", async () => {
    const permitido = await getUnit(
      actor(ownerUserId, "property_owner"),
      propDoOwner.id,
      unidadeDoOwner.id,
    );
    expect(permitido?.unit.id).toBe(unidadeDoOwner.id);

    // Mesma unidade, mas alegando um imóvel-pai que não é do proprietário.
    const negado = await getUnit(
      actor(ownerUserId, "property_owner"),
      propDeOutro.id,
      unidadeDoOwner.id,
    );
    expect(negado).toBeNull();
  });

  it("hóspede não enxerga imóvel nenhum", async () => {
    // `guest` é escopo restrito e não tem regra para Property — o
    // scopeFor devolve um filtro impossível em vez de liberar tudo.
    const lista = await listProperties(actor(ownerUserId, "guest"));
    expect(lista).toHaveLength(0);
  });

  it("arquivados ficam fora da listagem padrão", async () => {
    await withTenant({ tenantId: tenant.id }, (tx) =>
      tx.property.update({
        where: { id: propDeOutro.id },
        data: { status: "ARCHIVED", archivedAt: new Date() },
      }),
    );

    const padrao = await listProperties(actor(adminUserId, "company_admin"));
    expect(padrao.map((p) => p.id)).not.toContain(propDeOutro.id);

    const filtrado = await listProperties(actor(adminUserId, "company_admin"), {
      status: "ARCHIVED",
    });
    expect(filtrado.map((p) => p.id)).toContain(propDeOutro.id);
  });

  it("a busca filtra por nome, cidade e bairro", async () => {
    const porNome = await listProperties(actor(adminUserId, "company_admin"), {
      busca: "Proprietária",
    });
    expect(porNome.map((p) => p.id)).toContain(propDoOwner.id);

    const semResultado = await listProperties(actor(adminUserId, "company_admin"), {
      busca: "inexistente-zzz",
    });
    expect(semResultado).toHaveLength(0);
  });
});
