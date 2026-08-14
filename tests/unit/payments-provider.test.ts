import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import {
  loadPaymentConfig,
  PaymentConfigError,
  type StripeConfig,
} from "@/lib/payments/config";
import {
  CheckoutError,
  WebhookNotConfiguredError,
  WebhookSignatureError,
} from "@/lib/payments/errors";
import {
  EFFECT_TO_PAYMENT_STATUS,
  getProviderByKey,
  podeReprocessarWebhook,
  type CheckoutRequest,
} from "@/lib/payments/provider";
import { createManualProvider } from "@/lib/payments/providers/manual";
import {
  createStripeProvider,
  normalizarEventoStripe,
} from "@/lib/payments/providers/stripe";

/**
 * Nenhum teste aqui toca a rede: a verificação de assinatura do Stripe é
 * criptografia local (é por isso que dá para testá-la de verdade, em vez de
 * mockar o que mais importa), e o checkout usa um client falso.
 */

const WEBHOOK_SECRET = "whsec_" + "C".repeat(24);

const ENV = {
  PAYMENTS_DEFAULT_PROVIDER: "STRIPE",
  STRIPE_SECRET_KEY: "sk_test_" + "A".repeat(24),
  STRIPE_PUBLISHABLE_KEY: "pk_test_" + "B".repeat(24),
  STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
};

const TENANT_ID = "0193f0c0-1111-7000-8000-000000000001";
const PAYMENT_ID = "0193f0c0-2222-7000-8000-000000000002";
const RESERVATION_ID = "0193f0c0-3333-7000-8000-000000000003";

const stripeConfig = loadPaymentConfig(ENV) as StripeConfig;
const stripeClient = new Stripe(ENV.STRIPE_SECRET_KEY);

const META = {
  tenantId: TENANT_ID,
  paymentId: PAYMENT_ID,
  reservationId: RESERVATION_ID,
};

function evento(type: string, object: unknown, id = "evt_teste_1"): Stripe.Event {
  return {
    id,
    object: "event",
    api_version: null,
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: null,
    type,
    data: { object },
  } as unknown as Stripe.Event;
}

function assinar(payload: string, secret = WEBHOOK_SECRET): string {
  return stripeClient.webhooks.generateTestHeaderString({ payload, secret });
}

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

describe("verificação de assinatura (RN-009)", () => {
  const provider = createStripeProvider(stripeConfig, stripeClient);

  it("aceita evento com assinatura válida", async () => {
    const payload = JSON.stringify(
      evento("payment_intent.succeeded", {
        id: "pi_1",
        amount: 125_000,
        amount_received: 125_000,
        currency: "brl",
        metadata: META,
      }),
    );

    const e = await provider.parseWebhook(payload, assinar(payload));

    expect(e).toMatchObject({
      provider: "STRIPE",
      eventId: "evt_teste_1",
      effect: "PAYMENT_SUCCEEDED",
      tenantId: TENANT_ID,
      paymentId: PAYMENT_ID,
    });
  });

  it("rejeita requisição sem o cabeçalho de assinatura", async () => {
    await expect(provider.parseWebhook("{}", null)).rejects.toThrow(
      WebhookSignatureError,
    );
  });

  it("rejeita assinatura forjada", async () => {
    const payload = JSON.stringify(evento("payment_intent.succeeded", { id: "pi_1" }));
    await expect(
      provider.parseWebhook(payload, "t=1700000000,v1=deadbeef"),
    ).rejects.toThrow(WebhookSignatureError);
  });

  it("rejeita assinatura feita com outro segredo", async () => {
    const payload = JSON.stringify(evento("payment_intent.succeeded", { id: "pi_1" }));
    const header = assinar(payload, "whsec_" + "Z".repeat(24));
    await expect(provider.parseWebhook(payload, header)).rejects.toThrow(
      WebhookSignatureError,
    );
  });

  /** O ataque que a assinatura existe para barrar: trocar o valor pago. */
  it("rejeita corpo adulterado depois de assinado", async () => {
    const payload = JSON.stringify(
      evento("payment_intent.succeeded", {
        id: "pi_1",
        amount: 100,
        amount_received: 100,
        currency: "brl",
        metadata: META,
      }),
    );
    const header = assinar(payload);
    const adulterado = payload.replace('"amount":100', '"amount":1');

    await expect(provider.parseWebhook(adulterado, header)).rejects.toThrow(
      WebhookSignatureError,
    );
  });

  it("recusa verificar quando não há segredo configurado", async () => {
    const semSegredo = loadPaymentConfig({
      ...ENV,
      STRIPE_WEBHOOK_SECRET: "",
    }) as StripeConfig;
    const p = createStripeProvider(semSegredo, stripeClient);

    await expect(p.parseWebhook("{}", "t=1,v1=x")).rejects.toThrow(
      WebhookNotConfiguredError,
    );
  });
});

describe("mapeamento de evento para efeito", () => {
  it("sessão concluída e paga confirma o pagamento", () => {
    const e = normalizarEventoStripe(
      evento("checkout.session.completed", {
        id: "cs_1",
        payment_status: "paid",
        payment_intent: "pi_1",
        amount_total: 125_000,
        currency: "brl",
        metadata: META,
      }),
    );

    expect(e).toMatchObject({
      effect: "PAYMENT_SUCCEEDED",
      providerSessionId: "cs_1",
      providerPaymentId: "pi_1",
      amountCents: 125_000,
      // A coluna do banco é Char(3) e guarda "BRL".
      currency: "BRL",
    });
    expect(e.paidAt).toBeInstanceOf(Date);
  });

  /**
   * Pix e boleto fecham a sessão sem dinheiro na conta. Tratar isso como
   * pago confirmaria reserva não paga — o pior defeito possível aqui.
   */
  it("sessão concluída mas NÃO paga não confirma nada", () => {
    const e = normalizarEventoStripe(
      evento("checkout.session.completed", {
        id: "cs_1",
        payment_status: "unpaid",
        amount_total: 125_000,
        currency: "brl",
        metadata: META,
      }),
    );
    expect(e.effect).toBe("IGNORED");
    expect(e.paidAt).toBeNull();
  });

  it("confirmação assíncrona (pix/boleto) confirma o pagamento", () => {
    const e = normalizarEventoStripe(
      evento("checkout.session.async_payment_succeeded", {
        id: "cs_1",
        payment_status: "paid",
        metadata: META,
      }),
    );
    expect(e.effect).toBe("PAYMENT_SUCCEEDED");
  });

  it("sessão expirada vira cancelamento, não falha", () => {
    const e = normalizarEventoStripe(
      evento("checkout.session.expired", { id: "cs_1", metadata: META }),
    );
    expect(e.effect).toBe("PAYMENT_EXPIRED");
    expect(EFFECT_TO_PAYMENT_STATUS[e.effect]).toBe("CANCELLED");
  });

  it("payment_intent recusado traz código e mensagem da recusa", () => {
    const e = normalizarEventoStripe(
      evento("payment_intent.payment_failed", {
        id: "pi_1",
        amount: 125_000,
        currency: "brl",
        metadata: META,
        last_payment_error: { code: "card_declined", message: "Cartão recusado." },
      }),
    );
    expect(e).toMatchObject({
      effect: "PAYMENT_FAILED",
      failureCode: "card_declined",
      failureMessage: "Cartão recusado.",
    });
  });

  /** Bandeira e 4 últimos dígitos são o MÁXIMO que pode ser guardado. */
  it("charge.succeeded traz apenas bandeira e últimos dígitos do cartão", () => {
    const e = normalizarEventoStripe(
      evento("charge.succeeded", {
        id: "ch_1",
        payment_intent: "pi_1",
        amount: 125_000,
        amount_refunded: 0,
        currency: "brl",
        metadata: META,
        receipt_url: "https://pay.stripe.com/receipts/1",
        payment_method_details: { card: { brand: "visa", last4: "4242" } },
      }),
    );

    expect(e).toMatchObject({
      effect: "PAYMENT_SUCCEEDED",
      providerPaymentId: "pi_1",
      cardBrand: "visa",
      cardLast4: "4242",
      receiptUrl: "https://pay.stripe.com/receipts/1",
    });
    expect(JSON.stringify(e)).not.toMatch(/\bnumber\b|cvc|cvv/i);
  });

  it("reembolso total e parcial se distinguem pelo valor devolvido", () => {
    const total = normalizarEventoStripe(
      evento("charge.refunded", {
        id: "ch_1",
        payment_intent: "pi_1",
        amount: 125_000,
        amount_refunded: 125_000,
        currency: "brl",
        metadata: META,
      }),
    );
    const parcial = normalizarEventoStripe(
      evento("charge.refunded", {
        id: "ch_1",
        payment_intent: "pi_1",
        amount: 125_000,
        amount_refunded: 40_000,
        currency: "brl",
        metadata: META,
      }),
    );

    expect(total.effect).toBe("PAYMENT_REFUNDED");
    expect(parcial.effect).toBe("PAYMENT_PARTIALLY_REFUNDED");
    // Em reembolso, o valor normalizado é o DEVOLVIDO — é ele que sai do
    // total pago da reserva.
    expect(parcial.amountCents).toBe(40_000);
  });

  it("evento desconhecido é registrado, não interpretado", () => {
    const e = normalizarEventoStripe(evento("customer.subscription.updated", {}));
    expect(e.effect).toBe("IGNORED");
    expect(EFFECT_TO_PAYMENT_STATUS[e.effect]).toBeNull();
  });

  it("evento sem o nosso metadata não aponta para tenant nenhum", () => {
    const e = normalizarEventoStripe(
      evento("payment_intent.succeeded", { id: "pi_1", amount_received: 100 }),
    );
    expect(e.tenantId).toBeNull();
    expect(e.paymentId).toBeNull();
  });
});

describe("mapeamento de efeito para estado do pagamento", () => {
  it("cobre todo efeito conhecido", () => {
    expect(EFFECT_TO_PAYMENT_STATUS).toMatchObject({
      PAYMENT_SUCCEEDED: "SUCCEEDED",
      PAYMENT_FAILED: "FAILED",
      PAYMENT_EXPIRED: "CANCELLED",
      PAYMENT_REFUNDED: "REFUNDED",
      PAYMENT_PARTIALLY_REFUNDED: "PARTIALLY_REFUNDED",
      IGNORED: null,
    });
  });
});

describe("idempotência de reentrega", () => {
  /**
   * O caso que importa: o Stripe reenvia o mesmo evento por dias até
   * receber 2xx. Um evento já finalizado não pode virar segundo efeito.
   */
  it("evento já finalizado não é reprocessado", () => {
    expect(podeReprocessarWebhook("PROCESSED")).toBe(false);
    expect(podeReprocessarWebhook("IGNORED")).toBe(false);
  });

  it("evento que falhou ou ficou pela metade é tentado de novo", () => {
    expect(podeReprocessarWebhook("FAILED")).toBe(true);
    expect(podeReprocessarWebhook("RECEIVED")).toBe(true);
  });
});

describe("abertura de checkout no Stripe", () => {
  /** Só a assinatura que o adapter realmente usa do SDK. */
  type SessionCreate = (
    params: Record<string, unknown>,
    options: Record<string, unknown>,
  ) => Promise<{ id: string; url: string | null }>;

  function clientFalso(url: string | null = "https://checkout.stripe.com/c/1") {
    const create = vi.fn<SessionCreate>(async () => ({ id: "cs_1", url }));
    return {
      create,
      client: { checkout: { sessions: { create } } } as unknown as Stripe,
    };
  }

  it("devolve a sessão e a URL de redirecionamento", async () => {
    const { client } = clientFalso();
    const r = await createStripeProvider(stripeConfig, client).createCheckout(
      requisicao(),
    );

    expect(r).toEqual({
      provider: "STRIPE",
      providerSessionId: "cs_1",
      redirectUrl: "https://checkout.stripe.com/c/1",
    });
  });

  it("repassa a chave de idempotência ao Stripe", async () => {
    const { create, client } = clientFalso();
    await createStripeProvider(stripeConfig, client).createCheckout(
      requisicao({ idempotencyKey: "pay_abc" }),
    );

    expect(create.mock.calls[0]![1]).toEqual({ idempotencyKey: "pay_abc" });
  });

  /**
   * Sem o metadata no PaymentIntent, os eventos de `payment_intent.*` e
   * `charge.*` chegariam órfãos — sem tenant e sem pagamento.
   */
  it("carimba o metadata também no PaymentIntent", async () => {
    const { create, client } = clientFalso();
    await createStripeProvider(stripeConfig, client).createCheckout(requisicao());

    const params = create.mock.calls[0]![0];
    const esperado = {
      tenantId: TENANT_ID,
      paymentId: PAYMENT_ID,
      reservationId: RESERVATION_ID,
    };
    expect(params.metadata).toEqual(esperado);
    expect(params.payment_intent_data).toEqual({ metadata: esperado });
  });

  it("envia centavos inteiros e moeda em minúsculas", async () => {
    const { create, client } = clientFalso();
    await createStripeProvider(stripeConfig, client).createCheckout(requisicao());

    const params = create.mock.calls[0]![0];
    expect(params.line_items).toMatchObject([
      { quantity: 1, price_data: { currency: "brl", unit_amount: 125_000 } },
    ]);
  });

  it("falha quando o Stripe não devolve URL", async () => {
    const { client } = clientFalso(null);

    await expect(
      createStripeProvider(stripeConfig, client).createCheckout(requisicao()),
    ).rejects.toThrow(CheckoutError);
  });
});

describe("validação comum a todo provedor", () => {
  const provider = getProviderByKey("STRIPE", ENV);

  it("recusa valor zerado ou negativo", async () => {
    await expect(provider.createCheckout(requisicao({ amountCents: 0 }))).rejects.toThrow(
      CheckoutError,
    );
    await expect(
      provider.createCheckout(requisicao({ amountCents: -1 })),
    ).rejects.toThrow(CheckoutError);
  });

  /** Dinheiro é sempre `Int` em centavos (RN-006). */
  it("recusa valor fracionário", async () => {
    await expect(
      provider.createCheckout(requisicao({ amountCents: 1250.5 })),
    ).rejects.toThrow(CheckoutError);
  });

  it("recusa cobrança sem tenantId no metadata", async () => {
    await expect(
      provider.createCheckout(
        requisicao({ metadata: { tenantId: "", paymentId: PAYMENT_ID } }),
      ),
    ).rejects.toThrow(/tenantId/);
  });

  it("recusa cobrança sem chave de idempotência", async () => {
    await expect(
      provider.createCheckout(requisicao({ idempotencyKey: "  " })),
    ).rejects.toThrow(CheckoutError);
  });
});

describe("provedor manual", () => {
  const provider = createManualProvider();

  it("registra a cobrança sem redirect nem sessão", async () => {
    const r = await provider.createCheckout(requisicao({ method: "PIX" }));
    expect(r).toEqual({
      provider: "MANUAL",
      providerSessionId: null,
      redirectUrl: null,
    });
  });

  it("não aceita webhook — não há assinatura para verificar", async () => {
    await expect(provider.parseWebhook("{}", "qualquer")).rejects.toThrow(
      WebhookNotConfiguredError,
    );
  });
});

describe("resolução do provedor", () => {
  it("MANUAL é o padrão de um ambiente sem credencial", () => {
    expect(getProviderByKey("MANUAL", {}).key).toBe("MANUAL");
  });

  it("resolve o ASAAS — o adapter existe desde que ele virou o provedor padrão", () => {
    expect(
      getProviderByKey("ASAAS", {
        ASAAS_API_KEY: "$aact_hmlg_" + "F".repeat(20),
        ASAAS_SANDBOX: "true",
      }).key,
    ).toBe("ASAAS");
  });

  it("falha alto na credencial inválida, em vez de fingir que funciona", () => {
    // O par invertido (chave de produção com sandbox ligado) é o erro caro:
    // se passasse, o operador acharia que está testando enquanto move
    // dinheiro de verdade. Vale para qualquer provedor com adapter.
    expect(() =>
      getProviderByKey("ASAAS", {
        ASAAS_API_KEY: "$aact_prod_" + "F".repeat(20),
        ASAAS_SANDBOX: "true",
      }),
    ).toThrow(PaymentConfigError);
  });
});
