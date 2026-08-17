import { describe, expect, it } from "vitest";
import { addDias, parseDateOnly, toDateOnly } from "@/lib/dates";
import { EstadiaInvalida, RECUSA } from "@/lib/pricing/errors";
import {
  cotar,
  cotarTodosPlanos,
  precoConfere,
  VERSAO_COTACAO,
  type EntradaCotacao,
  type PlanoCotavel,
  type TarifaCotavel,
  type UnidadeCotavel,
} from "@/lib/pricing/quote";

/**
 * O motor é puro de propósito: estas fixtures são o banco inteiro de que
 * ele precisa. Sem Postgres, sem mock de Prisma — as regras que decidem
 * se uma unidade é vendável são o miolo do produto e precisam de teste
 * barato o bastante para rodar a cada salvamento.
 */

const HOJE = parseDateOnly("2026-03-01");
const CHECK_IN = parseDateOnly("2026-03-10");
const CHECK_OUT = parseDateOnly("2026-03-13"); // 3 noites: 10, 11, 12
const AGORA = new Date("2026-03-01T12:00:00.000Z");

function unidade(over: Partial<UnidadeCotavel> = {}): UnidadeCotavel {
  return {
    id: "unit-1",
    maxGuests: 4,
    minNights: 1,
    maxNights: null,
    cleaningFeeCents: 15_000,
    currency: "BRL",
    ...over,
  };
}

function plano(over: Partial<PlanoCotavel> = {}): PlanoCotavel {
  return {
    id: "plan-padrao",
    code: "PADRAO",
    name: "Tarifa padrão",
    currency: "BRL",
    status: "ACTIVE",
    isDefault: true,
    priority: 0,
    minNights: 1,
    maxNights: null,
    minAdvanceDays: 0,
    maxAdvanceDays: null,
    includesCleaningFee: false,
    cancellationPolicy: "MODERATE",
    validFrom: null,
    validTo: null,
    ...over,
  };
}

/** Uma tarifa por noite de `[inicio, fim)`, todas com o mesmo preço. */
function tarifas(
  ratePlanId: string,
  precoCents: number,
  over: Partial<TarifaCotavel> = {},
  inicio = CHECK_IN,
  fim = CHECK_OUT,
): TarifaCotavel[] {
  const linhas: TarifaCotavel[] = [];
  for (let d = inicio; d < fim; d = addDias(d, 1)) {
    linhas.push({
      ratePlanId,
      date: d,
      priceCents: precoCents,
      currency: "BRL",
      minNights: null,
      isClosed: false,
      closedToArrival: false,
      closedToDeparture: false,
      ...over,
    });
  }
  return linhas;
}

function entrada(over: Partial<EntradaCotacao> = {}): EntradaCotacao {
  return {
    unit: unidade(),
    planos: [plano()],
    tarifas: tarifas("plan-padrao", 30_000),
    checkIn: CHECK_IN,
    checkOut: CHECK_OUT,
    hospedes: 2,
    hoje: HOJE,
    agora: AGORA,
    ...over,
  };
}

describe("cotação — caminho feliz", () => {
  it("soma as diárias e a taxa de limpeza em centavos inteiros", () => {
    const r = cotar(entrada());
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.cotacao.nights).toBe(3);
    expect(r.cotacao.noites.map((n) => n.data)).toEqual([
      "2026-03-10",
      "2026-03-11",
      "2026-03-12",
    ]);
    expect(r.cotacao.nightlyTotalCents).toBe(90_000);
    expect(r.cotacao.feesTotalCents).toBe(15_000);
    expect(r.cotacao.totalCents).toBe(105_000);
    expect(Number.isInteger(r.cotacao.totalCents)).toBe(true);
  });

  it("não cobra a limpeza duas vezes quando o plano já a inclui", () => {
    const r = cotar(
      entrada({ planos: [plano({ includesCleaningFee: true })] }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.cotacao.feesTotalCents).toBe(0);
    expect(r.cotacao.cleaningFeeIncluso).toBe(true);
    expect(r.cotacao.totalCents).toBe(90_000);
  });

  it("gera um snapshot serializável com versão e quebra por noite (RN-003)", () => {
    const r = cotar(entrada());
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const snap = r.cotacao.snapshot;
    expect(snap.versao).toBe(VERSAO_COTACAO);
    expect(snap.cotadaEm).toBe(AGORA.toISOString());
    expect(snap.noites).toHaveLength(3);
    expect(snap.totalCents).toBe(105_000);
    // Precisa sobreviver ao ida-e-volta do JSON: é assim que ele vai parar
    // na coluna `quoteSnapshot`.
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
  });

  it("reconhece total divergente do cliente (RN-003)", () => {
    const r = cotar(entrada());
    if (!r.ok) throw new Error("esperava cotação");
    expect(precoConfere(r.cotacao, 105_000)).toBe(true);
    expect(precoConfere(r.cotacao, 90_000)).toBe(false);
  });

  it("é determinista: mesma entrada, mesma cotação", () => {
    expect(cotar(entrada())).toEqual(cotar(entrada()));
  });
});

describe("RN-011 — noite sem tarifa é indisponível", () => {
  it("recusa quando falta a tarifa de uma noite, apontando a data", () => {
    const semSegundaNoite = tarifas("plan-padrao", 30_000).filter(
      (t) => toDateOnly(t.date) !== "2026-03-11",
    );
    const r = cotar(entrada({ tarifas: semSegundaNoite }));

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.recusa.codigo).toBe(RECUSA.semTarifa);
    expect(r.recusa.data).toBe("2026-03-11");
    expect(r.recusa.mensagem).toContain("11/03/2026");
  });

  it("nunca trata ausência de tarifa como noite grátis", () => {
    const r = cotar(entrada({ tarifas: [] }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // Três noites sem tarifa, três motivos — não um total zerado.
    expect(r.recusas).toHaveLength(3);
    expect(r.recusas.every((x) => x.codigo === RECUSA.semTarifa)).toBe(true);
  });

  it("recusa quando a unidade não tem plano ativo", () => {
    const r = cotar(entrada({ planos: [plano({ status: "DRAFT" })] }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.recusa.codigo).toBe(RECUSA.semPlano);
  });
});

describe("RN-012 — min/max noites é o mais restritivo", () => {
  it("aplica o mínimo da unidade", () => {
    const r = cotar(entrada({ unit: unidade({ minNights: 5 }) }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.recusa.codigo).toBe(RECUSA.minNoites);
    expect(r.recusa.mensagem).toContain("5");
  });

  it("aplica o mínimo do plano quando ele é maior que o da unidade", () => {
    const r = cotar(
      entrada({ unit: unidade({ minNights: 2 }), planos: [plano({ minNights: 4 })] }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.recusa.codigo).toBe(RECUSA.minNoites);
    expect(r.recusa.mensagem).toContain("4");
  });

  it("aplica o mínimo da tarifa diária e diz qual noite o impôs", () => {
    const linhas = tarifas("plan-padrao", 30_000).map((t) =>
      toDateOnly(t.date) === "2026-03-11" ? { ...t, minNights: 7 } : t,
    );
    const r = cotar(entrada({ tarifas: linhas }));

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.recusa.codigo).toBe(RECUSA.minNoites);
    expect(r.recusa.data).toBe("2026-03-11");
    expect(r.recusa.mensagem).toContain("7");
  });

  it("um mínimo de diária menor que o da unidade não afrouxa a regra", () => {
    const linhas = tarifas("plan-padrao", 30_000, { minNights: 1 });
    const r = cotar(
      entrada({ unit: unidade({ minNights: 5 }), tarifas: linhas }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.recusa.mensagem).toContain("5");
  });

  it("aplica o menor teto entre unidade e plano", () => {
    const r = cotar(
      entrada({
        unit: unidade({ maxNights: 10 }),
        planos: [plano({ maxNights: 2 })],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.recusa.codigo).toBe(RECUSA.maxNoites);
    expect(r.recusa.mensagem).toContain("2");
  });

  it("registra os limites efetivos no snapshot", () => {
    const r = cotar(
      entrada({
        unit: unidade({ minNights: 2, maxNights: 30 }),
        planos: [plano({ minNights: 3, maxNights: 14 })],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cotacao.snapshot.minNightsEfetivo).toBe(3);
    expect(r.cotacao.snapshot.maxNightsEfetivo).toBe(14);
  });
});

describe("fechamentos da tarifa diária", () => {
  it("isClosed fecha a noite para venda", () => {
    const linhas = tarifas("plan-padrao", 30_000).map((t) =>
      toDateOnly(t.date) === "2026-03-12" ? { ...t, isClosed: true } : t,
    );
    const r = cotar(entrada({ tarifas: linhas }));

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.recusa.codigo).toBe(RECUSA.noiteFechada);
    expect(r.recusa.data).toBe("2026-03-12");
  });

  it("closedToArrival barra só a noite de check-in", () => {
    const naChegada = tarifas("plan-padrao", 30_000).map((t) =>
      toDateOnly(t.date) === "2026-03-10" ? { ...t, closedToArrival: true } : t,
    );
    const r = cotar(entrada({ tarifas: naChegada }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.recusa.codigo).toBe(RECUSA.fechadoParaChegada);
    expect(r.recusa.data).toBe("2026-03-10");

    // A mesma marca no meio da estadia não impede nada: quem já está
    // hospedado não está chegando.
    const noMeio = tarifas("plan-padrao", 30_000).map((t) =>
      toDateOnly(t.date) === "2026-03-11" ? { ...t, closedToArrival: true } : t,
    );
    expect(cotar(entrada({ tarifas: noMeio })).ok).toBe(true);
  });

  it("closedToDeparture na última noite barra o dia do check-out", () => {
    const naUltima = tarifas("plan-padrao", 30_000).map((t) =>
      toDateOnly(t.date) === "2026-03-12" ? { ...t, closedToDeparture: true } : t,
    );
    const r = cotar(entrada({ tarifas: naUltima }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.recusa.codigo).toBe(RECUSA.fechadoParaSaida);
    // A data reportada é o check-out — é o que o hóspede precisa mudar.
    expect(r.recusa.data).toBe("2026-03-13");

    // Na primeira noite não barra: ninguém sai no dia em que chega.
    const naPrimeira = tarifas("plan-padrao", 30_000).map((t) =>
      toDateOnly(t.date) === "2026-03-10" ? { ...t, closedToDeparture: true } : t,
    );
    expect(cotar(entrada({ tarifas: naPrimeira })).ok).toBe(true);
  });
});

describe("seleção de plano", () => {
  const caro = plano({
    id: "plan-caro",
    code: "CARO",
    isDefault: false,
    priority: 5,
  });
  const barato = plano({
    id: "plan-barato",
    code: "BARATO",
    isDefault: false,
    priority: 1,
  });

  it("vence o de maior priority, mesmo mais caro", () => {
    const r = cotar(
      entrada({
        planos: [barato, caro],
        tarifas: [
          ...tarifas("plan-caro", 50_000),
          ...tarifas("plan-barato", 20_000),
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cotacao.ratePlanId).toBe("plan-caro");
  });

  it("empatada a priority, vence o plano padrão", () => {
    const padrao = plano({ id: "plan-a", code: "A", isDefault: true, priority: 3 });
    const outro = plano({ id: "plan-b", code: "B", isDefault: false, priority: 3 });
    const r = cotar(
      entrada({
        planos: [outro, padrao],
        tarifas: [...tarifas("plan-a", 40_000), ...tarifas("plan-b", 20_000)],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cotacao.ratePlanId).toBe("plan-a");
  });

  it("empatados priority e padrão, vence o mais barato", () => {
    const a = plano({ id: "plan-a", code: "A", isDefault: false, priority: 2 });
    const b = plano({ id: "plan-b", code: "B", isDefault: false, priority: 2 });
    const r = cotar(
      entrada({
        planos: [a, b],
        tarifas: [...tarifas("plan-a", 40_000), ...tarifas("plan-b", 25_000)],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cotacao.ratePlanId).toBe("plan-b");
    expect(r.cotacao.nightlyTotalCents).toBe(75_000);
  });

  it("ignora plano inelegível e vende pelo que sobrou", () => {
    const vencido = plano({
      id: "plan-vencido",
      code: "VENCIDO",
      priority: 9,
      isDefault: false,
      validTo: parseDateOnly("2026-03-11"),
    });
    const r = cotar(
      entrada({
        planos: [vencido, plano()],
        tarifas: [
          ...tarifas("plan-vencido", 10_000),
          ...tarifas("plan-padrao", 30_000),
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cotacao.ratePlanId).toBe("plan-padrao");
  });

  it("recusa por vigência quando nenhum plano cobre as datas", () => {
    const r = cotar(
      entrada({ planos: [plano({ validFrom: parseDateOnly("2026-04-01") })] }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.recusa.codigo).toBe(RECUSA.foraDaJanela);
  });

  it("recusa por antecedência mínima do plano", () => {
    // Faltam 9 dias para o check-in e o plano exige 30.
    const r = cotar(entrada({ planos: [plano({ minAdvanceDays: 30 })] }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.recusa.codigo).toBe(RECUSA.antecedencia);
    expect(r.recusa.mensagem).toContain("30");
  });

  it("recusa por antecedência máxima do plano", () => {
    const r = cotar(entrada({ planos: [plano({ maxAdvanceDays: 5 })] }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.recusa.codigo).toBe(RECUSA.antecedencia);
  });
});

describe("moeda", () => {
  it("recusa tarifa em moeda diferente da do plano", () => {
    const linhas = tarifas("plan-padrao", 30_000).map((t) =>
      toDateOnly(t.date) === "2026-03-11" ? { ...t, currency: "USD" } : t,
    );
    const r = cotar(entrada({ tarifas: linhas }));

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.recusa.codigo).toBe(RECUSA.moedaDivergente);
    expect(r.recusa.data).toBe("2026-03-11");
    expect(r.recusa.mensagem).toContain("USD");
  });

  it("recusa plano em moeda diferente da unidade, sem converter", () => {
    const r = cotar(entrada({ planos: [plano({ currency: "USD" })] }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.recusa.codigo).toBe(RECUSA.moedaDivergente);
    expect(r.recusa.mensagem).toMatch(/nunca converte/i);
  });
});

describe("entrada inválida", () => {
  it("estadia de zero noites é erro, não recusa", () => {
    expect(() => cotar(entrada({ checkOut: CHECK_IN }))).toThrow(EstadiaInvalida);
  });

  it("check-out antes do check-in é erro", () => {
    expect(() =>
      cotar(entrada({ checkOut: parseDateOnly("2026-03-09") })),
    ).toThrow(EstadiaInvalida);
  });

  it("recusa quando os hóspedes excedem a lotação", () => {
    const r = cotar(entrada({ hospedes: 6, unit: unidade({ maxGuests: 4 }) }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.recusa.codigo).toBe(RECUSA.excedeHospedes);
    expect(r.recusa.data).toBeNull();
  });
});

describe("extras do canal direto", () => {
  const extras = {
    includedGuests: 2,
    extraGuestCentsPerNight: 4_000,
    pets: 1,
    petFeeCents: 8_000,
    parking: true,
    parkingFeeCents: 5_000,
  };

  it("soma extras em feesTotalCents sem alterar as diárias", () => {
    const r = cotar(entrada({ hospedes: 3, extras }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cotacao.nightlyTotalCents).toBe(90_000);
    // limpeza 15000 + extra 1*4000*3 + pet 8000 + garagem 5000
    expect(r.cotacao.feesTotalCents).toBe(15_000 + 12_000 + 8_000 + 5_000);
    expect(r.cotacao.totalCents).toBe(90_000 + 15_000 + 12_000 + 8_000 + 5_000);
    expect(precoConfere(r.cotacao, r.cotacao.totalCents)).toBe(true);
  });

  it("sem extras o total continua o de sempre", () => {
    const r = cotar(entrada());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cotacao.totalCents).toBe(105_000);
    expect(r.cotacao.extras).toBeUndefined();
  });
});

describe("cotarTodosPlanos", () => {
  it("devolve os dois planos vendáveis lado a lado", () => {
    const barato = plano({
      id: "plan-nr",
      code: "NR",
      name: "Não reembolsável",
      isDefault: false,
      priority: 0,
    });
    const r = cotarTodosPlanos(
      entrada({
        planos: [plano(), barato],
        tarifas: [
          ...tarifas("plan-padrao", 30_000),
          ...tarifas("plan-nr", 27_000),
        ],
      }),
    );
    expect(r.cotacoes).toHaveLength(2);
    expect(r.cotacoes[0]!.nightlyTotalCents).toBe(81_000);
    expect(r.cotacoes[1]!.nightlyTotalCents).toBe(90_000);
  });
});
