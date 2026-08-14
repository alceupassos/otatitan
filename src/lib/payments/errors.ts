/**
 * Erros do módulo de pagamentos.
 *
 * Vivem em arquivo próprio porque são compartilhados por três chamadores
 * com regras diferentes de reação: server actions (mostram mensagem ao
 * operador), o route handler do webhook (traduz para código HTTP — e o
 * código HTTP decide se o Stripe retenta) e os testes.
 */

export class PaymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentError";
  }
}

/**
 * O provedor pedido não está configurado neste ambiente (falta chave, ou
 * a configuração é de outro provedor).
 */
export class ProviderNotConfiguredError extends PaymentError {
  constructor(message: string) {
    super(message);
    this.name = "ProviderNotConfiguredError";
  }
}

/** Provedor válido no enum, mas sem adapter escrito ainda. */
export class ProviderNotImplementedError extends PaymentError {
  constructor(public readonly provider: string) {
    super(`Provedor de pagamento sem adapter implementado: ${provider}.`);
    this.name = "ProviderNotImplementedError";
  }
}

/**
 * Assinatura ausente ou inválida.
 *
 * Erro, nunca aceitação otimista: um webhook não verificado é uma
 * requisição anônima da internet dizendo "esta reserva foi paga"
 * (RN-009 / docs/11-seguranca-lgpd.md). O handler responde 4xx e não
 * grava efeito nenhum.
 */
export class WebhookSignatureError extends PaymentError {
  constructor(message = "Assinatura do webhook inválida.") {
    super(message);
    this.name = "WebhookSignatureError";
  }
}

/**
 * Falta o segredo de verificação (ou o provedor não recebe webhook).
 *
 * Separado de `WebhookSignatureError` de propósito: aqui o defeito é
 * nosso, de configuração — o remetente pode ser legítimo e o evento vai
 * ser perdido. Merece 5xx e alarme, não 4xx silencioso.
 */
export class WebhookNotConfiguredError extends PaymentError {
  constructor(message: string) {
    super(message);
    this.name = "WebhookNotConfiguredError";
  }
}

/** Falha ao abrir a cobrança no provedor (valor inválido, recusa da API). */
export class CheckoutError extends PaymentError {
  constructor(message: string) {
    super(message);
    this.name = "CheckoutError";
  }
}
