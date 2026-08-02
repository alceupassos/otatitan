import { describe, expect, it } from "vitest";
import {
  propertySchema,
  slugify,
  unitSchema,
} from "@/lib/properties/schemas";

const IMOVEL_OK = {
  name: "Casa Vista Mar",
  type: "HOUSE",
  status: "ACTIVE",
  description: "",
  addressLine1: "Rua A, 10",
  addressLine2: "",
  neighborhood: "Centro",
  city: "Paraty",
  state: "rj",
  postalCode: "23970-000",
  checkInTime: "15:00",
  checkOutTime: "11:00",
  houseRules: "",
};

const UNIDADE_OK = {
  name: "Casa inteira",
  internalCode: "VM-CASA",
  status: "ACTIVE",
  maxGuests: "8",
  bedrooms: "4",
  beds: "6",
  bathrooms: "3",
  sizeM2: "210",
  baseRateCents: "1.450,00",
  cleaningFeeCents: "320,00",
  minNights: "3",
  maxNights: "",
  amenityIds: [],
};

describe("slugify", () => {
  it("remove acentos e normaliza", () => {
    expect(slugify("Casa Vista Mar")).toBe("casa-vista-mar");
    expect(slugify("Pousada São João")).toBe("pousada-sao-joao");
    expect(slugify("Chalé Nº 3 — Ilha Grande")).toBe("chale-n-3-ilha-grande");
  });

  it("não deixa hífen sobrando nas pontas", () => {
    expect(slugify("  ...Casa!!  ")).toBe("casa");
    expect(slugify("---")).toBe("");
  });

  it("limita o tamanho", () => {
    expect(slugify("a".repeat(200)).length).toBeLessThanOrEqual(80);
  });

  it("preserva ç e vogais acentuadas como letras simples", () => {
    expect(slugify("Açaí Hostel")).toBe("acai-hostel");
  });
});

describe("propertySchema", () => {
  it("aceita um imóvel válido e normaliza a UF", () => {
    const r = propertySchema.safeParse(IMOVEL_OK);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.state).toBe("RJ");
  });

  it("converte texto opcional vazio em null", () => {
    const r = propertySchema.parse(IMOVEL_OK);
    // "" no formulário significa "não informado", não string vazia no banco.
    expect(r.description).toBeNull();
    expect(r.addressLine2).toBeNull();
    expect(r.houseRules).toBeNull();
  });

  it("exige nome com ao menos 2 caracteres", () => {
    const r = propertySchema.safeParse({ ...IMOVEL_OK, name: "A" });
    expect(r.success).toBe(false);
  });

  it("recusa UF inexistente", () => {
    expect(propertySchema.safeParse({ ...IMOVEL_OK, state: "XX" }).success).toBe(false);
  });

  it("aceita UF em branco (endereço incompleto é permitido)", () => {
    const r = propertySchema.safeParse({ ...IMOVEL_OK, state: "" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.state).toBeNull();
  });

  it("recusa horário fora do formato HH:MM", () => {
    for (const hora of ["25:00", "15h", "9:00", "15:60", ""]) {
      expect(
        propertySchema.safeParse({ ...IMOVEL_OK, checkInTime: hora }).success,
        hora,
      ).toBe(false);
    }
  });

  it("não aceita status ARCHIVED pelo formulário", () => {
    // Arquivar é uma ação própria, com regras — não uma escolha no select.
    expect(propertySchema.safeParse({ ...IMOVEL_OK, status: "ARCHIVED" }).success).toBe(
      false,
    );
  });
});

describe("unitSchema", () => {
  it("aceita uma unidade válida e converte dinheiro para centavos", () => {
    const r = unitSchema.safeParse(UNIDADE_OK);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.baseRateCents).toBe(145_000);
      expect(r.data.cleaningFeeCents).toBe(32_000);
      expect(r.data.maxNights).toBeNull();
    }
  });

  it("aceita diária base em branco — nem toda unidade tem preço definido", () => {
    const r = unitSchema.safeParse({ ...UNIDADE_OK, baseRateCents: "" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.baseRateCents).toBeNull();
  });

  it("recusa valor monetário sem sentido", () => {
    expect(unitSchema.safeParse({ ...UNIDADE_OK, baseRateCents: "abc" }).success).toBe(
      false,
    );
  });

  it("recusa valor monetário negativo", () => {
    expect(
      unitSchema.safeParse({ ...UNIDADE_OK, cleaningFeeCents: "-10,00" }).success,
    ).toBe(false);
  });

  it("recusa estadia máxima menor que a mínima", () => {
    const r = unitSchema.safeParse({
      ...UNIDADE_OK,
      minNights: "5",
      maxNights: "3",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path[0] === "maxNights")).toBe(true);
    }
  });

  it("aceita estadia máxima igual à mínima", () => {
    expect(
      unitSchema.safeParse({ ...UNIDADE_OK, minNights: "3", maxNights: "3" }).success,
    ).toBe(true);
  });

  it("exige ao menos uma cama quando a unidade acomoda gente", () => {
    const r = unitSchema.safeParse({ ...UNIDADE_OK, beds: "0" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path[0] === "beds")).toBe(true);
    }
  });

  it("recusa capacidade zero ou negativa", () => {
    expect(unitSchema.safeParse({ ...UNIDADE_OK, maxGuests: "0" }).success).toBe(false);
    expect(unitSchema.safeParse({ ...UNIDADE_OK, maxGuests: "-1" }).success).toBe(false);
  });

  it("recusa número fracionário onde só cabe inteiro", () => {
    expect(unitSchema.safeParse({ ...UNIDADE_OK, bedrooms: "2.5" }).success).toBe(false);
  });

  it("exige nome e código interno", () => {
    expect(unitSchema.safeParse({ ...UNIDADE_OK, name: "  " }).success).toBe(false);
    expect(unitSchema.safeParse({ ...UNIDADE_OK, internalCode: "" }).success).toBe(false);
  });

  it("area em branco vira null; area invalida e recusada", () => {
    const ok = unitSchema.safeParse({ ...UNIDADE_OK, sizeM2: "" });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.sizeM2).toBeNull();

    expect(unitSchema.safeParse({ ...UNIDADE_OK, sizeM2: "0" }).success).toBe(false);
  });
});
