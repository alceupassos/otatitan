import { z } from "zod";
import { hojeUtc, tryParseDateOnly } from "@/lib/dates";

/**
 * Validação de hóspedes (UC-030) — a ficha que a tela de nova reserva
 * preenche antes de fechar a estadia.
 *
 * Entrada sempre em `string`, porque tanto o formulário de cadastro quanto
 * o bloco de hóspede da reserva chegam como `FormData`. Todo campo além de
 * nome e sobrenome é opcional: numa reserva de balcão o atendente tem o
 * nome e pouco mais, e recusar o cadastro por falta de CPF travaria a
 * operação em vez de protegê-la.
 */

export const TIPOS_DOCUMENTO = ["CPF", "PASSPORT", "RG", "OTHER"] as const;

export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number];

export const TIPO_DOCUMENTO_LABELS: Record<TipoDocumento, string> = {
  CPF: "CPF",
  PASSPORT: "Passaporte",
  RG: "RG",
  OTHER: "Outro documento",
};

/** Idade máxima plausível — pega ano digitado errado (1092 em vez de 1992). */
const IDADE_MAXIMA_ANOS = 120;

// ── Normalizações reaproveitáveis ─────────────────────────────────────────

/**
 * Telefone em E.164 (`+5521999991234`).
 *
 * Guardar normalizado é o que faz a busca do autocomplete funcionar: o
 * atendente digita "(21) 99999-1234" e o banco tem uma forma só, em vez de
 * cinco grafias do mesmo número. Retorna `null` quando o valor não é um
 * telefone reconhecível — o chamador trata vazio antes de chamar.
 */
export function normalizarTelefone(bruto: string): string | null {
  const limpo = bruto.trim();
  if (limpo === "") return null;

  const ehInternacional = limpo.startsWith("+");
  const digitos = limpo.replace(/\D/g, "");
  if (digitos === "") return null;

  // Com "+" o usuário está afirmando o código do país; não cabe adivinhar.
  if (ehInternacional) {
    return digitos.length >= 8 && digitos.length <= 15 ? `+${digitos}` : null;
  }

  // Já veio com o 55 na frente, sem o "+".
  if (digitos.startsWith("55") && (digitos.length === 12 || digitos.length === 13)) {
    return `+${digitos}`;
  }

  // Formato brasileiro: DDD + 8 (fixo) ou 9 (celular) dígitos.
  if (digitos.length === 10 || digitos.length === 11) {
    // DDD válido não tem zero em nenhuma das duas casas.
    if (!/^[1-9][1-9]/.test(digitos)) return null;
    // Celular no Brasil sempre começa com 9 depois do DDD.
    if (digitos.length === 11 && digitos[2] !== "9") return null;
    return `+55${digitos}`;
  }

  return null;
}

/**
 * Dígitos verificadores do CPF.
 *
 * Vale a pena validar de verdade: um CPF trocado só aparece na emissão da
 * nota ou no check-in, quando o hóspede já está no balcão.
 */
export function validarCpf(valor: string): boolean {
  const d = valor.replace(/\D/g, "");
  if (d.length !== 11) return false;
  // Sequências repetidas passam no cálculo dos dígitos, mas não são CPFs.
  if (/^(\d)\1{10}$/.test(d)) return false;

  for (const [tamanho, pesoInicial] of [
    [9, 10],
    [10, 11],
  ] as const) {
    let soma = 0;
    for (let i = 0; i < tamanho; i++) soma += Number(d[i]) * (pesoInicial - i);
    const resto = (soma * 10) % 11;
    if ((resto === 10 ? 0 : resto) !== Number(d[tamanho])) return false;
  }
  return true;
}

/**
 * Forma canônica do documento antes de cifrar. CPF vira só dígitos;
 * passaporte e RG mantêm letras (há RG com "X" e passaporte alfanumérico).
 */
export function normalizarDocumento(tipo: TipoDocumento, bruto: string): string {
  return tipo === "CPF"
    ? bruto.replace(/\D/g, "")
    : bruto.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Sufixo exibível do documento — o único pedaço que fica em claro. */
export function ultimosQuatro(documento: string): string {
  return documento.slice(-4);
}

/** "Ana Paula Souza" — nome de exibição em listas e no calendário. */
export function nomeCompleto(g: { firstName: string; lastName: string }): string {
  return `${g.firstName} ${g.lastName}`.trim();
}

// ── Blocos do schema ──────────────────────────────────────────────────────

/** Texto opcional: ausente ou vazio no formulário significa "não informado". */
const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: `Máximo de ${max} caracteres.` })
    .optional()
    .transform((v) => (v === undefined || v === "" ? null : v));

/** Checkbox: só aparece no `FormData` quando marcado, mas pode vir booleano. */
const checkbox = z
  .union([z.string(), z.boolean()])
  .optional()
  .transform((v) => v === true || v === "on" || v === "true");

const emailOpcional = z
  .string()
  .trim()
  .toLowerCase()
  .optional()
  .transform((v, ctx) => {
    if (v === undefined || v === "") return null;
    if (v.length > 200) {
      ctx.addIssue({ code: "custom", message: "Máximo de 200 caracteres." });
      return z.NEVER;
    }
    if (!z.email().safeParse(v).success) {
      ctx.addIssue({ code: "custom", message: "Informe um e-mail válido." });
      return z.NEVER;
    }
    return v;
  });

const telefoneOpcional = z
  .string()
  .optional()
  .transform((v, ctx) => {
    const bruto = (v ?? "").trim();
    if (bruto === "") return null;
    const normalizado = normalizarTelefone(bruto);
    if (!normalizado) {
      ctx.addIssue({
        code: "custom",
        message: "Telefone inválido. Use DDD e número, ex.: (21) 99999-1234.",
      });
      return z.NEVER;
    }
    return normalizado;
  });

const nascimentoOpcional = z
  .string()
  .optional()
  .transform((v, ctx) => {
    const bruto = (v ?? "").trim();
    if (bruto === "") return null;

    const d = tryParseDateOnly(bruto);
    if (!d) {
      ctx.addIssue({ code: "custom", message: "Informe uma data válida." });
      return z.NEVER;
    }

    // Data de nascimento é dia de calendário, não instante (RN-007): quem
    // nasceu em 10/03 nasceu em 10/03 em qualquer fuso.
    const hoje = hojeUtc();
    if (d >= hoje) {
      ctx.addIssue({
        code: "custom",
        message: "A data de nascimento precisa estar no passado.",
      });
      return z.NEVER;
    }
    const limite = new Date(
      Date.UTC(hoje.getUTCFullYear() - IDADE_MAXIMA_ANOS, hoje.getUTCMonth(), hoje.getUTCDate()),
    );
    if (d < limite) {
      ctx.addIssue({ code: "custom", message: "Confira o ano de nascimento." });
      return z.NEVER;
    }
    return d;
  });

const paisSchema = z
  .string()
  .trim()
  .toUpperCase()
  .optional()
  // Sem informação, assume Brasil: é a esmagadora maioria da hospedagem
  // por temporada aqui, e o campo é NOT NULL no banco.
  .transform((v) => (v === undefined || v === "" ? "BR" : v))
  .refine((v) => /^[A-Z]{2}$/.test(v), {
    error: "Use a sigla de duas letras do país, ex.: BR.",
  });

const documentTypeOpcional = z
  .union([z.enum(TIPOS_DOCUMENTO), z.literal("")])
  .optional()
  .transform((v) => (v === undefined || v === "" ? null : v));

export const hospedeSchema = z
  .object({
    firstName: z
      .string()
      .trim()
      .min(2, { error: "Informe o nome do hóspede." })
      .max(80, { error: "Máximo de 80 caracteres." }),
    lastName: z
      .string()
      .trim()
      .min(2, { error: "Informe o sobrenome do hóspede." })
      .max(120, { error: "Máximo de 120 caracteres." }),
    email: emailOpcional,
    phone: telefoneOpcional,
    documentType: documentTypeOpcional,
    /**
     * Número em claro. NÃO é o que vai para o banco — a camada de escrita
     * cifra em `documentNumberEnc` e guarda só os 4 últimos em claro
     * (docs/11-seguranca-lgpd.md). Nunca colocar este campo em log ou
     * auditoria.
     */
    documentNumber: textoOpcional(40),
    birthDate: nascimentoOpcional,
    nationality: textoOpcional(60),
    country: paisSchema,
    notes: textoOpcional(2000),
    /**
     * Consentimento de marketing (LGPD, art. 8º): opt-in explícito. Nunca
     * marcamos por padrão nem herdamos de outra finalidade — o padrão é
     * `false` no banco e aqui.
     */
    marketingOptIn: checkbox,
  })
  .refine((g) => !(g.documentNumber && !g.documentType), {
    error: "Selecione o tipo do documento.",
    path: ["documentType"],
  })
  .refine((g) => !(g.documentType && !g.documentNumber), {
    error: "Informe o número do documento.",
    path: ["documentNumber"],
  })
  .refine((g) => g.documentType !== "CPF" || validarCpf(g.documentNumber ?? ""), {
    error: "CPF inválido.",
    path: ["documentNumber"],
  })
  .transform((g) => ({
    ...g,
    // Guarda a forma canônica para a cifragem não depender da pontuação
    // que o operador digitou.
    documentNumber:
      g.documentType && g.documentNumber
        ? normalizarDocumento(g.documentType, g.documentNumber)
        : null,
  }));

export type HospedeInput = z.infer<typeof hospedeSchema>;

/** Teto do autocomplete: lista longa não ajuda quem está digitando. */
export const LIMITE_BUSCA_PADRAO = 10;
export const LIMITE_BUSCA_MAXIMO = 50;
