import Stripe from "stripe";
import type { StripeConfig } from "../config";
import {
  CheckoutError,
  WebhookNotConfiguredError,
  WebhookSignatureError,
} from "../errors";
import type {
  CheckoutRequest,
  CheckoutResult,
  NormalizedWebhookEvent,
  PaymentProviderAdapter,
  WebhookEffect,
} from "../provider";

/**
 * Adapter do Stripe usando Checkout Session HOSPEDADO (ADR-004).
 *
 * O pagador é redirecionado para o domínio do Stripe e digita o cartão lá.
 * Nenhum campo de cartão existe no nosso HTML, nenhum PAN/CVV/validade
 * chega ao nosso servidor e nada disso pode ser gravado (RN-009). O que
 * volta e é guardado: id da sessão, id da cobrança, bandeira e 4 últimos
 * dígitos — o suficiente para o operador conferir na tela.
 */

/** O `product_data.name` do Stripe tem limite; descrição longa é cortada. */
const MAX_DESCRICAO = 250;

/**
 * Nomes das chaves de metadata usadas na volta. Ficam aqui, e não
 * espalhadas em literais, porque um erro de digitação só apareceria no
 * primeiro pagamento real — como um evento órfão, sem tenant.
 */
const META_TENANT = "tenantId";
const META_PAYMENT = "paymentId";
const META_RESERVATION = "reservationId";

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor !== "" ? valor : null;
}

/** Campos que o Stripe expande ou devolve como id conforme o evento. */
function idDe(valor: unknown): string | null {
  if (typeof valor === "string") return valor;
  if (valor && typeof valor === "object" && "id" in valor) {
    return texto((valor as { id: unknown }).id);
  }
  return null;
}

function metadataDe(
  meta: Stripe.Metadata | null | undefined,
): Pick<
  NormalizedWebhookEvent,
  "tenantId" | "paymentId" | "reservationId"
> {
  return {
    tenantId: texto(meta?.[META_TENANT]),
    paymentId: texto(meta?.[META_PAYMENT]),
    reservationId: texto(meta?.[META_RESERVATION]),
  };
}

/** Esqueleto do evento normalizado — cada caso preenche o que tem. */
function base(event: Stripe.Event, effect: WebhookEffect): NormalizedWebhookEvent {
  return {
    provider: "STRIPE",
    eventId: event.id,
    type: event.type,
    effect,
    tenantId: null,
    paymentId: null,
    reservationId: null,
    providerSessionId: null,
    providerPaymentId: null,
    amountCents: null,
    currency: null,
    cardBrand: null,
    cardLast4: null,
    receiptUrl: null,
    failureCode: null,
    failureMessage: null,
    paidAt: null,
    payload: event as unknown,
  };
}

/**
 * `Event.created` é epoch em SEGUNDOS. Multiplicar por 1000 aqui, uma vez,
 * evita a data de 1970 que aparece quando alguém esquece.
 */
function instanteDoEvento(event: Stripe.Event): Date {
  return new Date(event.created * 1000);
}

/** A coluna `currency` é `Char(3)` e o banco guarda "BRL", não "brl". */
function moeda(valor: string | null | undefined): string | null {
  return valor ? valor.toUpperCase() : null;
}

function daSessao(
  event: Stripe.Event,
  effect: WebhookEffect,
): NormalizedWebhookEvent {
  const s = event.data.object as Stripe.Checkout.Session;
  return {
    ...base(event, effect),
    ...metadataDe(s.metadata),
    providerSessionId: s.id,
    providerPaymentId: idDe(s.payment_intent),
    amountCents: s.amount_total ?? null,
    currency: moeda(s.currency),
    paidAt: effect === "PAYMENT_SUCCEEDED" ? instanteDoEvento(event) : null,
  };
}

function doPaymentIntent(
  event: Stripe.Event,
  effect: WebhookEffect,
): NormalizedWebhookEvent {
  const pi = event.data.object as Stripe.PaymentIntent;
  const erro = pi.last_payment_error;
  return {
    ...base(event, effect),
    ...metadataDe(pi.metadata),
    providerPaymentId: pi.id,
    amountCents: effect === "PAYMENT_SUCCEEDED" ? pi.amount_received : pi.amount,
    currency: moeda(pi.currency),
    failureCode: texto(erro?.code),
    failureMessage: texto(erro?.message),
    paidAt: effect === "PAYMENT_SUCCEEDED" ? instanteDoEvento(event) : null,
  };
}

function daCobranca(
  event: Stripe.Event,
  effect: WebhookEffect,
): NormalizedWebhookEvent {
  const c = event.data.object as Stripe.Charge;
  const cartao = c.payment_method_details?.card;
  const reembolso =
    effect === "PAYMENT_REFUNDED" || effect === "PAYMENT_PARTIALLY_REFUNDED";

  return {
    ...base(event, effect),
    ...metadataDe(c.metadata),
    providerPaymentId: idDe(c.payment_intent) ?? c.id,
    // Em reembolso o valor que interessa é o DEVOLVIDO — é ele que sai de
    // Reservation.paidCents, não o valor original da cobrança.
    amountCents: reembolso ? c.amount_refunded : c.amount,
    currency: moeda(c.currency),
    // Bandeira e 4 últimos dígitos vêm prontos do Stripe; é o máximo que
    // pode ser guardado (RN-009), e só aparece em evento de charge —
    // sessão e payment_intent não trazem isso sem `expand`.
    cardBrand: texto(cartao?.brand),
    cardLast4: texto(cartao?.last4),
    receiptUrl: texto(c.receipt_url),
    failureCode: texto(c.failure_code),
    failureMessage: texto(c.failure_message),
    paidAt: effect === "PAYMENT_SUCCEEDED" ? instanteDoEvento(event) : null,
  };
}

/**
 * Traduz o vocabulário do Stripe para o efeito de negócio.
 *
 * Exportada para teste: o mapeamento errado de um único tipo de evento é a
 * diferença entre confirmar e não confirmar uma reserva paga.
 */
export function normalizarEventoStripe(
  event: Stripe.Event,
): NormalizedWebhookEvent {
  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object as Stripe.Checkout.Session;
      // Sessão concluída ≠ dinheiro recebido: pix e boleto fecham a sessão
      // com `payment_status: "unpaid"` e só confirmam depois, em
      // `async_payment_succeeded`. Tratar isso como pago confirmaria
      // reserva sem pagamento.
      return daSessao(
        event,
        s.payment_status === "paid" ? "PAYMENT_SUCCEEDED" : "IGNORED",
      );
    }

    case "checkout.session.async_payment_succeeded":
      return daSessao(event, "PAYMENT_SUCCEEDED");

    case "checkout.session.async_payment_failed":
      return daSessao(event, "PAYMENT_FAILED");

    // Expirou sem ninguém tentar pagar — cancelamento, não falha de
    // cobrança. A distinção importa para o relatório e para a decisão de
    // reoferecer a reserva.
    case "checkout.session.expired":
      return daSessao(event, "PAYMENT_EXPIRED");

    case "payment_intent.succeeded":
      return doPaymentIntent(event, "PAYMENT_SUCCEEDED");

    case "payment_intent.payment_failed":
      return doPaymentIntent(event, "PAYMENT_FAILED");

    // Chega junto de payment_intent.succeeded, com id de evento próprio.
    // Não é redundante: é a única fonte de bandeira/últimos dígitos/recibo.
    // A dupla baixa é impedida na transição de status, não aqui.
    case "charge.succeeded":
      return daCobranca(event, "PAYMENT_SUCCEEDED");

    case "charge.refunded": {
      const c = event.data.object as Stripe.Charge;
      return daCobranca(
        event,
        c.amount_refunded < c.amount
          ? "PAYMENT_PARTIALLY_REFUNDED"
          : "PAYMENT_REFUNDED",
      );
    }

    // Todo o resto é registrado (fica em WebhookEvent para diagnóstico) e
    // não vira efeito. Ignorar em silêncio um tipo desconhecido é melhor
    // que adivinhar o que ele significa para o dinheiro.
    default:
      return base(event, "IGNORED");
  }
}

export function createStripeProvider(
  config: StripeConfig,
  /** Injetável para teste — nenhuma chamada de rede acontece no construtor. */
  client: Stripe = new Stripe(config.secretKey),
): PaymentProviderAdapter {
  return {
    key: "STRIPE",

    async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
      const metadata = {
        ...req.metadata,
        [META_RESERVATION]: req.reservationId,
      };

      const session = await client.checkout.sessions.create(
        {
          mode: "payment",
          success_url: req.successUrl,
          cancel_url: req.cancelUrl,
          client_reference_id: req.reservationId,
          line_items: [
            {
              quantity: 1,
              price_data: {
                // O Stripe exige a moeda em minúsculas; o banco guarda em
                // maiúsculas. A conversão fica confinada a esta fronteira.
                currency: req.currency.toLowerCase(),
                unit_amount: req.amountCents,
                product_data: { name: req.description.slice(0, MAX_DESCRICAO) },
              },
            },
          ],
          metadata,
          // O mesmo metadata no PaymentIntent gerado: os eventos de
          // `payment_intent.*` e `charge.*` chegam sem referência à sessão,
          // e sem isso o webhook não teria como descobrir o tenant.
          payment_intent_data: { metadata },
        },
        // Idempotência no lado do Stripe: reenvio do formulário ou retry de
        // rede devolve a MESMA sessão, em vez de abrir uma segunda cobrança.
        { idempotencyKey: req.idempotencyKey },
      );

      if (!session.url) {
        throw new CheckoutError(
          "O Stripe criou a sessão mas não devolveu URL de pagamento.",
        );
      }

      return {
        provider: "STRIPE",
        providerSessionId: session.id,
        redirectUrl: session.url,
      };
    },

    async parseWebhook(
      rawBody: string,
      signatureHeader: string | null,
    ): Promise<NormalizedWebhookEvent> {
      if (!config.webhookSecret) {
        throw new WebhookNotConfiguredError(
          "STRIPE_WEBHOOK_SECRET não configurado: sem ele não há como " +
            "verificar a assinatura, e webhook não verificado não confirma " +
            "pagamento (RN-009).",
        );
      }
      if (!signatureHeader) {
        throw new WebhookSignatureError(
          "Requisição sem o cabeçalho `stripe-signature`.",
        );
      }

      let event: Stripe.Event;
      try {
        // Corpo CRU, byte a byte: a assinatura cobre a string recebida, e
        // reserializar o JSON (mesmo com o mesmo conteúdo) já a invalida.
        event = await client.webhooks.constructEventAsync(
          rawBody,
          signatureHeader,
          config.webhookSecret,
        );
      } catch (err) {
        throw new WebhookSignatureError(
          `Assinatura do webhook Stripe rejeitada: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }

      return normalizarEventoStripe(event);
    },
  };
}
