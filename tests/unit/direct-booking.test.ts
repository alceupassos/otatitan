import { describe, expect, it } from "vitest";
import { calcularExtras } from "@/lib/pricing/quote";
import { MADRE914 } from "@/lib/direct-booking/config";
import { isDirectBookingHost, normalizarHost } from "@/lib/direct-booking/hosts";

describe("taxas do canal direto (site ao vivo, não diária)", () => {
  const extras = {
    includedGuests: MADRE914.includedGuests,
    extraGuestCentsPerNight: MADRE914.extraGuestCentsPerNight,
    pets: 0,
    petFeeCents: MADRE914.petFeeCents,
    parking: false,
    parkingFeeCents: MADRE914.parkingFeeCents,
  };

  it("usa os valores publicados no site, em centavos", () => {
    expect(MADRE914.extraGuestCentsPerNight).toBe(4_000);
    expect(MADRE914.petFeeCents).toBe(8_000);
    expect(MADRE914.parkingFeeCents).toBe(5_000);
    expect(MADRE914.includedGuests).toBe(2);
    expect(MADRE914.whatsapp).toBe("5511916870066");
  });

  it("não cobra extra para 2 hóspedes", () => {
    const r = calcularExtras(extras, 2, 3);
    expect(r.extraGuestCents).toBe(0);
    expect(r.petFeeCents).toBe(0);
    expect(r.parkingFeeCents).toBe(0);
  });

  it("cobra R$40/noite a partir do 3º hóspede", () => {
    const r = calcularExtras(extras, 4, 3);
    expect(r.extraGuestCount).toBe(2);
    expect(r.extraGuestCents).toBe(2 * 4_000 * 3);
  });

  it("PET é por estadia, não por animal nem por noite", () => {
    const um = calcularExtras({ ...extras, pets: 1 }, 2, 5);
    const dois = calcularExtras({ ...extras, pets: 2 }, 2, 5);
    expect(um.petFeeCents).toBe(8_000);
    expect(dois.petFeeCents).toBe(8_000);
  });

  it("garagem é por estadia", () => {
    const r = calcularExtras({ ...extras, parking: true }, 2, 4);
    expect(r.parkingFeeCents).toBe(5_000);
  });

  it("ausente = zero — o motor de diária não muda", () => {
    const r = calcularExtras(undefined, 6, 10);
    expect(r.extraGuestCents + r.petFeeCents + r.parkingFeeCents).toBe(0);
  });
});

describe("hosts do canal direto", () => {
  it("reconhece madre914.com.br com e sem www", () => {
    expect(isDirectBookingHost("www.madre914.com.br")).toBe(true);
    expect(isDirectBookingHost("madre914.com.br:443")).toBe(true);
    expect(isDirectBookingHost("otatitan.giannasiadvogados.com.br")).toBe(false);
  });

  it("normaliza porta", () => {
    expect(normalizarHost("localhost:3040")).toBe("localhost");
  });
});

describe("o que o site público NÃO inventa", () => {
  it("não publica km nem minutos de deslocamento", () => {
    const texto = [
      MADRE914.localizacao.intro,
      MADRE914.localizacao.notaDistancias,
      ...MADRE914.localizacao.grupos.flatMap((g) => g.itens),
    ].join(" ");
    expect(texto).not.toMatch(/\d[\d.,]*\s*(km|min|minuto)/i);
  });

  it("não mistura High Line nem outro imóvel", () => {
    const blob = JSON.stringify(MADRE914);
    expect(blob).not.toMatch(/high\s*line/i);
  });

  it("Open Graph usa a fachada real e o WhatsApp publicado", () => {
    const cover = MADRE914.fotos.find((f) => f.cover);
    expect(cover?.src).toBe("/fotos/fachada.jpg");
    expect(MADRE914.whatsapp).toBe("5511916870066");
  });
});
