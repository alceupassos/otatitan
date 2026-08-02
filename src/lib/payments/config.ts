import { z } from "zod";

/**
 * Configuração dos provedores de pagamento, validada na leitura.
 *
 * Existe separada do adapter (`provider.ts`, a implementar junto com o
 * fluxo de reserva) porque a configuração precisa ser conferível ANTES de
 * haver cobrança: o modo de falha que interessa evitar é descobrir que a
 * chave está errada no primeiro pagamento real de um cliente.
 *
 * Nunca guarda dado de cartão (RN/PCI — ver docs/11-seguranca-lgpd.md);
 * aqui só moram credenciais de API.
 */
export const PAYMENT_PROVIDERS = ["STRIPE", "ASAAS", "MANUAL"] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

/**
 * Chaves do Asaas trazem o ambiente no próprio prefixo:
 * `$aact_prod_...` é produção (movimenta dinheiro de verdade),
 * `$aact_hmlg_...` é homologação/sandbox.
 */
const ASAAS_PROD_MARKER = "_prod_";

export const ASAAS_API_URL = {
  sandbox: "https://api-sandbox.asaas.com/v3",
  production: "https://api.asaas.com/v3",
} as const;

function bool(valor: string | undefined, padrao: boolean): boolean {
  if (valor === undefined || valor === "") return padrao;
  return valor === "true" || valor === "1";
}

export type StripeConfig = {
  provider: "STRIPE";
  secretKey: string;
  publishableKey: string;
  /** Ausente = webhooks não podem ser verificados; ver `webhookReady`. */
  webhookSecret: string | null;
  currency: string;
  testMode: boolean;
  webhookReady: boolean;
};

export type AsaasConfig = {
  provider: "ASAAS";
  apiKey: string;
  apiUrl: string;
  sandbox: boolean;
  webhookToken: string | null;
  webhookReady: boolean;
};

export type ManualConfig = { provider: "MANUAL" };

export type PaymentConfig = StripeConfig | AsaasConfig | ManualConfig;

export class PaymentConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentConfigError";
  }
}

const envSchema = z.object({
  PAYMENTS_DEFAULT_PROVIDER: z.enum(PAYMENT_PROVIDERS).default("MANUAL"),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_CURRENCY: z.string().default("brl"),

  ASAAS_API_KEY: z.string().optional(),
  ASAAS_SANDBOX: z.string().optional(),
  ASAAS_WEBHOOK_TOKEN: z.string().optional(),
});

export type PaymentEnv = Record<string, string | undefined>;

/**
 * Lê e valida a configuração do provedor ativo.
 *
 * Recebe `env` como parâmetro (em vez de ler `process.env` direto) para
 * ser testável sem mexer no ambiente do processo.
 */
export function loadPaymentConfig(env: PaymentEnv = process.env): PaymentConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new PaymentConfigError(
      `Configuração de pagamento inválida: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }

  const e = parsed.data;

  switch (e.PAYMENTS_DEFAULT_PROVIDER) {
    case "MANUAL":
      return { provider: "MANUAL" };

    case "STRIPE": {
      if (!e.STRIPE_SECRET_KEY || !e.STRIPE_PUBLISHABLE_KEY) {
        throw new PaymentConfigError(
          "PAYMENTS_DEFAULT_PROVIDER=STRIPE exige STRIPE_SECRET_KEY e STRIPE_PUBLISHABLE_KEY.",
        );
      }

      const secretIsTest = e.STRIPE_SECRET_KEY.startsWith("sk_test_");
      const pubIsTest = e.STRIPE_PUBLISHABLE_KEY.startsWith("pk_test_");

      // Um par misto (secreta de teste + publicável de produção, ou o
      // inverso) falha só na hora de cobrar, com erro obscuro do Stripe.
      if (secretIsTest !== pubIsTest) {
        throw new PaymentConfigError(
          "Chaves Stripe de ambientes diferentes: uma é de teste e a outra de produção.",
        );
      }

      return {
        provider: "STRIPE",
        secretKey: e.STRIPE_SECRET_KEY,
        publishableKey: e.STRIPE_PUBLISHABLE_KEY,
        webhookSecret: e.STRIPE_WEBHOOK_SECRET || null,
        currency: e.STRIPE_CURRENCY.toLowerCase(),
        testMode: secretIsTest,
        // Sem o segredo do webhook não dá para verificar assinatura, e um
        // webhook não verificado não pode confirmar pagamento (RN-009).
        webhookReady: Boolean(e.STRIPE_WEBHOOK_SECRET),
      };
    }

    case "ASAAS": {
      if (!e.ASAAS_API_KEY) {
        throw new PaymentConfigError(
          "PAYMENTS_DEFAULT_PROVIDER=ASAAS exige ASAAS_API_KEY.",
        );
      }

      // A chave começa com '$'. Se ela chegou vazia ou truncada, quase
      // sempre é porque o shell expandiu o '$' — falha silenciosa clássica
      // ao carregar .env com `set -a; . arquivo` sem aspas simples.
      if (!e.ASAAS_API_KEY.startsWith("$")) {
        throw new PaymentConfigError(
          "ASAAS_API_KEY não começa com '$' — provável expansão de shell. " +
            "Envolva o valor em aspas simples no arquivo .env.",
        );
      }

      const sandbox = bool(e.ASAAS_SANDBOX, true);
      const keyIsProduction = e.ASAAS_API_KEY.includes(ASAAS_PROD_MARKER);

      // O erro caro é o par invertido: chave de produção com sandbox
      // ligado nunca funciona, e chave de sandbox com sandbox desligado
      // também não — mas o inverso do primeiro caso (produção sem
      // perceber) move dinheiro de verdade.
      if (keyIsProduction && sandbox) {
        throw new PaymentConfigError(
          "ASAAS_API_KEY é de produção, mas ASAAS_SANDBOX=true. " +
            "Use uma chave de homologação, ou defina ASAAS_SANDBOX=false " +
            "para cobrar de verdade.",
        );
      }
      if (!keyIsProduction && !sandbox) {
        throw new PaymentConfigError(
          "ASAAS_SANDBOX=false (produção), mas a ASAAS_API_KEY não é de produção.",
        );
      }

      return {
        provider: "ASAAS",
        apiKey: e.ASAAS_API_KEY,
        apiUrl: sandbox ? ASAAS_API_URL.sandbox : ASAAS_API_URL.production,
        sandbox,
        webhookToken: e.ASAAS_WEBHOOK_TOKEN || null,
        webhookReady: Boolean(e.ASAAS_WEBHOOK_TOKEN),
      };
    }
  }
}

/**
 * Resumo seguro para log e diagnóstico — nunca inclui a credencial.
 * Serve para responder "qual provedor está ativo e em que ambiente?" sem
 * que a resposta vire um vazamento no log.
 */
export function describePaymentConfig(config: PaymentConfig): string {
  switch (config.provider) {
    case "MANUAL":
      return "MANUAL (sem provedor externo; baixa manual)";
    case "STRIPE":
      return `STRIPE (${config.testMode ? "teste" : "PRODUÇÃO"}, moeda ${config.currency}, webhook ${config.webhookReady ? "pronto" : "NÃO configurado"})`;
    case "ASAAS":
      return `ASAAS (${config.sandbox ? "sandbox" : "PRODUÇÃO"}, webhook ${config.webhookReady ? "pronto" : "NÃO configurado"})`;
  }
}
