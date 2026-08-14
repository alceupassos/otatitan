"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireActor } from "@/lib/auth/session";
import { ForbiddenError } from "@/lib/db/errors";
import { logger } from "@/lib/logging/logger";
import { abrirCobranca } from "@/lib/payments/cobranca";
import { CheckoutError } from "@/lib/payments/errors";
import {
  cancelarReserva,
  confirmarReserva,
  registrarCheckIn,
  registrarCheckOut,
  registrarPagamentoManual,
} from "@/lib/reservations/actions";
import { ReservaError } from "@/lib/reservations/errors";
import {
  cancelamentoSchema,
  pagamentoManualSchema,
} from "@/lib/reservations/schemas";

/**
 * Server actions da tela de detalhe da reserva.
 *
 * Elas são só a casca: quem decide é `@/lib/reservations/actions`, que
 * confere a permissão e roda a máquina de estados junto ao dado. Esta
 * camada existe porque aquele módulo NÃO é `"use server"` de propósito —
 * suas funções recebem o `ActorContext` como parâmetro, e expô-las como
 * endpoint deixaria qualquer um forjar o ator. Aqui o ator vem sempre de
 * `requireActor()`, na sessão.
 *
 * O contrato de retorno é o mesmo dos outros formulários do app
 * (`CalendarioFormState`, `HospedeFormState`): erro de domínio vira texto
 * legível na tela, nunca stack trace nem erro cru do Prisma.
 */

export type AcaoReservaState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  values?: Record<string, string>;
  ok?: boolean;
  /** Confirmação curta do que aconteceu, para a tela ecoar ao operador. */
  mensagem?: string;
};

const idSchema = z.uuid();

function coletar(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    if (typeof v === "string" && k !== "$ACTION_ID") out[k] = v;
  }
  return out;
}

function erroDeCampos(
  issues: { path: PropertyKey[]; message: string }[],
  formData: FormData,
): AcaoReservaState {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of issues) {
    const campo = String(issue.path[0] ?? "_");
    (fieldErrors[campo] ??= []).push(issue.message);
  }
  return { fieldErrors, values: coletar(formData) };
}

/**
 * Traduz a falha para a tela.
 *
 * `ReservaError` já nasce com mensagem em pt-BR pronta para o operador
 * (inclusive a da transição recusada, que nomeia a ação e o estado). O que
 * não for erro de domínio vira mensagem genérica e vai para o log — é
 * defeito nosso, e o usuário não tem o que fazer com o texto do Prisma.
 */
function traduzirFalha(
  err: unknown,
  contexto: string,
  formData: FormData,
): AcaoReservaState {
  if (err instanceof ReservaError) {
    return { error: err.message, values: coletar(formData) };
  }
  // A recusa do provedor de pagamento já chega em pt-BR e nomeia o motivo
  // (valor inválido, checkout recusado, provedor manual sem link) — é o que
  // o operador precisa ler para decidir cobrar por fora.
  if (err instanceof CheckoutError) {
    return { error: err.message, values: coletar(formData) };
  }
  if (err instanceof ForbiddenError) {
    return {
      error: "Você não tem permissão para esta ação.",
      values: coletar(formData),
    };
  }
  logger.error({ err: (err as Error).message, contexto }, "Falha em ação de reserva");
  return {
    error: "Não foi possível concluir a operação. Tente novamente.",
    values: coletar(formData),
  };
}

/**
 * A reserva mudou: a lista, o detalhe e o calendário precisam reler.
 *
 * O calendário entra porque cancelar devolve as datas (RN-005) — deixar
 * o cache antigo lá esconderia justamente a data que voltou a ser vendável.
 */
function revalidarReserva(id: string): void {
  revalidatePath("/reservas");
  revalidatePath(`/reservas/${id}`);
  revalidatePath("/calendario");
}

function lerId(formData: FormData): string | null {
  const bruto = String(formData.get("reservaId") ?? "");
  return idSchema.safeParse(bruto).success ? bruto : null;
}

const RESERVA_INVALIDA: AcaoReservaState = { error: "Reserva não encontrada." };

// ── Transições de status ──────────────────────────────────────────────────

/** Ações que a máquina de estados expõe a um clique de botão. */
const ACOES_DE_TRANSICAO = {
  confirmar: {
    executar: confirmarReserva,
    feita: "Reserva confirmada.",
    jaEstava: "Esta reserva já estava confirmada.",
  },
  "check-in": {
    executar: registrarCheckIn,
    feita: "Check-in registrado.",
    jaEstava: "O check-in desta reserva já havia sido registrado.",
  },
  "check-out": {
    executar: registrarCheckOut,
    feita: "Check-out registrado.",
    jaEstava: "O check-out desta reserva já havia sido registrado.",
  },
} as const;

const acaoSchema = z.enum(["confirmar", "check-in", "check-out"]);

/**
 * Confirma, dá check-in ou dá check-out — a ação vem do botão que enviou o
 * formulário (`name="acao"`), e só os três nomes da tabela acima passam.
 *
 * "Já estava nesse estado" não é erro: é o duplo clique e o retorno do
 * botão-voltar, e o domínio responde `jaEstava` justamente para a tela não
 * precisar tratar isso como falha.
 */
export async function transicionarReservaAction(
  _prev: AcaoReservaState | undefined,
  formData: FormData,
): Promise<AcaoReservaState> {
  const id = lerId(formData);
  if (!id) return RESERVA_INVALIDA;

  const acao = acaoSchema.safeParse(formData.get("acao"));
  if (!acao.success) return { error: "Ação desconhecida." };

  const { executar, feita, jaEstava } = ACOES_DE_TRANSICAO[acao.data];

  try {
    const actor = await requireActor();
    const resultado = await executar(actor, id);
    revalidarReserva(id);
    return { ok: true, mensagem: resultado.aplicada ? feita : jaEstava };
  } catch (err) {
    return traduzirFalha(err, acao.data, formData);
  }
}

// ── Cancelamento (RN-005) ─────────────────────────────────────────────────

/**
 * Cancela com motivo obrigatório.
 *
 * O motivo não é burocracia: é ele que explica, seis meses depois, por que
 * aquelas datas voltaram ao calendário. Vai direto para
 * `Reservation.cancellationReason`.
 */
export async function cancelarReservaAction(
  _prev: AcaoReservaState | undefined,
  formData: FormData,
): Promise<AcaoReservaState> {
  const id = lerId(formData);
  if (!id) return RESERVA_INVALIDA;

  const parsed = cancelamentoSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return erroDeCampos(parsed.error.issues, formData);

  try {
    const actor = await requireActor();
    const resultado = await cancelarReserva(actor, id, parsed.data.motivo);
    revalidarReserva(id);
    return {
      ok: true,
      mensagem: resultado.aplicada
        ? "Reserva cancelada e datas devolvidas ao calendário."
        : "Esta reserva já estava cancelada.",
    };
  } catch (err) {
    return traduzirFalha(err, "cancelar", formData);
  }
}

// ── Baixa manual de pagamento (UC-050) ───────────────────────────────────

/**
 * Registra dinheiro que entrou fora da plataforma (dinheiro, pix,
 * transferência).
 *
 * A `idempotencyKey` vem do formulário e é estável por abertura do
 * diálogo: é o que transforma um duplo clique numa recusa clara em vez de
 * dois pagamentos. Ela é validada com o resto do formulário e o servidor
 * ainda a prefixa antes de gravar — texto vindo do cliente não escolhe em
 * que namespace de chave grava. Nenhum campo aqui aceita dado de cartão
 * (RN-009).
 *
 * Quitar a reserva a confirma automaticamente, dentro da mesma transação
 * do pagamento — por isso a mensagem de volta muda quando isso acontece.
 */
export async function registrarPagamentoAction(
  _prev: AcaoReservaState | undefined,
  formData: FormData,
): Promise<AcaoReservaState> {
  const id = lerId(formData);
  if (!id) return RESERVA_INVALIDA;

  const parsed = pagamentoManualSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return erroDeCampos(parsed.error.issues, formData);

  try {
    const actor = await requireActor();
    const resultado = await registrarPagamentoManual(actor, {
      reservationId: id,
      amountCents: parsed.data.valor,
      method: parsed.data.meio,
      intent: parsed.data.intencao,
      description: parsed.data.descricao,
      paidAt: parsed.data.recebidoEm,
      idempotencyKey: parsed.data.idempotencyKey,
    });
    revalidarReserva(id);
    return {
      ok: true,
      mensagem: resultado.confirmou
        ? "Pagamento registrado. A reserva foi quitada e confirmada."
        : resultado.abatimentoCents === 0
          ? "Pagamento registrado. Caução e extras não abatem o saldo da " +
            "estadia — o saldo devedor continua o mesmo."
          : "Pagamento registrado.",
    };
  } catch (err) {
    return traduzirFalha(err, "pagamento-manual", formData);
  }
}

// ── Cobrança por link (UC-050, provedor hospedado) ───────────────────────

/**
 * Abre a cobrança do saldo devedor no provedor e leva quem clicou para o
 * checkout.
 *
 * Nada de valor no formulário: quem apura quanto cobrar é
 * `abrirCobranca`, pelo saldo do servidor (RN-003). Clicar duas vezes não
 * gera dois links — o domínio reaproveita o que ainda vale.
 */
export async function abrirCobrancaAction(
  _prev: AcaoReservaState | undefined,
  formData: FormData,
): Promise<AcaoReservaState> {
  const id = lerId(formData);
  if (!id) return RESERVA_INVALIDA;

  let destino: string;
  try {
    const actor = await requireActor();
    const cobranca = await abrirCobranca(actor, { reservationId: id });
    destino = cobranca.redirectUrl;
    // O extrato ganhou uma cobrança pendente; quem voltar para a reserva
    // precisa vê-la.
    revalidarReserva(id);
  } catch (err) {
    return traduzirFalha(err, "abrir-cobranca", formData);
  }

  // Fora do `try`: `redirect` sinaliza por exceção, e capturá-la aqui faria
  // uma cobrança aberta com sucesso ser reportada como falha.
  redirect(destino);
}
