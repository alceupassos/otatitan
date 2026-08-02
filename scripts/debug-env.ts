/**
 * Diagnóstico de variáveis sensíveis: diz se chegaram, com que tamanho e
 * que forma — nunca o valor. Usado para caçar corrupção silenciosa (a
 * chave do Asaas começa com '$' e some se o shell expandir).
 */
const CHAVES = [
  "PAYMENTS_DEFAULT_PROVIDER",
  "STRIPE_SECRET_KEY",
  "STRIPE_PUBLISHABLE_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "ASAAS_API_KEY",
  "ASAAS_SANDBOX",
  "ASAAS_WEBHOOK_TOKEN",
];

for (const chave of CHAVES) {
  const v = process.env[chave];
  if (v === undefined) {
    console.log(`${chave.padEnd(28)} AUSENTE`);
  } else if (v === "") {
    console.log(`${chave.padEnd(28)} VAZIA`);
  } else {
    // Só forma: primeiros caracteres do prefixo e tamanho.
    const prefixo = v.slice(0, 11).replace(/[^\w$_-]/g, "?");
    console.log(`${chave.padEnd(28)} ${v.length} chars, começa com "${prefixo}…"`);
  }
}
