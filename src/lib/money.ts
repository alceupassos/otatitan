/**
 * Dinheiro sempre em centavos inteiros (RN-006). Nunca `Float`.
 *
 * Este módulo é a única fronteira sancionada entre o que o usuário digita
 * ("1.234,56") e o que o banco guarda (123456). Fazer essa conversão à mão
 * em cada formulário é como o erro de meio centavo entra num sistema.
 */

/** Formata centavos para exibição em pt-BR: 123456 → "R$ 1.234,56". */
export function formatMoney(cents: number, currency = "BRL"): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency,
  });
}

/** Centavos → valor editável num input numérico: 123456 → "1234.56". */
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(2);
}

export class MoneyParseError extends Error {
  constructor(entrada: string) {
    super(`Valor monetário inválido: "${entrada}"`);
    this.name = "MoneyParseError";
  }
}

/**
 * Converte o que veio do formulário para centavos.
 *
 * Aceita as duas convenções que aparecem na prática — "1.234,56" (pt-BR,
 * digitado por gente) e "1234.56" (input `type=number`, que sempre usa
 * ponto) — porque o mesmo campo pode chegar de um jeito ou de outro
 * dependendo do navegador e do teclado.
 *
 * A conversão final é feita sobre a STRING, não com `valor * 100`:
 * `1.005 * 100` dá 100.49999999999999 em ponto flutuante, e arredondar
 * isso devolve 100 centavos onde o usuário digitou 1,005 e espera 101.
 * Dinheiro não passa por float em lugar nenhum deste caminho (RN-006).
 */
export function parseMoneyToCents(entrada: string): number {
  const limpo = entrada.trim().replace(/\s/g, "").replace(/^R\$/i, "");
  if (limpo === "") throw new MoneyParseError(entrada);

  const temVirgula = limpo.includes(",");
  const temPonto = limpo.includes(".");

  let normalizado: string;
  if (temVirgula && temPonto) {
    // O separador decimal é o que aparece por último: "1.234,56" (pt-BR)
    // ou "1,234.56" (en-US). O outro é separador de milhar.
    const decimal = limpo.lastIndexOf(",") > limpo.lastIndexOf(".") ? "," : ".";
    const milhar = decimal === "," ? "." : ",";
    normalizado = limpo.split(milhar).join("").replace(decimal, ".");
  } else if (temVirgula) {
    normalizado = limpo.replace(",", ".");
  } else {
    // Só ponto: pode ser decimal ("1234.56") ou milhar ("1.234"). Dois
    // dígitos depois do último ponto = decimal; três = milhar.
    const partes = limpo.split(".");
    normalizado =
      partes.length > 1 && partes[partes.length - 1]!.length === 3
        ? partes.join("")
        : limpo;
  }

  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(normalizado);
  if (!m) throw new MoneyParseError(entrada);

  const [, sinal, inteiro, fracao = ""] = m;

  // Duas primeiras casas viram centavos; a terceira em diante decide o
  // arredondamento (meio para cima), tudo em aritmética inteira.
  const centavosStr = fracao.padEnd(2, "0").slice(0, 2);
  const resto = fracao.slice(2);
  const arredonda = resto !== "" && Number(resto[0]) >= 5 ? 1 : 0;

  const total = Number(inteiro) * 100 + Number(centavosStr) + arredonda;
  if (!Number.isSafeInteger(total)) throw new MoneyParseError(entrada);

  return sinal === "-" ? -total : total;
}

/** Versão que não lança — devolve `null` quando não dá para interpretar. */
export function tryParseMoneyToCents(entrada: string): number | null {
  try {
    return parseMoneyToCents(entrada);
  } catch {
    return null;
  }
}
