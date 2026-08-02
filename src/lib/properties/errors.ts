/**
 * Erros do módulo de imóveis.
 *
 * Vivem fora de `actions.ts` porque um arquivo `"use server"` só pode
 * exportar funções assíncronas — exportar uma classe de lá é erro de
 * compilação.
 */

/**
 * Recurso inexistente OU fora do escopo do ator. Os dois casos usam o
 * mesmo erro de propósito: distinguir "não existe" de "existe mas não é
 * seu" confirmaria a existência do id para quem não deveria saber
 * (docs/12-plano-testes.md).
 */
export class NotFoundInScope extends Error {
  constructor(message = "Recurso não encontrado.") {
    super(message);
    this.name = "NotFoundInScope";
  }
}

/** Unidade com ocupação futura não pode ser arquivada (RN-002/RN-005). */
export class UnitEmUso extends Error {
  constructor(public readonly ocupacoes: number) {
    super(
      `A unidade tem ${ocupacoes} ocupação(ões) futura(s). ` +
        `Cancele as reservas antes de arquivá-la.`,
    );
    this.name = "UnitEmUso";
  }
}

/** Códigos de erro que viajam na querystring após um redirect. */
export const ERRO_QUERY = {
  naoEncontrado: "nao_encontrado",
  unidadeEmUso: "unidade_em_uso",
  falha: "falha",
} as const;

export const ERRO_MENSAGENS: Record<string, string> = {
  [ERRO_QUERY.naoEncontrado]: "Registro não encontrado.",
  [ERRO_QUERY.unidadeEmUso]:
    "Esta unidade tem reservas futuras. Cancele-as antes de arquivar.",
  [ERRO_QUERY.falha]: "Não foi possível concluir a operação.",
};
