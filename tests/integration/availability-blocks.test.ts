import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { basePrisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/with-tenant";
import { getCalendario } from "@/lib/availability/queries";
import { addDias, hojeUtc, toDateOnly } from "@/lib/dates";
import type { ActorContext } from "@/lib/rbac/guard";
import { cleanupTenants, createTestTenant } from "../helpers/db";

/**
 * Bloqueios de calendário: a leitura da grade e a garantia anti-overbooking
 * (RN-002) vista de fora do banco.
 *
 * O teste de `availability-constraint.test.ts` já cobre a constraint em si.
 * Aqui interessa o que o calendário mostra e o que ele recusa — incluindo o
 * same-day turnover, que é o caso onde é fácil errar para o lado de
 * recusar negócio legítimo.
 */
describe("calendário de ocupação", () => {
  let tenant: { id: string };
  let unitId: string;
  let propertyId: string;
  const actor = (): ActorContext => ({
    userId: randomUUID(),
    tenantId: tenant.id,
    roleSlug: "company_admin",
    permVersion: 1,
  });

  const hoje = hojeUtc();

  beforeAll(async () => {
    tenant = await createTestTenant("calendario");

    await withTenant({ tenantId: tenant.id }, async (tx) => {
      const p = await tx.property.create({
        data: {
          name: "Imóvel do Calendário",
          slug: `cal-${randomUUID().slice(0, 8)}`,
          type: "POUSADA",
          status: "ACTIVE",
        },
      });
      propertyId = p.id;

      const u = await tx.unit.create({
        data: {
          propertyId: p.id,
          name: "Chalé 1",
          internalCode: "CAL-01",
          maxGuests: 4,
          beds: 2,
          status: "ACTIVE",
          cleaningFeeCents: 5000,
        },
      });
      unitId = u.id;
    });
  });

  afterAll(async () => {
    await cleanupTenants([tenant.id]);
    await basePrisma.$disconnect();
  });

  async function bloquear(deOffset: number, ateOffsetExclusivo: number) {
    return withTenant({ tenantId: tenant.id }, (tx) =>
      tx.availabilityBlock.create({
        data: {
          unitId,
          startDate: addDias(hoje, deOffset),
          endDate: addDias(hoje, ateOffsetExclusivo),
          source: "MAINTENANCE",
          isBlocking: true,
          reason: `bloqueio ${deOffset}-${ateOffsetExclusivo}`,
        },
      }),
    );
  }

  it("mostra a unidade mesmo sem ocupação nenhuma", async () => {
    const linhas = await getCalendario(actor(), hoje, addDias(hoje, 30));
    const linha = linhas.find((l) => l.unitId === unitId);
    expect(linha).toBeDefined();
    expect(linha!.internalCode).toBe("CAL-01");
    expect(linha!.ocupacao.size).toBe(0);
  });

  it("marca exatamente as noites do intervalo semiaberto", async () => {
    // Bloqueia [+5, +8) → noites 5, 6 e 7. O dia 8 fica livre.
    await bloquear(5, 8);

    const linhas = await getCalendario(actor(), hoje, addDias(hoje, 30));
    const oc = linhas.find((l) => l.unitId === unitId)!.ocupacao;

    expect(oc.has(toDateOnly(addDias(hoje, 5)))).toBe(true);
    expect(oc.has(toDateOnly(addDias(hoje, 6)))).toBe(true);
    expect(oc.has(toDateOnly(addDias(hoje, 7)))).toBe(true);
    // Fim exclusivo: o dia 8 NÃO está ocupado (RN-001).
    expect(oc.has(toDateOnly(addDias(hoje, 8)))).toBe(false);
    expect(oc.has(toDateOnly(addDias(hoje, 4)))).toBe(false);
  });

  it("marca início e fim do bloco, para desenhar a faixa", async () => {
    const linhas = await getCalendario(actor(), hoje, addDias(hoje, 30));
    const oc = linhas.find((l) => l.unitId === unitId)!.ocupacao;

    expect(oc.get(toDateOnly(addDias(hoje, 5)))!.ehInicio).toBe(true);
    expect(oc.get(toDateOnly(addDias(hoje, 6)))!.ehInicio).toBe(false);
    expect(oc.get(toDateOnly(addDias(hoje, 7)))!.ehFim).toBe(true);
    expect(oc.get(toDateOnly(addDias(hoje, 6)))!.ehFim).toBe(false);
  });

  /**
   * O caso que separa "protege contra overbooking" de "recusa negócio
   * bom": um bloqueio que termina no dia 8 e outro que começa no dia 8
   * têm de coexistir.
   */
  it("permite same-day turnover — fim de um é início do outro", async () => {
    await expect(bloquear(8, 11)).resolves.toBeDefined();

    const linhas = await getCalendario(actor(), hoje, addDias(hoje, 30));
    const oc = linhas.find((l) => l.unitId === unitId)!.ocupacao;
    // Agora o dia 8 está ocupado — pelo SEGUNDO bloco.
    expect(oc.get(toDateOnly(addDias(hoje, 8)))!.ehInicio).toBe(true);
  });

  it("recusa sobreposição real (RN-002, constraint de exclusão)", async () => {
    // [+6, +7) cai dentro do bloco [+5, +8).
    await expect(bloquear(6, 7)).rejects.toThrow();
    // Sobreposição parcial pela borda esquerda.
    await expect(bloquear(4, 6)).rejects.toThrow();
    // Bloco que engole os dois existentes.
    await expect(bloquear(1, 20)).rejects.toThrow();
  });

  it("bloqueio liberado deixa a data livre de novo", async () => {
    const bloco = await bloquear(25, 27);

    let linhas = await getCalendario(actor(), hoje, addDias(hoje, 30));
    expect(linhas.find((l) => l.unitId === unitId)!.ocupacao.has(
      toDateOnly(addDias(hoje, 25)),
    )).toBe(true);

    await withTenant({ tenantId: tenant.id }, (tx) =>
      tx.availabilityBlock.update({
        where: { id: bloco.id },
        data: { releasedAt: new Date(), isBlocking: false },
      }),
    );

    linhas = await getCalendario(actor(), hoje, addDias(hoje, 30));
    expect(linhas.find((l) => l.unitId === unitId)!.ocupacao.has(
      toDateOnly(addDias(hoje, 25)),
    )).toBe(false);

    // E o período volta a aceitar bloqueio — liberar não é só cosmético.
    await expect(bloquear(25, 27)).resolves.toBeDefined();
  });

  it("recorta o bloco à janela exibida", async () => {
    // Bloco que começa antes e termina depois da janela consultada.
    await withTenant({ tenantId: tenant.id }, (tx) =>
      tx.availabilityBlock.create({
        data: {
          unitId,
          startDate: addDias(hoje, 40),
          endDate: addDias(hoje, 70),
          source: "OWNER_STAY",
          isBlocking: true,
        },
      }),
    );

    // Janela [+50, +55): só 5 noites do meio do bloco aparecem.
    const linhas = await getCalendario(
      actor(),
      addDias(hoje, 50),
      addDias(hoje, 55),
    );
    const oc = linhas.find((l) => l.unitId === unitId)!.ocupacao;
    expect(oc.size).toBe(5);
    // Nenhuma das pontas visíveis é o começo real do bloco.
    expect([...oc.values()].some((o) => o.ehInicio)).toBe(false);
    expect([...oc.values()].some((o) => o.ehFim)).toBe(false);
  });

  it("unidade de imóvel arquivado sai do calendário", async () => {
    await withTenant({ tenantId: tenant.id }, (tx) =>
      tx.property.update({
        where: { id: propertyId },
        data: { status: "ARCHIVED", archivedAt: new Date() },
      }),
    );

    const linhas = await getCalendario(actor(), hoje, addDias(hoje, 30));
    expect(linhas.find((l) => l.unitId === unitId)).toBeUndefined();
  });
});
