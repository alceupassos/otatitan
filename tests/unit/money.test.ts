import { describe, expect, it } from "vitest";
import {
  MoneyParseError,
  centsToInput,
  formatMoney,
  parseMoneyToCents,
  tryParseMoneyToCents,
} from "@/lib/money";

describe("parseMoneyToCents", () => {
  it("interpreta o formato pt-BR digitado por gente", () => {
    expect(parseMoneyToCents("1.234,56")).toBe(123456);
    expect(parseMoneyToCents("0,99")).toBe(99);
    expect(parseMoneyToCents("1.000.000,00")).toBe(100_000_000);
  });

  it("interpreta o formato do input numérico (ponto decimal)", () => {
    expect(parseMoneyToCents("1234.56")).toBe(123456);
    expect(parseMoneyToCents("0.99")).toBe(99);
  });

  it("interpreta inteiros sem separador", () => {
    expect(parseMoneyToCents("1234")).toBe(123400);
    expect(parseMoneyToCents("0")).toBe(0);
  });

  it("distingue ponto de milhar de ponto decimal pelo número de dígitos", () => {
    // 3 dígitos após o ponto = milhar.
    expect(parseMoneyToCents("1.234")).toBe(123400);
    // 2 dígitos = decimal.
    expect(parseMoneyToCents("1.23")).toBe(123);
  });

  it("aceita o formato en-US com vírgula de milhar", () => {
    expect(parseMoneyToCents("1,234.56")).toBe(123456);
  });

  it("tolera prefixo R$ e espaços", () => {
    expect(parseMoneyToCents(" R$ 1.234,56 ")).toBe(123456);
    expect(parseMoneyToCents("R$50,00")).toBe(5000);
  });

  /**
   * O motivo de existir arredondamento explícito: 19.99 * 100 dá
   * 1998.9999999999998 em ponto flutuante. Truncar produziria 1998.
   */
  it("arredonda em vez de truncar — o erro clássico de ponto flutuante", () => {
    expect(parseMoneyToCents("19,99")).toBe(1999);
    expect(parseMoneyToCents("1,10")).toBe(110);
    expect(parseMoneyToCents("8,70")).toBe(870);
    expect(parseMoneyToCents("0,29")).toBe(29);
  });

  it("arredonda a fração de centavo para o mais próximo", () => {
    expect(parseMoneyToCents("1,005")).toBe(101);
    expect(parseMoneyToCents("1,004")).toBe(100);
  });

  it("recusa entrada que não é número", () => {
    for (const ruim of ["", "   ", "abc", "R$", "1,2,3", "12-34", "1e5x"]) {
      expect(() => parseMoneyToCents(ruim), ruim).toThrow(MoneyParseError);
    }
  });

  it("tryParse devolve null em vez de lançar", () => {
    expect(tryParseMoneyToCents("abc")).toBeNull();
    expect(tryParseMoneyToCents("10,00")).toBe(1000);
  });
});

describe("formatMoney", () => {
  it("formata centavos em pt-BR", () => {
    // Espaço não-quebrável entre símbolo e número: normalizado para
    // comparar sem depender do ICU.
    expect(formatMoney(123456).replace(/ /g, " ")).toBe("R$ 1.234,56");
    expect(formatMoney(0).replace(/ /g, " ")).toBe("R$ 0,00");
    expect(formatMoney(5).replace(/ /g, " ")).toBe("R$ 0,05");
  });
});

describe("centsToInput", () => {
  it("produz valor aceito por input type=number", () => {
    expect(centsToInput(123456)).toBe("1234.56");
    expect(centsToInput(0)).toBe("0.00");
  });

  it("devolve vazio para ausente — não zero", () => {
    // Um campo opcional em branco não é "R$ 0,00": diária base nula
    // significa "não definida", e exibir 0,00 mentiria sobre isso.
    expect(centsToInput(null)).toBe("");
    expect(centsToInput(undefined)).toBe("");
  });
});

describe("ida e volta", () => {
  it("centsToInput → parseMoneyToCents preserva o valor", () => {
    for (const cents of [0, 1, 99, 100, 12345, 999_999_99]) {
      expect(parseMoneyToCents(centsToInput(cents)), String(cents)).toBe(cents);
    }
  });
});
