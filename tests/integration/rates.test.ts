import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { basePrisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/with-tenant";
import { addDias, hojeUtc, toDateOnly } from "@/lib/dates";
import { getUnidadeTarifas, listUnidadesComTarifa } from "@/lib/rates/queries";
import type { ActorContext } from "@/lib/rbac/guard";
import { cleanupTenants, createTestTenant } from "../helpers/db";

/**
 * Planos de tarifa e diárias.
 *
 * O ponto de risco é o índice parcial `rate_plan_one_default_per_unit`:
 * ele permite UM plano padrão-e-ativo por unidade, então trocar de padrão
 * exige desmarcar o anterior na mesma transação. Um teste que só cria um
 * plano nunca encostaria nisso.
 */
describe("tarifas", () => {
  let tenant: { id: string };
  let unitId: string;
  let planoA: string;
  const hoje = hojeUtc();

  const actor = (): ActorContext => ({
    userId: randomUUID(),
    tenantId: tenant.id,
    roleSlug: "company_admin",
    permVersion: 1,
  });

  beforeAll(async () => {
    tenant = await createTestTenant("tarifas");

    await withTenant({ tenantId: tenant.id }, async (tx) => {
      const p = await tx.property.create({
        data: {
          name: "Imóvel das Tarifas",
          slug: `tar-${randomUUID().slice(0, 8)}`,
          type: "CHALE",
          status: "ACTIVE",
        },
      });
      const u = await tx.unit.create({
        data: {
          propertyId: p.id,
          name: "Chalé Tarifado",
          internalCode: "TAR-01",
          maxGuests: 2,
          beds: 1,
          status: "ACTIVE",
          baseRateCents: 30_000,
          cleaningFeeCents: 5_000,
          minNights: 2,
        },
      });
      unitId = u.id;
    });
  });

  afterAll(async () => {
    await cleanupTenants([tenant.id]);
    await basePrisma.$disconnect();
  });

  async function criarPlano(code: string, isDefault: boolean, status = "ACTIVE") {
    return withTenant({ tenantId: tenant.id }, async (tx) => {
      if (isDefault && status === "ACTIVE") {
        await tx.ratePlan.updateMany({
          where: { unitId, isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.ratePlan.create({
        data: {
          unitId,
          code,
          name: `Plano ${code}`,
          status: status as "ACTIVE" | "DRAFT" | "ARCHIVED",
          isDefault: isDefault && status === "ACTIVE",
          minNights: 1,
          cancellationPolicy: "MODERATE",
        },
      });
    });
  }

  it("cria o primeiro plano como padrão e ativo", async () => {
    const p = await criarPlano("PADRAO", true);
    planoA = p.id;
    expect(p.isDefault).toBe(true);
    expect(p.status).toBe("ACTIVE");
  });

  it("recusa dois planos padrão-e-ativos na mesma unidade", async () => {
    // Sem desmarcar o anterior: o índice parcial tem de barrar.
    await expect(
      withTenant({ tenantId: tenant.id }, (tx) =>
        tx.ratePlan.create({
          data: {
            unitId,
            code: "SEGUNDO",
            name: "Segundo",
            status: "ACTIVE",
            isDefault: true,
            minNights: 1,
            cancellationPolicy: "MODERATE",
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("permite um segundo plano não-padrão", async () => {
    const p = await criarPlano("PROMO", false);
    expect(p.isDefault).toBe(false);
  });

  it("troca o padrão desmarcando o anterior", async () => {
    const promo = await withTenant({ tenantId: tenant.id }, (tx) =>
      tx.ratePlan.findFirstOrThrow({ where: { unitId, code: "PROMO" } }),
    );

    await withTenant({ tenantId: tenant.id }, async (tx) => {
      await tx.ratePlan.updateMany({
        where: { unitId, isDefault: true },
        data: { isDefault: false },
      });
      await tx.ratePlan.update({
        where: { id: promo.id },
        data: { isDefault: true, status: "ACTIVE" },
      });
    });

    const planos = await withTenant({ tenantId: tenant.id }, (tx) =>
      tx.ratePlan.findMany({ where: { unitId }, select: { code: true, isDefault: true } }),
    );
    const padroes = planos.filter((p) => p.isDefault);
    expect(padroes).toHaveLength(1);
    expect(padroes[0]!.code).toBe("PROMO");

    // Devolve o padrão para PADRAO, para os testes seguintes.
    await withTenant({ tenantId: tenant.id }, async (tx) => {
      await tx.ratePlan.updateMany({ where: { unitId, isDefault: true }, data: { isDefault: false } });
      await tx.ratePlan.update({ where: { id: planoA }, data: { isDefault: true } });
    });
  });

  it("recusa código de plano duplicado na mesma unidade", async () => {
    await expect(criarPlano("PADRAO", false)).rejects.toThrow();
  });

  it("recusa diária com preço zero ou negativo (CHECK do banco)", async () => {
    for (const preco of [0, -100]) {
      await expect(
        withTenant({ tenantId: tenant.id }, (tx) =>
          tx.dailyRate.create({
            data: {
              ratePlanId: planoA,
              unitId,
              date: addDias(hoje, 200),
              priceCents: preco,
            },
          }),
        ),
        String(preco),
      ).rejects.toThrow();
    }
  });

  it("publica diárias e reporta a cobertura", async () => {
    await withTenant({ tenantId: tenant.id }, async (tx) => {
      for (let i = 0; i < 10; i++) {
        await tx.dailyRate.create({
          data: {
            ratePlanId: planoA,
            unitId,
            date: addDias(hoje, i),
            priceCents: 35_000,
            source: "BULK_EDIT",
          },
        });
      }
    });

    const lista = await listUnidadesComTarifa(actor(), hoje);
    const linha = lista.find((l) => l.unitId === unitId)!;
    expect(linha.diasCobertos).toBe(10);
    // A primeira lacuna é o 11º dia — o primeiro sem tarifa.
    expect(linha.primeiraLacuna).toBe(toDateOnly(addDias(hoje, 10)));
    expect(linha.planoPadrao?.code).toBe("PADRAO");
  });

  it("recusa duas diárias para o mesmo plano, unidade e data", async () => {
    await expect(
      withTenant({ tenantId: tenant.id }, (tx) =>
        tx.dailyRate.create({
          data: { ratePlanId: planoA, unitId, date: hoje, priceCents: 40_000 },
        }),
      ),
    ).rejects.toThrow();
  });

  /**
   * RN-011: noite fechada não conta como coberta. Fechar é diferente de
   * publicar preço — quem fecha quer que a data NÃO venda.
   */
  it("diária fechada não conta como cobertura", async () => {
    await withTenant({ tenantId: tenant.id }, (tx) =>
      tx.dailyRate.update({
        where: {
          tenantId_ratePlanId_unitId_date: {
            tenantId: tenant.id,
            ratePlanId: planoA,
            unitId,
            date: hoje,
          },
        },
        data: { isClosed: true },
      }),
    );

    const lista = await listUnidadesComTarifa(actor(), hoje);
    const linha = lista.find((l) => l.unitId === unitId)!;
    expect(linha.diasCobertos).toBe(9);
    // A lacuna agora é hoje, porque hoje está fechado.
    expect(linha.primeiraLacuna).toBe(toDateOnly(hoje));
  });

  it("traz planos e diárias do mês para a grade", async () => {
    const dados = await getUnidadeTarifas(
      actor(),
      unitId,
      hoje,
      addDias(hoje, 10),
    );
    expect(dados).not.toBeNull();
    expect(dados!.unit.internalCode).toBe("TAR-01");
    expect(dados!.planos.length).toBeGreaterThanOrEqual(2);
    // Plano padrão vem primeiro (ordenação isDefault desc).
    expect(dados!.planos[0]!.isDefault).toBe(true);
    expect(dados!.tarifas).toHaveLength(10);
  });

  it("unidade de outro escopo não é alcançável", async () => {
    const dados = await getUnidadeTarifas(
      { ...actor(), roleSlug: "guest" },
      unitId,
      hoje,
      addDias(hoje, 10),
    );
    expect(dados).toBeNull();
  });
});
