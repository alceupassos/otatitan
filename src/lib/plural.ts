/**
 * Concordância de número em pt-BR.
 *
 * Existe porque `${n} ${palavra}s` produz "1 quartos" — erro que passa
 * despercebido em revisão de código e salta aos olhos na tela.
 */
export function plural(n: number, singular: string, pluralForma?: string): string {
  return n === 1 ? singular : (pluralForma ?? `${singular}s`);
}

/** `contar(1, "quarto")` → "1 quarto"; `contar(3, "quarto")` → "3 quartos". */
export function contar(n: number, singular: string, pluralForma?: string): string {
  return `${n} ${plural(n, singular, pluralForma)}`;
}
