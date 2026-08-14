"use server";

import { requireActorWith } from "@/lib/auth/session";
import { logger } from "@/lib/logging/logger";
import { DocumentoNaoCifravel, EmailJaCadastrado, HospedeNaoEncontrado } from "./errors";
import {
  atualizarHospede,
  criarHospede,
  encontrarOuCriarHospede,
} from "./repository";
import { hospedeSchema } from "./schemas";

/**
 * Server actions de hóspedes (UC-030).
 *
 * Toda action começa por `requireActorWith(...)`: uma server action é
 * alcançável por POST direto, sem passar pela interface, então a checagem
 * feita na tela não vale como autorização aqui (ADR-007).
 */

export type HospedeFormState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  values?: Record<string, string>;
  ok?: boolean;
  /** Id do hóspede gravado, para a tela chamadora seguir o fluxo. */
  hospedeId?: string;
};

function coletarCampos(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    // `documentNumber` é o número em claro: devolvê-lo ao formulário o
    // faria trafegar de volta e aparecer no HTML sem necessidade.
    if (typeof v === "string" && k !== "$ACTION_ID" && k !== "documentNumber") {
      out[k] = v;
    }
  }
  return out;
}

function erroDeValidacao(
  issues: { path: PropertyKey[]; message: string }[],
  formData: FormData,
): HospedeFormState {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of issues) {
    const campo = String(issue.path[0] ?? "_");
    (fieldErrors[campo] ??= []).push(issue.message);
  }
  return { fieldErrors, values: coletarCampos(formData) };
}

/** Traduz os erros de domínio para o formato que o formulário consome. */
function estadoDeErro(err: unknown, formData: FormData): HospedeFormState {
  if (err instanceof EmailJaCadastrado) {
    return {
      fieldErrors: {
        email: [
          "Já existe um hóspede com este e-mail. Abra o cadastro existente em vez de duplicá-lo.",
        ],
      },
      values: coletarCampos(formData),
      hospedeId: err.hospedeId,
    };
  }
  if (err instanceof DocumentoNaoCifravel) {
    return { error: err.message, values: coletarCampos(formData) };
  }
  if (err instanceof HospedeNaoEncontrado) {
    return { error: "Hóspede não encontrado." };
  }
  // Só o inesperado vai para o log — e sem o corpo do formulário, que
  // carrega dado pessoal (docs/11-seguranca-lgpd.md).
  logger.error({ err: (err as Error).message }, "Falha ao salvar hóspede");
  return {
    error: "Não foi possível salvar o hóspede.",
    values: coletarCampos(formData),
  };
}

export async function criarHospedeAction(
  _prev: HospedeFormState | undefined,
  formData: FormData,
): Promise<HospedeFormState> {
  const actor = await requireActorWith("guests.create");

  const parsed = hospedeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return erroDeValidacao(parsed.error.issues, formData);

  try {
    const hospedeId = await criarHospede(actor, parsed.data);
    return { ok: true, hospedeId };
  } catch (err) {
    return estadoDeErro(err, formData);
  }
}

export async function atualizarHospedeAction(
  hospedeId: string,
  _prev: HospedeFormState | undefined,
  formData: FormData,
): Promise<HospedeFormState> {
  const actor = await requireActorWith("guests.edit");

  const parsed = hospedeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return erroDeValidacao(parsed.error.issues, formData);

  try {
    await atualizarHospede(actor, hospedeId, parsed.data, {
      // Campo em branco não apaga o documento; a remoção é um pedido
      // explícito do titular (LGPD, art. 18).
      removerDocumento: formData.get("removerDocumento") === "on",
    });
    return { ok: true, hospedeId };
  } catch (err) {
    return estadoDeErro(err, formData);
  }
}

/**
 * Resolve o hóspede a partir do bloco de dados do formulário de reserva.
 *
 * Existe para a tela de nova reserva poder validar e gravar o hóspede antes
 * de montar a reserva. Um fluxo que já roda no servidor e tem o `actor` em
 * mãos deve chamar `encontrarOuCriarHospede` de `./repository` direto — sem
 * pagar outra resolução de sessão.
 */
export async function resolverHospedeDaReservaAction(
  _prev: HospedeFormState | undefined,
  formData: FormData,
): Promise<HospedeFormState> {
  const actor = await requireActorWith("guests.create");

  const parsed = hospedeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return erroDeValidacao(parsed.error.issues, formData);

  try {
    const { id } = await encontrarOuCriarHospede(actor, parsed.data);
    return { ok: true, hospedeId: id };
  } catch (err) {
    return estadoDeErro(err, formData);
  }
}
