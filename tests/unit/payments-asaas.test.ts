import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPaymentConfig, type AsaasConfig } from "@/lib/payments/config";
import {
  CheckoutError,
  PaymentError,
  WebhookNotConfiguredError,
  WebhookSignatureError,
} from "@/lib/payments/errors";
import { EFFECT_TO_PAYMENT_STATUS } from "@/lib/payments/provider";
import type { CheckoutRequest } from "@/lib/payments/provider";
import {
  centavosParaReais,
  createAsaasProvider,
  efeitoDoEventoAsaas,
  FORMAS_DE_COBRANCA,
  instanteDoAsaas,
  lerExternalReference,
  montarExternalReference,
  normalizarEventoAsaas,
  reaisParaCentavos,
} from "@/lib/payments/providers/asaas";
import { MINUTOS_DE_HOLD } from "@/lib/reservations/estados";

/**
 * Nenhum teste aqui toca a rede: o `fetch` global é substituído. O que
 * sobra sendo testado de verdade é o que pode dar prejuízo — a conversão de
 * dinheiro, a verificação do token e o mapeamento de eventos.
 */

const TOKEN = "tok_webhook_asaas_de_teste";

const ENV = {
  PAYMENTS_DEFAULT_PROVIDER: "ASAAS",
  ASAAS_API_KEY: "$aact_hmlg_" + "F".repeat(20),
  ASAAS_SANDBOX: "true",
  ASAAS_WEBHOOK_TOKEN: TOKEN,
};

const config = loadPaymentConfig(ENV) as AsaasConfig;
const semToken = loadPaymentConfig({
  ...ENV,
  ASAAS_WEBHOOK_TOKEN: "",
}) as AsaasConfig;

const TENANT_ID = "0193f0c0-1111-7000-8000-000000000001";
const PAYMENT_ID = "0193f0c0-2222-7000-8000-000000000002";
const RESERVATION_ID = "0193f0c0-3333-7000-8000-000000000003";

const REFERENCIA = `otatitan:v1:${TENANT_ID}:${PAYMENT_ID}:${RESERVATION_ID}`;

function requisicao(over: Partial<CheckoutRequest> = {}): CheckoutRequest {
  return {
    reservationId: RESERVATION_ID,
    amountCents: 125_000,
    currency: "BRL",
    description: "Reserva OTA-2026-0001 — Chalé 3, 12/03 a 15/03",
    idempotencyKey: "pay_0193f0c0",
    successUrl: "https://app.exemplo/reservas/ok",
    cancelUrl: "https://app.exemplo/reservas/cancelado",
    metadata: { tenantId: TENANT_ID, paymentId: PAYMENT_ID },
    ...over,
  };
}

function resposta(status: number, corpo: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof corpo === "string" ? corpo : JSON.stringify(corpo)),
  } as unknown as Response;
}

const CHECKOUT_OK = {
  id: "131ca662-56c8-4479-b5b3-fd61a413fce7",
  link: "https://sandbox.asaas.com/checkoutSession/show/131ca662",
  status: "ACTIVE",
};

/** Substitui o `fetch` global e devolve o espião, para inspecionar o corpo. */
function mockarFetch(...respostas: Response[]) {
  const espiao = vi.fn(async () => respostas.shift() ?? resposta(200, CHECKOUT_OK));
  vi.stubGlobal("fetch", espiao);
  return espiao;
}

function corpoEnviado(espiao: ReturnType<typeof mockarFetch>): {
  billingTypes: string[];
  chargeTypes: string[];
  minutesToExpire: number;
  externalReference: string;
  callback: Record<string, string>;
  items: { name: string; value: number; quantity: number }[];
} {
  const chamada = espiao.mock.calls[0] as unknown as [string, { body: string }];
  return JSON.parse(chamada[1].body);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------

describe("conversão de dinheiro (RN-006)", () => {
  /**
   * Os valores escolhidos são os que costumam quebrar em ponto flutuante —
   * `81.15`, `19.99`, `1234.55` não têm representação binária exata.
   */
  const CASOS: [number, number][] = [
    [1, 0.01],
    [99, 0.99],
    [1999, 19.99],
    [8115, 81.15],
    [123455, 1234.55],
    [100, 1],
    [125_000, 1250],
    [0, 0],
  ];

  it.each(CASOS)("centavos %i viram %f reais", (centavos, reais) => {
    expect(centavosParaReais(centavos)).toBe(reais);
  });

  it.each(CASOS)("reais de %i centavos voltam íntegros", (centavos) => {
    expect(reaisParaCentavos(centavosParaReais(centavos))).toBe(centavos);
  });

  /** O Asaas serializa o valor como número JSON; o texto também é aceito. */
  it("lê o valor tanto como número quanto como texto", () => {
    expect(reaisParaCentavos(81.15)).toBe(8115);
    expect(reaisParaCentavos("81.15")).toBe(8115);
    expect(reaisParaCentavos("1234.5")).toBe(123450);
    expect(reaisParaCentavos("1234")).toBe(123400);
  });

  it("arredonda a terceira casa meio para cima, em aritmética inteira", () => {
    expect(reaisParaCentavos("1.005")).toBe(101);
    expect(reaisParaCentavos("1.004")).toBe(100);
  });

  it("valor ausente ou não numérico vira null, não zero", () => {
    // Zero seria pior que null: um reembolso de "R$ 0,00" passaria batido.
    expect(reaisParaCentavos(undefined)).toBeNull();
    expect(reaisParaCentavos(null)).toBeNull();
    expect(reaisParaCentavos("R$ 81,15")).toBeNull();
    expect(reaisParaCentavos(Number.NaN)).toBeNull();
  });

  it("recusa centavos fracionários na ida", () => {
    expect(() => centavosParaReais(1250.5)).toThrow(CheckoutError);
  });
});

describe("referência externa (o metadata que o Asaas não tem)", () => {
  it("leva e traz tenant, pagamento e reserva", () => {
    const ref = montarExternalReference({
      tenantId: TENANT_ID,
      paymentId: PAYMENT_ID,
      reservationId: RESERVATION_ID,
    });
    expect(ref).toBe(REFERENCIA);
    expect(lerExternalReference(ref)).toEqual({
      tenantId: TENANT_ID,
      paymentId: PAYMENT_ID,
      reservationId: RESERVATION_ID,
    });
  });

  it("cabe no limite de 200 caracteres do campo", () => {
    expect(REFERENCIA.length).toBeLessThanOrEqual(200);
  });

  /** Cobrança criada fora da plataforma: evento alheio, não chute. */
  it("referência estranha não aponta para tenant nenhum", () => {
    for (const valor of [null, "", "pedido-1001", "otatitan:v2:x:y", TENANT_ID]) {
      expect(lerExternalReference(valor)).toEqual({
        tenantId: null,
        paymentId: null,
        reservationId: null,
      });
    }
  });

  it("recusa montar referência com id fora do formato UUID", () => {
    expect(() =>
      montarExternalReference({ tenantId: "tenant-1", paymentId: PAYMENT_ID }),
    ).toThrow(CheckoutError);
  });
});

describe("datas do Asaas", () => {
  /**
   * O caso que interessa: sem fuso explícito, um servidor em UTC leria
   * 23:30 de São Paulo como 23:30 UTC e jogaria o pagamento para o dia
   * seguinte no relatório.
   */
  it("data sem fuso é lida em -03:00", () => {
    expect(instanteDoAsaas("2024-06-12 16:45:03")?.toISOString()).toBe(
      "2024-06-12T19:45:03.000Z",
    );
  });

  it("data pura vira meia-noite de Brasília", () => {
    expect(instanteDoAsaas("2024-06-12")?.toISOString()).toBe(
      "2024-06-12T03:00:00.000Z",
    );
  });

  it("data que já traz fuso é respeitada", () => {
    expect(instanteDoAsaas("2024-10-31T03:00:00+0000")?.toISOString()).toBe(
      "2024-10-31T03:00:00.000Z",
    );
  });

  it("texto irreconhecível vira null", () => {
    expect(instanteDoAsaas("ontem")).toBeNull();
    expect(instanteDoAsaas(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("verificação do webhook (RN-009)", () => {
  const provider = createAsaasProvider(config);

  const corpo = JSON.stringify({
    id: "evt_1",
    event: "PAYMENT_RECEIVED",
    payment: { id: "pay_1", value: 1250, externalReference: REFERENCIA },
  });

  it("aceita o token correto", async () => {
    const e = await provider.parseWebhook(corpo, TOKEN);
    expect(e).toMatchObject({
      provider: "ASAAS",
      eventId: "evt_1",
      effect: "PAYMENT_SUCCEEDED",
      tenantId: TENANT_ID,
      paymentId: PAYMENT_ID,
    });
  });

  it("rejeita requisição sem o cabeçalho de token", async () => {
    await expect(provider.parseWebhook(corpo, null)).rejects.toThrow(
      WebhookSignatureError,
    );
  });

  it("rejeita token errado do mesmo tamanho", async () => {
    const errado = "X".repeat(TOKEN.length);
    expect(errado).toHaveLength(TOKEN.length);
    await expect(provider.parseWebhook(corpo, errado)).rejects.toThrow(
      WebhookSignatureError,
    );
  });

  /**
   * `timingSafeEqual` LANÇA com buffers de tamanhos diferentes. Se a
   * comparação usasse os bytes crus, um token curto derrubaria o endpoint
   * com erro 500 — e o próprio estouro já denunciaria o comprimento do
   * segredo.
   */
  it("token de tamanho diferente é recusado, não estoura", async () => {
    for (const errado of ["x", "y".repeat(4096), TOKEN + "a", TOKEN.slice(0, -1)]) {
      await expect(provider.parseWebhook(corpo, errado)).rejects.toThrow(
        WebhookSignatureError,
      );
    }
  });

  it("sem token configurado, nada é aceito — nem otimisticamente", async () => {
    const p = createAsaasProvider(semToken);
    await expect(p.parseWebhook(corpo, TOKEN)).rejects.toThrow(
      WebhookNotConfiguredError,
    );
  });

  it("corpo inválido com token válido é erro de payload, não de autenticação", async () => {
    const erro = await provider.parseWebhook("nao é json", TOKEN).catch((e) => e);
    expect(erro).toBeInstanceOf(PaymentError);
    expect(erro).not.toBeInstanceOf(WebhookSignatureError);
  });
});

// ---------------------------------------------------------------------------

describe("mapeamento de evento para efeito", () => {
  it.each([
    ["PAYMENT_CONFIRMED", "PAYMENT_SUCCEEDED"],
    ["PAYMENT_RECEIVED", "PAYMENT_SUCCEEDED"],
    ["PAYMENT_REFUNDED", "PAYMENT_REFUNDED"],
    ["PAYMENT_PARTIALLY_REFUNDED", "PAYMENT_PARTIALLY_REFUNDED"],
    ["PAYMENT_OVERDUE", "PAYMENT_EXPIRED"],
    ["PAYMENT_DELETED", "PAYMENT_EXPIRED"],
    ["CHECKOUT_EXPIRED", "PAYMENT_EXPIRED"],
    ["CHECKOUT_CANCELED", "PAYMENT_EXPIRED"],
    ["PAYMENT_CREDIT_CARD_CAPTURE_REFUSED", "PAYMENT_FAILED"],
    ["PAYMENT_REPROVED_BY_RISK_ANALYSIS", "PAYMENT_FAILED"],
  ])("%s vira %s", (tipo, efeito) => {
    expect(efeitoDoEventoAsaas(tipo)).toBe(efeito);
  });

  /**
   * Estes NÃO podem virar confirmação. `REFUND_IN_PROGRESS` é reembolso
   * pedido e ainda não devolvido; `CHECKOUT_PAID` não traz a cobrança e a
   * verdade sobre dinheiro está nos eventos `PAYMENT_*`.
   */
  it.each([
    "PAYMENT_CREATED",
    "PAYMENT_UPDATED",
    "PAYMENT_REFUND_IN_PROGRESS",
    "CHECKOUT_PAID",
    "CHECKOUT_CREATED",
    "PAYMENT_BANK_SLIP_VIEWED",
    "EVENTO_QUE_NAO_EXISTE",
    "",
  ])("%s é registrado, não interpretado", (tipo) => {
    expect(efeitoDoEventoAsaas(tipo)).toBe("IGNORED");
    expect(EFFECT_TO_PAYMENT_STATUS[efeitoDoEventoAsaas(tipo)]).toBeNull();
  });

  it("evento desconhecido não vira efeito nem quando vem com dinheiro", () => {
    const e = normalizarEventoAsaas({
      id: "evt_9",
      event: "PAYMENT_ANTICIPATED",
      payment: { id: "pay_1", value: 1250, externalReference: REFERENCIA },
    });
    expect(e.effect).toBe("IGNORED");
    expect(e.paidAt).toBeNull();
  });
});

describe("normalização do evento", () => {
  function evento(over: Record<string, unknown> = {}, pagamento: Record<string, unknown> = {}) {
    return normalizarEventoAsaas({
      id: "evt_05b708f961d739ea7eba7e4db318f621&368604920",
      event: "PAYMENT_RECEIVED",
      dateCreated: "2024-06-12 16:45:03",
      payment: {
        object: "payment",
        id: "pay_080225913252",
        value: 1250,
        billingType: "PIX",
        status: "RECEIVED",
        externalReference: REFERENCIA,
        ...pagamento,
      },
      ...over,
    });
  }

  it("recupera os ids, o valor em centavos e o instante do pagamento", () => {
    const e = evento();
    expect(e).toMatchObject({
      provider: "ASAAS",
      eventId: "evt_05b708f961d739ea7eba7e4db318f621&368604920",
      type: "PAYMENT_RECEIVED",
      effect: "PAYMENT_SUCCEEDED",
      tenantId: TENANT_ID,
      paymentId: PAYMENT_ID,
      reservationId: RESERVATION_ID,
      providerPaymentId: "pay_080225913252",
      // 1250 reais → 125000 centavos.
      amountCents: 125_000,
      currency: "BRL",
    });
    expect(e.paidAt?.toISOString()).toBe("2024-06-12T19:45:03.000Z");
  });

  /** Bandeira e 4 últimos dígitos são o MÁXIMO que pode ser guardado. */
  it("guarda só bandeira e últimos dígitos do cartão", () => {
    const e = evento(
      { event: "PAYMENT_CONFIRMED" },
      {
        creditCard: {
          creditCardNumber: "8829",
          creditCardBrand: "MASTERCARD",
          creditCardToken: "tok_1",
        },
        transactionReceiptUrl: "https://www.asaas.com/comprovantes/1",
      },
    );

    expect(e).toMatchObject({
      cardBrand: "MASTERCARD",
      cardLast4: "8829",
      receiptUrl: "https://www.asaas.com/comprovantes/1",
    });
    expect(JSON.stringify(e)).not.toMatch(/cvv|cvc/i);
  });

  /**
   * Trava contra persistir PAN: se o campo vier com mais que 4 dígitos, não
   * é "últimos dígitos" — é número de cartão, e não se guarda (RN-009).
   */
  it("descarta o campo de dígitos quando não são exatamente 4", () => {
    const e = evento(
      {},
      { creditCard: { creditCardNumber: "5162306219378829", creditCardBrand: "VISA" } },
    );
    expect(e.cardLast4).toBeNull();
  });

  it("evento sem a nossa referência não aponta para tenant nenhum", () => {
    const e = evento({}, { externalReference: "pedido-de-outro-sistema" });
    expect(e.tenantId).toBeNull();
    expect(e.paymentId).toBeNull();
  });

  it("falha de cartão traz código e mensagem legível ao operador", () => {
    const e = evento({ event: "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED" });
    expect(e.effect).toBe("PAYMENT_FAILED");
    expect(e.failureCode).toBe("PAYMENT_CREDIT_CARD_CAPTURE_REFUSED");
    expect(e.failureMessage).toMatch(/recusado/i);
  });

  it("cobrança vencida vira cancelamento, não falha", () => {
    const e = evento({ event: "PAYMENT_OVERDUE" });
    expect(e.effect).toBe("PAYMENT_EXPIRED");
    expect(EFFECT_TO_PAYMENT_STATUS[e.effect]).toBe("CANCELLED");
  });

  it("checkout expirado é lido pela referência do próprio checkout", () => {
    const e = normalizarEventoAsaas({
      id: "evt_2",
      event: "CHECKOUT_EXPIRED",
      dateCreated: "2024-10-31 18:07:47",
      checkout: {
        id: "2bd251f0-09b2-44ff-8a0c-a5cb29e5bbda",
        status: "EXPIRED",
        externalReference: REFERENCIA,
      },
    });
    expect(e).toMatchObject({
      effect: "PAYMENT_EXPIRED",
      tenantId: TENANT_ID,
      paymentId: PAYMENT_ID,
      providerSessionId: "2bd251f0-09b2-44ff-8a0c-a5cb29e5bbda",
    });
  });

  /** Em reembolso, o valor é o DEVOLVIDO — é ele que sai do total pago. */
  it("reembolso parcial devolve o valor reembolsado, não o original", () => {
    const e = evento(
      { event: "PAYMENT_PARTIALLY_REFUNDED" },
      {
        value: 1250,
        refunds: [{ status: "DONE", value: 400 }],
      },
    );
    expect(e.effect).toBe("PAYMENT_PARTIALLY_REFUNDED");
    expect(e.amountCents).toBe(40_000);
  });

  it("reembolso pedido mas não concluído não conta como devolvido", () => {
    const e = evento(
      { event: "PAYMENT_PARTIALLY_REFUNDED" },
      {
        value: 1250,
        refunds: [
          { status: "PENDING", value: 400 },
          { status: "CANCELLED", value: 100 },
        ],
      },
    );
    // `null` de propósito: melhor não descontar nada que descontar dinheiro
    // que o hóspede não recebeu de volta.
    expect(e.amountCents).toBeNull();
  });

  it("reembolso total sem lista de estornos cai no valor da cobrança", () => {
    const e = evento({ event: "PAYMENT_REFUNDED" }, { value: 1250 });
    expect(e.amountCents).toBe(125_000);
  });

  /**
   * O `id` do evento é a chave de idempotência do recebimento. Sem ele, o
   * substituto tem que ser determinista — senão cada reentrega viraria um
   * evento "novo" e o efeito seria aplicado duas vezes.
   */
  it("evento sem id ganha um identificador determinista", () => {
    const bruto = {
      event: "PAYMENT_RECEIVED",
      dateCreated: "2024-06-12 16:45:03",
      payment: { id: "pay_1", value: 10, externalReference: REFERENCIA },
    };
    const a = normalizarEventoAsaas(bruto);
    const b = normalizarEventoAsaas(structuredClone(bruto));

    expect(a.eventId).toBe(b.eventId);
    expect(a.eventId).toMatch(/^asaas-sem-id:[0-9a-f]{32}$/);
  });
});

// ---------------------------------------------------------------------------

describe("abertura de checkout no Asaas", () => {
  it("devolve o checkout e a URL hospedada", async () => {
    mockarFetch(resposta(200, CHECKOUT_OK));
    const r = await createAsaasProvider(config).createCheckout(requisicao());

    expect(r).toEqual({
      provider: "ASAAS",
      providerSessionId: CHECKOUT_OK.id,
      redirectUrl: CHECKOUT_OK.link,
    });
  });

  /**
   * ESTA É A TRAVA DO BOLETO.
   *
   * Boleto compensa em 1 a 3 dias úteis e o hold dura 30 minutos (RN-004):
   * a data já teria sido revendida quando o dinheiro entrasse. Se este teste
   * quebrar, é porque alguém reabriu boleto — inclusive por via indireta,
   * usando `UNDEFINED`, que significa "todas as formas da conta".
   */
  it("oferece exatamente pix e cartão — nunca boleto", async () => {
    const espiao = mockarFetch(resposta(200, CHECKOUT_OK));
    await createAsaasProvider(config).createCheckout(requisicao());

    const corpo = corpoEnviado(espiao);
    expect(corpo.billingTypes).toEqual(["PIX", "CREDIT_CARD"]);
    expect(corpo.billingTypes).not.toContain("BOLETO");
    expect(corpo.billingTypes).not.toContain("UNDEFINED");
    expect(FORMAS_DE_COBRANCA).toEqual(["PIX", "CREDIT_CARD"]);
    expect(JSON.stringify(corpo)).not.toMatch(/BOLETO|UNDEFINED/);
  });

  /** A cobrança tem que morrer junto com o hold, não depois dele. */
  it("expira junto com o hold da reserva", async () => {
    const espiao = mockarFetch(resposta(200, CHECKOUT_OK));
    await createAsaasProvider(config).createCheckout(requisicao());

    expect(corpoEnviado(espiao).minutesToExpire).toBe(MINUTOS_DE_HOLD);
  });

  it("manda o valor em reais decimais e carimba a referência de volta", async () => {
    const espiao = mockarFetch(resposta(200, CHECKOUT_OK));
    await createAsaasProvider(config).createCheckout(
      requisicao({ amountCents: 8115 }),
    );

    const corpo = corpoEnviado(espiao);
    expect(corpo.items[0]).toMatchObject({ quantity: 1, value: 81.15 });
    expect(corpo.externalReference).toBe(REFERENCIA);
    expect(lerExternalReference(corpo.externalReference)).toEqual({
      tenantId: TENANT_ID,
      paymentId: PAYMENT_ID,
      reservationId: RESERVATION_ID,
    });
  });

  it("usa a URL e a chave da configuração, no cabeçalho do Asaas", async () => {
    const espiao = mockarFetch(resposta(200, CHECKOUT_OK));
    await createAsaasProvider(config).createCheckout(requisicao());

    const [url, init] = espiao.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string> },
    ];
    expect(url).toBe("https://api-sandbox.asaas.com/v3/checkouts");
    expect(init.headers.access_token).toBe(ENV.ASAAS_API_KEY);
  });

  it("respeita o limite de 30 caracteres do nome do item", async () => {
    const espiao = mockarFetch(resposta(200, CHECKOUT_OK));
    await createAsaasProvider(config).createCheckout(
      requisicao({ description: "R".repeat(400) }),
    );

    expect(corpoEnviado(espiao).items[0]!.name).toHaveLength(30);
  });

  /** A conta Asaas liquida em real; outra moeda cobraria o valor errado. */
  it("recusa moeda diferente de BRL", async () => {
    const espiao = mockarFetch(resposta(200, CHECKOUT_OK));

    await expect(
      createAsaasProvider(config).createCheckout(requisicao({ currency: "USD" })),
    ).rejects.toThrow(/BRL/);
    expect(espiao).not.toHaveBeenCalled();
  });

  it("erro HTTP do Asaas vira CheckoutError com a mensagem do provedor", async () => {
    mockarFetch(
      resposta(400, {
        errors: [
          { code: "invalid_value", description: "O valor mínimo é R$ 5,00." },
        ],
      }),
    );

    const erro = await createAsaasProvider(config)
      .createCheckout(requisicao())
      .catch((e) => e);

    expect(erro).toBeInstanceOf(CheckoutError);
    expect(erro.message).toContain("O valor mínimo é R$ 5,00.");
    expect(erro.message).toContain("400");
  });

  it("erro sem corpo JSON ainda produz mensagem legível", async () => {
    mockarFetch(resposta(500, "<html>Gateway indisponível</html>"));

    await expect(
      createAsaasProvider(config).createCheckout(requisicao()),
    ).rejects.toThrow(CheckoutError);
  });

  /** 2xx sem link não é "meio ok": não há para onde mandar o hóspede. */
  it("falha quando o Asaas responde sem link de checkout", async () => {
    mockarFetch(resposta(200, { id: "chk_1", status: "ACTIVE" }));

    await expect(
      createAsaasProvider(config).createCheckout(requisicao()),
    ).rejects.toThrow(CheckoutError);
  });

  it("falha de rede vira CheckoutError, não erro cru de fetch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    await expect(
      createAsaasProvider(config).createCheckout(requisicao()),
    ).rejects.toThrow(CheckoutError);
  });
});
