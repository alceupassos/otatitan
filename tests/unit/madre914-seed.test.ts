import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { propertySchema, unitSchema } from "@/lib/properties/schemas";

const arquivo = JSON.parse(
  readFileSync(path.join(process.cwd(), "scripts/data/madre914.json"), "utf8"),
) as {
  imovel: Record<string, string>;
  unidades?: Record<string, string>[];
  gerarUnidades?: unknown;
  arquivarUnidadesAusentes?: boolean;
};

describe("scripts/data/madre914.json — operação real", () => {
  it("não gera 40 apartamentos fictícios", () => {
    expect(arquivo.gerarUnidades).toBeUndefined();
    expect(arquivo.unidades).toHaveLength(4);
    expect(arquivo.arquivarUnidadesAusentes).toBe(true);
  });

  it("lista só os 4 studios reais", () => {
    const codigos = arquivo.unidades!.map((u) => u.internalCode).sort();
    expect(codigos).toEqual(["312", "409", "506", "609"]);
  });

  it("tem o endereço publicado no site ao vivo e não inventa CEP", () => {
    expect(arquivo.imovel.addressLine1).toMatch(/Paes de Barros/);
    expect(arquivo.imovel.addressLine1).toMatch(/1179/);
    expect(arquivo.imovel.neighborhood).toBe("Mooca");
    expect(arquivo.imovel.city).toBe("São Paulo");
    expect(arquivo.imovel.postalCode).toBe("");
    expect(arquivo.imovel.checkInTime).toBe("15:00");
    expect(arquivo.imovel.checkOutTime).toBe("11:00");
  });

  it("não inventa diária nem reconhecimento facial", () => {
    expect(arquivo.imovel.houseRules).not.toMatch(/reconhecimento facial/i);
    expect(arquivo.imovel.houseRules).not.toMatch(/high\s*line/i);
    expect(arquivo.imovel.addressLine1).not.toMatch(/tatuap/i);
    for (const u of arquivo.unidades!) {
      expect(u.baseRateCents).toBe("");
      expect(u.maxGuests).toBe("6");
      expect(u.sizeM2).toBe("40");
      expect(u.minNights).toBe("2");
      expect(u.status).toBe("ACTIVE");
    }
  });

  it("passa no mesmo schema da UI", () => {
    const imovel = propertySchema.safeParse(arquivo.imovel);
    expect(imovel.success).toBe(true);
    for (const u of arquivo.unidades!) {
      const { floor: _floor, ...resto } = u;
      const parsed = unitSchema.safeParse({ ...resto, amenityIds: [] });
      expect(parsed.success, u.internalCode).toBe(true);
    }
  });

  it("tem as fotos reais do edifício no repositório", () => {
    for (const nome of ["fachada.jpg", "placa.jpg", "lobby-estar.jpg", "lobby-corredor.jpg"]) {
      expect(existsSync(path.join(process.cwd(), "public", "fotos", nome)), nome).toBe(true);
    }
  });
});
