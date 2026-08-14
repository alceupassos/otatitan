import { WebhookNotConfiguredError } from "../errors";
import type {
  CheckoutResult,
  NormalizedWebhookEvent,
  PaymentProviderAdapter,
} from "../provider";

/**
 * Provedor manual — dinheiro, pix ou transferência combinados fora da
 * plataforma.
 *
 * Não há redirect nem sessão: o `Payment` nasce PENDING e quem dá a baixa é
 * o operador, na tela, com a permissão `payments.create`
 * (docs/07-matriz-permissoes.md). O adapter existe para que reservas e
 * relatórios falem com uma interface só, sem um `if (provider === 'MANUAL')`
 * espalhado pelo código.
 *
 * É também o provedor padrão do ambiente (`PAYMENTS_DEFAULT_PROVIDER`), o
 * que faz o sistema funcionar sem nenhuma credencial configurada — a conta
 * do Stripe é opcional para quem só quer controlar as reservas.
 */
export function createManualProvider(): PaymentProviderAdapter {
  return {
    key: "MANUAL",

    async createCheckout(): Promise<CheckoutResult> {
      /**
       * `method` (dinheiro/pix/transferência/maquininha) é escolha do
       * operador e já está na request; aqui não há para onde mandar o
       * pagador. Registrar CARD é legítimo — é a maquininha física, e o que
       * o RN-009 proíbe é o DADO do cartão, que este adapter não tem campo
       * para receber nem para guardar.
       */
      return {
        provider: "MANUAL",
        providerSessionId: null,
        redirectUrl: null,
      };
    },

    async parseWebhook(): Promise<NormalizedWebhookEvent> {
      // Não existe caminho em que um POST anônimo dê baixa num pagamento
      // manual: sem provedor externo, não há assinatura para verificar, e
      // sem assinatura não se aceita evento (RN-009).
      throw new WebhookNotConfiguredError(
        "O provedor manual não recebe webhooks — a baixa é feita na tela pelo operador.",
      );
    },
  };
}
