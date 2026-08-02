import { describe, expect, it } from "vitest";
import {
  ASAAS_API_URL,
  PaymentConfigError,
  describePaymentConfig,
  loadPaymentConfig,
} from "@/lib/payments/config";

// Valores com a MESMA forma das chaves reais, mas inventados.
const STRIPE_TEST_SK = "sk_test_" + "A".repeat(24);
const STRIPE_TEST_PK = "pk_test_" + "B".repeat(24);
const STRIPE_LIVE_SK = "sk_live_" + "C".repeat(24);
const ASAAS_PROD = "$aact_prod_" + "D".repeat(20) + "::$aach_" + "E".repeat(12);
const ASAAS_SANDBOX = "$aact_hmlg_" + "F".repeat(20) + "::$aach_" + "G".repeat(12);

describe("provedor MANUAL", () => {
  it("é o padrão quando nada está configurado", () => {
    expect(loadPaymentConfig({}).provider).toBe("MANUAL");
  });

  it("não exige credencial nenhuma", () => {
    const c = loadPaymentConfig({ PAYMENTS_DEFAULT_PROVIDER: "MANUAL" });
    expect(c.provider).toBe("MANUAL");
    expect(describePaymentConfig(c)).toContain("MANUAL");
  });
});

describe("Stripe", () => {
  it("aceita um par de chaves de teste", () => {
    const c = loadPaymentConfig({
      PAYMENTS_DEFAULT_PROVIDER: "STRIPE",
      STRIPE_SECRET_KEY: STRIPE_TEST_SK,
      STRIPE_PUBLISHABLE_KEY: STRIPE_TEST_PK,
    });
    expect(c).toMatchObject({ provider: "STRIPE", testMode: true, currency: "brl" });
  });

  it("recusa configuração sem as chaves", () => {
    expect(() =>
      loadPaymentConfig({ PAYMENTS_DEFAULT_PROVIDER: "STRIPE" }),
    ).toThrow(PaymentConfigError);
  });

  it("recusa par misto teste/produção", () => {
    expect(() =>
      loadPaymentConfig({
        PAYMENTS_DEFAULT_PROVIDER: "STRIPE",
        STRIPE_SECRET_KEY: STRIPE_LIVE_SK,
        STRIPE_PUBLISHABLE_KEY: STRIPE_TEST_PK,
      }),
    ).toThrow(/ambientes diferentes/i);
  });

  it("sinaliza webhook não configurado em vez de fingir que está pronto", () => {
    const c = loadPaymentConfig({
      PAYMENTS_DEFAULT_PROVIDER: "STRIPE",
      STRIPE_SECRET_KEY: STRIPE_TEST_SK,
      STRIPE_PUBLISHABLE_KEY: STRIPE_TEST_PK,
      STRIPE_WEBHOOK_SECRET: "",
    });
    expect(c).toMatchObject({ webhookReady: false, webhookSecret: null });
    expect(describePaymentConfig(c)).toContain("NÃO configurado");
  });

  it("normaliza a moeda para minúsculas", () => {
    const c = loadPaymentConfig({
      PAYMENTS_DEFAULT_PROVIDER: "STRIPE",
      STRIPE_SECRET_KEY: STRIPE_TEST_SK,
      STRIPE_PUBLISHABLE_KEY: STRIPE_TEST_PK,
      STRIPE_CURRENCY: "BRL",
    });
    expect(c).toMatchObject({ currency: "brl" });
  });
});

describe("Asaas", () => {
  it("aceita chave de homologação com sandbox ligado", () => {
    const c = loadPaymentConfig({
      PAYMENTS_DEFAULT_PROVIDER: "ASAAS",
      ASAAS_API_KEY: ASAAS_SANDBOX,
      ASAAS_SANDBOX: "true",
    });
    expect(c).toMatchObject({ provider: "ASAAS", sandbox: true });
    expect((c as { apiUrl: string }).apiUrl).toBe(ASAAS_API_URL.sandbox);
  });

  it("aceita chave de produção com sandbox desligado", () => {
    const c = loadPaymentConfig({
      PAYMENTS_DEFAULT_PROVIDER: "ASAAS",
      ASAAS_API_KEY: ASAAS_PROD,
      ASAAS_SANDBOX: "false",
    });
    expect(c).toMatchObject({ provider: "ASAAS", sandbox: false });
    expect((c as { apiUrl: string }).apiUrl).toBe(ASAAS_API_URL.production);
  });

  it("recusa chave de PRODUÇÃO com sandbox ligado", () => {
    expect(() =>
      loadPaymentConfig({
        PAYMENTS_DEFAULT_PROVIDER: "ASAAS",
        ASAAS_API_KEY: ASAAS_PROD,
        ASAAS_SANDBOX: "true",
      }),
    // `[\s\S]` em vez da flag /s: o tsconfig mira ES2017, onde dotAll
    // ainda não existe.
    ).toThrow(/produção[\s\S]*ASAAS_SANDBOX=true/i);
  });

  it("recusa chave de homologação com sandbox desligado", () => {
    expect(() =>
      loadPaymentConfig({
        PAYMENTS_DEFAULT_PROVIDER: "ASAAS",
        ASAAS_API_KEY: ASAAS_SANDBOX,
        ASAAS_SANDBOX: "false",
      }),
    ).toThrow(/não é de produção/i);
  });

  /**
   * O caso que motivou a checagem: `set -a; . .env` sem aspas simples
   * expande o '$' inicial e a chave chega vazia ou truncada.
   */
  it("detecta chave corrompida por expansão de shell", () => {
    expect(() =>
      loadPaymentConfig({
        PAYMENTS_DEFAULT_PROVIDER: "ASAAS",
        ASAAS_API_KEY: "aact_prod_semcifrao",
        ASAAS_SANDBOX: "false",
      }),
    ).toThrow(/expansão de shell/i);
  });

  it("recusa configuração sem chave", () => {
    expect(() =>
      loadPaymentConfig({ PAYMENTS_DEFAULT_PROVIDER: "ASAAS" }),
    ).toThrow(/exige ASAAS_API_KEY/i);
  });

  it("sandbox é o padrão quando ASAAS_SANDBOX não é informado", () => {
    const c = loadPaymentConfig({
      PAYMENTS_DEFAULT_PROVIDER: "ASAAS",
      ASAAS_API_KEY: ASAAS_SANDBOX,
    });
    expect(c).toMatchObject({ sandbox: true });
  });
});

describe("descrição para log", () => {
  it("nunca inclui a credencial", () => {
    const c = loadPaymentConfig({
      PAYMENTS_DEFAULT_PROVIDER: "ASAAS",
      ASAAS_API_KEY: ASAAS_PROD,
      ASAAS_SANDBOX: "false",
    });
    const texto = describePaymentConfig(c);
    expect(texto).not.toContain(ASAAS_PROD);
    expect(texto).not.toContain("aact");
    expect(texto).toContain("PRODUÇÃO");
  });
});
