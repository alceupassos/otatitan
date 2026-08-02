/**
 * Confere a configuração de pagamento do ambiente atual.
 *
 *   npm run check:payments
 *
 * Imprime o provedor ativo e o ambiente (sandbox/produção), nunca a
 * credencial. Serve para responder, antes de existir cobrança, se as
 * chaves estão coerentes — inclusive o caso da chave do Asaas corrompida
 * por expansão de shell, que é invisível a olho nu.
 */
import {
  PaymentConfigError,
  describePaymentConfig,
  loadPaymentConfig,
} from "../src/lib/payments/config";

function reportar(rotulo: string, env: NodeJS.ProcessEnv) {
  try {
    const config = loadPaymentConfig(env);
    console.log(`${rotulo}: ${describePaymentConfig(config)}`);

    if (config.provider !== "MANUAL" && !config.webhookReady) {
      console.log(
        "  ⚠  Sem segredo de webhook: não dá para verificar a assinatura, " +
          "e webhook não verificado não confirma pagamento (RN-009).",
      );
    }
    if (config.provider === "ASAAS" && !config.sandbox) {
      console.log("  ⚠  Asaas em PRODUÇÃO — cobranças movimentam dinheiro real.");
    }
    if (config.provider === "STRIPE" && !config.testMode) {
      console.log("  ⚠  Stripe em PRODUÇÃO — cobranças movimentam dinheiro real.");
    }
  } catch (err) {
    if (err instanceof PaymentConfigError) {
      console.error(`${rotulo}: ❌ ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}

// Provedor ativo.
reportar("Provedor ativo", process.env);

// Os demais provedores também são conferidos: um deles estar mal
// configurado só apareceria no dia em que fosse ativado.
for (const alternativo of ["STRIPE", "ASAAS"] as const) {
  if (process.env.PAYMENTS_DEFAULT_PROVIDER === alternativo) continue;

  const temChave =
    alternativo === "STRIPE"
      ? Boolean(process.env.STRIPE_SECRET_KEY)
      : Boolean(process.env.ASAAS_API_KEY);
  if (!temChave) continue;

  reportar(`${alternativo} (configurado, inativo)`, {
    ...process.env,
    PAYMENTS_DEFAULT_PROVIDER: alternativo,
  });
}
