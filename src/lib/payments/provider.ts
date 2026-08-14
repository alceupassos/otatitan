import type {
  PaymentMethod,
  PaymentProviderKey,
  PaymentStatus,
  WebhookEventStatus,
} from "@/generated/prisma/enums";
import {
  loadPaymentConfig,
  type PaymentConfig,
  type PaymentEnv,
  type PaymentProvider,
} from "./config";
import { CheckoutError } from "./errors";
import { createAsaasProvider } from "./providers/asaas";
import { createManualProvider } from "./providers/manual";
import { createStripeProvider } from "./providers/stripe";

/**
 * Adapter de pagamento (ADR-004, docs/09-arquitetura.md).
 *
 * O resto do sistema — reservas, tarefas, auditoria — fala só com esta
 * interface. É o que permite trocar Stripe Checkout por Elements, ou somar
 * Asaas/Mercado Pago, sem tocar em regra de negócio.
 *
 * Nada aqui aceita, transporta ou devolve dado de cartão (PAN, CVV,
 * validade). O que circula é identificador de sessão/cobrança do provedor
 * e, quando ELE devolve, bandeira e 4 últimos dígitos — que não são dado
 * de cartão no sentido do PCI DSS e são o suficiente para o operador
 * reconhecer o pagamento na tela (RN-009).
 */

/**
 * Metadados que viajam até o provedor e voltam no webhook.
 *
 * `tenantId` e `paymentId` são obrigatórios porque o webhook chega sem
 * sessão, sem cookie e sem tenant ativo: o único caminho de volta para
 * saber de quem é o dinheiro é o que nós mesmos carimbamos aqui.
 */
export type CheckoutMetadata = {
  tenantId: string;
  paymentId: string;
  [chave: string]: string;
};

export type CheckoutRequest = {
  reservationId: string;
  /** Sempre centavos inteiros (RN-006). */
  amountCents: number;
  /** ISO-4217 em maiúsculas, como no banco ("BRL"). */
  currency: string;
  description: string;
  /**
   * Chave de idempotência da COBRANÇA (mesma de `Payment.idempotencyKey`).
   * Reenviar o formulário, ou um retry de rede, não pode abrir duas
   * cobranças para a mesma reserva.
   */
  idempotencyKey: string;
  successUrl: string;
  cancelUrl: string;
  /**
   * Instante em que o link deve MORRER no provedor. Ausente/`null` = o
   * adapter usa o padrão dele.
   *
   * Existe porque a validade do checkout tem de acompanhar o hold da reserva
   * (RN-004): um link que sobrevive ao hold cobra por uma data que o worker
   * já liberou e pode ter sido revendida. Quem calcula o prazo é
   * `abrirCobranca`, a partir do hold que resta — não uma constante.
   *
   * Nem todo provedor consegue honrar um prazo curto, e cada adapter
   * documenta o que faz com o campo: o Asaas aceita de 10 min a 24 h e o
   * valor é ajustado para essa faixa; o Stripe exige no mínimo 30 min em
   * `expires_at` e por isso o ignora (ele só atende cobranças antigas).
   */
  expiresAt?: Date | null;
  metadata: CheckoutMetadata;
  /**
   * Só o provedor MANUAL usa: é o operador quem sabe se entrou dinheiro,
   * pix ou transferência. Provedor hospedado ignora — quem escolhe o meio
   * de pagamento é o pagador, na tela do provedor.
   */
  method?: PaymentMethod;
};

export type CheckoutResult = {
  provider: PaymentProviderKey;
  /** Sessão de checkout do provedor; `null` no provedor manual. */
  providerSessionId: string | null;
  /** Para onde mandar o pagador; `null` quando não há redirect (manual). */
  redirectUrl: string | null;
};

/**
 * Efeito de negócio do evento, já traduzido do vocabulário do provedor.
 *
 * O handler do webhook decide o que fazer a partir DISTO, nunca do
 * `event.type` cru — é o que impede o vocabulário do Stripe de vazar para
 * dentro das regras de reserva.
 */
export type WebhookEffect =
  | "PAYMENT_SUCCEEDED"
  | "PAYMENT_FAILED"
  | "PAYMENT_EXPIRED"
  | "PAYMENT_REFUNDED"
  | "PAYMENT_PARTIALLY_REFUNDED"
  | "IGNORED";

/** Evento de webhook normalizado — só existe com assinatura já verificada. */
export type NormalizedWebhookEvent = {
  provider: PaymentProviderKey;
  /** Id do evento no provedor; é a chave de idempotência do recebimento. */
  eventId: string;
  /** Tipo cru ("checkout.session.completed"), guardado para diagnóstico. */
  type: string;
  effect: WebhookEffect;
  /** Vem do metadata que carimbamos no checkout; `null` = evento alheio. */
  tenantId: string | null;
  paymentId: string | null;
  reservationId: string | null;
  providerSessionId: string | null;
  providerPaymentId: string | null;
  /** Em reembolso, é o valor REEMBOLSADO, não o valor original. */
  amountCents: number | null;
  currency: string | null;
  cardBrand: string | null;
  cardLast4: string | null;
  receiptUrl: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  paidAt: Date | null;
  /** Payload cru verificado, para persistir em `WebhookEvent.payload`. */
  payload: unknown;
};

export interface PaymentProviderAdapter {
  readonly key: PaymentProviderKey;
  createCheckout(req: CheckoutRequest): Promise<CheckoutResult>;
  /**
   * Verifica a assinatura e normaliza. O corpo tem que ser o CRU, byte a
   * byte: reserializar o JSON muda a string assinada e invalida a
   * verificação.
   */
  parseWebhook(
    rawBody: string,
    signatureHeader: string | null,
  ): Promise<NormalizedWebhookEvent>;
}

/**
 * Tradução efeito → estado do `Payment`. `null` = evento sem efeito no
 * dinheiro (recebido, registrado, ignorado).
 */
export const EFFECT_TO_PAYMENT_STATUS: Record<WebhookEffect, PaymentStatus | null> =
  {
    PAYMENT_SUCCEEDED: "SUCCEEDED",
    PAYMENT_FAILED: "FAILED",
    // Sessão expirada não é falha de cobrança: ninguém tentou pagar.
    PAYMENT_EXPIRED: "CANCELLED",
    PAYMENT_REFUNDED: "REFUNDED",
    PAYMENT_PARTIALLY_REFUNDED: "PARTIALLY_REFUNDED",
    IGNORED: null,
  };

/**
 * Estados de `Payment` que ainda podem receber a baixa de um pagamento.
 *
 * A atualização é feita com este filtro no `where` (não com leitura +
 * escrita): sob entrega duplicada, o segundo `UPDATE` reavalia a condição
 * depois de esperar o primeiro e devolve zero linhas. É essa contagem que
 * decide somar ou não em `Reservation.paidCents` — sem ela, o retry do
 * Stripe cobraria a reserva duas vezes no nosso lado.
 */
export const PAYMENT_STATUS_ABERTOS: PaymentStatus[] = [
  "REQUIRES_ACTION",
  "PENDING",
  "PROCESSING",
];

/**
 * Um evento já recebido merece nova tentativa?
 *
 * A unique `(provider, eventId)` garante que o mesmo evento não vira dois
 * efeitos. Mas "já vi este id" não é o mesmo que "já processei": se a
 * primeira tentativa falhou (respondemos 500) ou morreu no meio
 * (`RECEIVED` sem `processedAt`), o Stripe reenvia e nós PRECISAMOS tentar
 * de novo — o efeito em si é idempotente (ver PAYMENT_STATUS_ABERTOS).
 * Já `PROCESSED`/`IGNORED` são finais: reconhecer com 200 e parar.
 */
export function podeReprocessarWebhook(status: WebhookEventStatus): boolean {
  return status === "RECEIVED" || status === "FAILED";
}

/**
 * Validações que valem para qualquer provedor, aplicadas no ponto de
 * resolução para não dependerem de cada adapter lembrar de fazê-las.
 */
function validarCobranca(req: CheckoutRequest): void {
  if (!Number.isInteger(req.amountCents) || req.amountCents <= 0) {
    throw new CheckoutError(
      "O valor da cobrança precisa ser um número inteiro de centavos maior que zero.",
    );
  }
  if (!/^[A-Za-z]{3}$/.test(req.currency)) {
    throw new CheckoutError(`Moeda inválida: "${req.currency}".`);
  }
  if (!req.idempotencyKey.trim()) {
    throw new CheckoutError("Cobrança sem chave de idempotência.");
  }
  if (req.expiresAt && req.expiresAt.getTime() <= Date.now()) {
    // Link natimorto: o provedor ou recusa, ou devolve uma URL que já não
    // cobra ninguém. Recusar aqui dá ao operador um motivo legível.
    throw new CheckoutError(
      "O prazo pedido para a cobrança já venceu — não há como abrir um link " +
        "de pagamento válido.",
    );
  }
  if (!req.metadata.tenantId || !req.metadata.paymentId) {
    throw new CheckoutError(
      "Cobrança sem tenantId/paymentId no metadata — o webhook não teria como " +
        "saber a que empresa e a que pagamento o evento pertence.",
    );
  }
}

function comValidacao(adapter: PaymentProviderAdapter): PaymentProviderAdapter {
  return {
    key: adapter.key,
    createCheckout: async (req) => {
      validarCobranca(req);
      return adapter.createCheckout(req);
    },
    parseWebhook: (rawBody, signatureHeader) =>
      adapter.parseWebhook(rawBody, signatureHeader),
  };
}

export function providerFromConfig(config: PaymentConfig): PaymentProviderAdapter {
  switch (config.provider) {
    case "STRIPE":
      return comValidacao(createStripeProvider(config));
    case "MANUAL":
      return comValidacao(createManualProvider());
    case "ASAAS":
      // Provedor padrão do produto: checkout hospedado com pix e cartão
      // (sem boleto — ver FORMAS_DE_COBRANCA em providers/asaas.ts). O
      // Stripe continua resolvível por `getProviderByKey` para as cobranças
      // antigas cujos webhooks ainda chegam.
      return comValidacao(createAsaasProvider(config));
  }
}

/** Provedor ativo do ambiente (`PAYMENTS_DEFAULT_PROVIDER`). */
export function getPaymentProvider(env: PaymentEnv = process.env): PaymentProviderAdapter {
  return providerFromConfig(loadPaymentConfig(env));
}

/**
 * Provedor específico, independente de qual está ativo.
 *
 * O endpoint de webhook do Stripe precisa disto: um evento pode chegar
 * atrasado depois de o ambiente ter trocado de provedor padrão, e ele
 * ainda tem que ser verificado e processado com as chaves do Stripe.
 */
export function getProviderByKey(
  key: PaymentProvider,
  env: PaymentEnv = process.env,
): PaymentProviderAdapter {
  return providerFromConfig(
    loadPaymentConfig({ ...env, PAYMENTS_DEFAULT_PROVIDER: key }),
  );
}
