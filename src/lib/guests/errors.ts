/**
 * Erros do módulo de hóspedes.
 *
 * Vivem fora de `actions.ts` porque um arquivo `"use server"` só pode
 * exportar funções assíncronas — exportar uma classe de lá é erro de
 * compilação.
 */

/**
 * Hóspede inexistente OU fora do alcance do ator. Os dois casos usam o
 * mesmo erro de propósito: distinguir "não existe" de "existe mas não é
 * seu" confirmaria o id para quem não deveria saber
 * (docs/12-plano-testes.md).
 */
export class HospedeNaoEncontrado extends Error {
  constructor(message = "Hóspede não encontrado.") {
    super(message);
    this.name = "HospedeNaoEncontrado";
  }
}

/**
 * Violação de `unique (tenantId, email)`.
 *
 * Existe para que o P2002 do Prisma nunca chegue cru à interface: o
 * atendente precisa ler "este e-mail já está cadastrado", não um código de
 * driver. Carrega o id do registro que já ocupa o e-mail para a tela poder
 * oferecer "abrir o hóspede existente".
 */
export class EmailJaCadastrado extends Error {
  constructor(
    public readonly email: string,
    public readonly hospedeId?: string,
  ) {
    super(`Já existe um hóspede com o e-mail ${email} nesta empresa.`);
    this.name = "EmailJaCadastrado";
  }
}

/**
 * O documento não pôde ser cifrado (`ENCRYPTION_KEY` ausente ou inválida).
 *
 * Falha explícita, e não silenciosa: gravar o número em claro violaria
 * docs/11-seguranca-lgpd.md, e descartá-lo sem avisar faria o operador
 * acreditar que a ficha está completa.
 */
export class DocumentoNaoCifravel extends Error {
  constructor() {
    super(
      "Não foi possível registrar o documento com segurança. " +
        "Salve o hóspede sem o documento e avise o suporte.",
    );
    this.name = "DocumentoNaoCifravel";
  }
}

/** Códigos de erro que viajam na querystring após um redirect. */
export const ERRO_HOSPEDES = {
  naoEncontrado: "hospede_nao_encontrado",
  emailDuplicado: "email_duplicado",
  documentoNaoCifravel: "documento_nao_cifravel",
  falha: "falha",
} as const;

export const ERRO_HOSPEDES_MENSAGENS: Record<string, string> = {
  [ERRO_HOSPEDES.naoEncontrado]: "Hóspede não encontrado.",
  [ERRO_HOSPEDES.emailDuplicado]:
    "Já existe um hóspede com este e-mail. Abra o cadastro existente em vez de duplicá-lo.",
  [ERRO_HOSPEDES.documentoNaoCifravel]:
    "Não foi possível registrar o documento com segurança. Salve sem o documento e avise o suporte.",
  [ERRO_HOSPEDES.falha]: "Não foi possível concluir a operação.",
};
