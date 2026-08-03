import { describe, expect, it } from "vitest";
import {
  addDias,
  diaDaSemanaCurto,
  diasNoIntervalo,
  diffDias,
  ehFimDeSemana,
  formatarData,
  inicioDoMes,
  inicioDoMesSeguinte,
  mesAnoLongo,
  parseDateOnly,
  seSobrepoem,
  toDateOnly,
  tryParseDateOnly,
} from "@/lib/dates";

describe("parseDateOnly", () => {
  it("interpreta YYYY-MM-DD como dia de calendário em UTC", () => {
    const d = parseDateOnly("2026-03-10");
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(2);
    expect(d.getUTCDate()).toBe(10);
    expect(d.getUTCHours()).toBe(0);
  });

  /**
   * O bug que a fixação em UTC evita: com `new Date("2026-03-10")` +
   * métodos locais, quem está em UTC-3 lê o dia 9. O sistema todo é
   * brasileiro, então isso aconteceria em produção, não em teoria.
   */
  it("não desloca o dia por fuso", () => {
    for (const s of ["2026-01-01", "2026-12-31", "2026-06-15"]) {
      expect(toDateOnly(parseDateOnly(s))).toBe(s);
    }
  });

  it("recusa data que não existe no calendário", () => {
    // Date.UTC aceitaria e rolaria para 03-03.
    expect(() => parseDateOnly("2026-02-30")).toThrow(/inexistente/i);
    expect(() => parseDateOnly("2026-13-01")).toThrow();
    expect(() => parseDateOnly("2026-04-31")).toThrow(/inexistente/i);
  });

  it("aceita 29 de fevereiro em ano bissexto e recusa fora dele", () => {
    expect(toDateOnly(parseDateOnly("2028-02-29"))).toBe("2028-02-29");
    expect(() => parseDateOnly("2026-02-29")).toThrow(/inexistente/i);
  });

  it("recusa formatos diferentes de YYYY-MM-DD", () => {
    for (const s of ["10/03/2026", "2026-3-10", "", "hoje", "2026-03-10T12:00"]) {
      expect(() => parseDateOnly(s), s).toThrow();
    }
  });

  it("tryParse devolve null em vez de lançar", () => {
    expect(tryParseDateOnly("2026-02-30")).toBeNull();
    expect(tryParseDateOnly("2026-03-10")).not.toBeNull();
  });
});

describe("aritmética de dias", () => {
  it("soma dias atravessando mês e ano", () => {
    expect(toDateOnly(addDias(parseDateOnly("2026-01-31"), 1))).toBe("2026-02-01");
    expect(toDateOnly(addDias(parseDateOnly("2026-12-31"), 1))).toBe("2027-01-01");
    expect(toDateOnly(addDias(parseDateOnly("2026-03-10"), -10))).toBe("2026-02-28");
  });

  it("conta noites entre duas datas", () => {
    expect(diffDias(parseDateOnly("2026-03-10"), parseDateOnly("2026-03-14"))).toBe(4);
    expect(diffDias(parseDateOnly("2026-03-10"), parseDateOnly("2026-03-10"))).toBe(0);
  });

  /**
   * Horário de verão: a diferença tem de continuar sendo dias inteiros.
   * Com aritmética em fuso local, uma transição de DST produziria 3,958…
   * dias e o arredondamento esconderia o problema só às vezes.
   */
  it("não se confunde com horário de verão", () => {
    // Em muitos fusos o DST vira em outubro/fevereiro.
    expect(diffDias(parseDateOnly("2026-10-17"), parseDateOnly("2026-10-19"))).toBe(2);
    expect(diffDias(parseDateOnly("2026-02-20"), parseDateOnly("2026-02-22"))).toBe(2);
  });
});

describe("intervalo semiaberto [inicio, fim)", () => {
  it("inclui o início e exclui o fim (RN-001)", () => {
    const dias = diasNoIntervalo(parseDateOnly("2026-03-10"), parseDateOnly("2026-03-13"));
    expect(dias.map(toDateOnly)).toEqual(["2026-03-10", "2026-03-11", "2026-03-12"]);
  });

  it("intervalo de mesmo dia não tem noite nenhuma", () => {
    expect(diasNoIntervalo(parseDateOnly("2026-03-10"), parseDateOnly("2026-03-10"))).toEqual([]);
  });
});

describe("seSobrepoem", () => {
  const d = parseDateOnly;

  it("detecta sobreposição real", () => {
    // 10–14 e 12–16 dividem 12 e 13.
    expect(seSobrepoem(d("2026-03-10"), d("2026-03-14"), d("2026-03-12"), d("2026-03-16"))).toBe(true);
    // Um intervalo dentro do outro.
    expect(seSobrepoem(d("2026-03-10"), d("2026-03-20"), d("2026-03-12"), d("2026-03-14"))).toBe(true);
  });

  /**
   * O caso que define a RN-001: uma estadia que termina no dia 14 e outra
   * que começa no dia 14 NÃO conflitam — é o same-day turnover, que é
   * negócio normal e não pode ser recusado como overbooking.
   */
  it("same-day turnover não é conflito", () => {
    expect(seSobrepoem(d("2026-03-10"), d("2026-03-14"), d("2026-03-14"), d("2026-03-18"))).toBe(false);
    expect(seSobrepoem(d("2026-03-14"), d("2026-03-18"), d("2026-03-10"), d("2026-03-14"))).toBe(false);
  });

  it("intervalos distantes não conflitam", () => {
    expect(seSobrepoem(d("2026-03-01"), d("2026-03-05"), d("2026-04-01"), d("2026-04-05"))).toBe(false);
  });
});

describe("formatação pt-BR", () => {
  it("formata a data sem depender do fuso do navegador", () => {
    expect(formatarData(parseDateOnly("2026-03-10"))).toBe("10/03/2026");
    expect(formatarData(parseDateOnly("2026-01-01"))).toBe("01/01/2026");
  });

  it("nomeia mês e ano", () => {
    expect(mesAnoLongo(parseDateOnly("2026-03-10"))).toBe("março de 2026");
    expect(mesAnoLongo(parseDateOnly("2026-12-01"))).toBe("dezembro de 2026");
  });

  it("identifica o dia da semana", () => {
    // 2026-03-10 é uma terça-feira.
    expect(diaDaSemanaCurto(parseDateOnly("2026-03-10"))).toBe("ter");
    expect(diaDaSemanaCurto(parseDateOnly("2026-03-14"))).toBe("sáb");
  });

  it("identifica fim de semana", () => {
    expect(ehFimDeSemana(parseDateOnly("2026-03-14"))).toBe(true); // sábado
    expect(ehFimDeSemana(parseDateOnly("2026-03-15"))).toBe(true); // domingo
    expect(ehFimDeSemana(parseDateOnly("2026-03-16"))).toBe(false); // segunda
  });
});

describe("limites de mês", () => {
  it("acha o primeiro dia do mês e do mês seguinte", () => {
    const d = parseDateOnly("2026-03-17");
    expect(toDateOnly(inicioDoMes(d))).toBe("2026-03-01");
    expect(toDateOnly(inicioDoMesSeguinte(d))).toBe("2026-04-01");
  });

  it("vira o ano corretamente em dezembro", () => {
    expect(toDateOnly(inicioDoMesSeguinte(parseDateOnly("2026-12-05")))).toBe("2027-01-01");
  });

  it("o intervalo do mês cobre exatamente os dias dele", () => {
    const fev = parseDateOnly("2026-02-10");
    const dias = diasNoIntervalo(inicioDoMes(fev), inicioDoMesSeguinte(fev));
    expect(dias).toHaveLength(28); // 2026 não é bissexto
    expect(toDateOnly(dias[0]!)).toBe("2026-02-01");
    expect(toDateOnly(dias[27]!)).toBe("2026-02-28");
  });
});
