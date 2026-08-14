"use server";

import { redirect } from "next/navigation";
import { requireActorWith } from "@/lib/auth/session";
import {
  buscarDisponibilidade,
  type ResultadoBusca,
  type UnidadeVendavel,
} from "@/lib/availability/search";
import { DocumentoNaoCifravel, EmailJaCadastrado } from "@/lib/guests/errors";
import { buscarHospedes, type HospedeResumo } from "@/lib/guests/queries";
import { hospedeSchema } from "@/lib/guests/schemas";
import { logger } from "@/lib/logging/logger";
import { abrirCobranca } from "@/lib/payments/cobranca";
import type { Recusa } from "@/lib/pricing/errors";
import type { Cotacao } from "@/lib/pricing/quote";
import { buscaSchema } from "@/lib/pricing/schemas";
import { hasPermission } from "@/lib/rbac/guard";
import { criarReserva } from "@/lib/reservations/actions";
import {
  PrecoMudou,
  ReservaError,
  UnidadeIndisponivel,
  UnidadeNaoVendavel,
} from "@/lib/reservations/errors";
import { novaReservaSchema } from "@/lib/reservations/schemas";

/**
 * Server actions do fluxo de venda (UC-040).
 *
 * Toda action recomeça pela autorização com `requireActorWith(...)`: uma
 * server action é alcançável por POST direto, sem passar pela tela, então
 * o `requireActorWith` da página não vale como autorização aqui (ADR-007).
 *
 * Nenhuma delas calcula preço nem decide disponibilidade — isso é do
 * domínio (`buscarDisponibilidade`, `criarReserva`). O que mora aqui é a
 * tradução entre o formulário e o domínio, e entre o erro de domínio e a
 * mensagem que a tela mostra.
 */

// ── Formas serializáveis para o cliente ──────────────────────────────────

/**
 * A cotação sem o `snapshot`.
 *
 * O snapshot é registro contábil destinado a `Reservation.quoteSnapshot`
 * (RN-003) e repete, campo a campo, o que a tela já exibe. Mandá-lo ao
 * navegador dobraria a resposta da busca — que varre a carteira inteira —
 * sem acrescentar nada visível.
 */
export type CotacaoUI = Omit<Cotacao, "snapshot">;

export type UnidadeVendavelUI = Omit<UnidadeVendavel, "cotacao"> & {
  cotacao: CotacaoUI;
};

export type ResultadoBuscaUI = Omit<ResultadoBusca, "vendaveis"> & {
  vendaveis: UnidadeVendavelUI[];
};

function semSnapshot(cotacao: Cotacao): CotacaoUI {
  const copia: Partial<Cotacao> = { ...cotacao };
  delete copia.snapshot;
  return copia as CotacaoUI;
}

/** Agrupa as issues do Zod por campo, no formato que os formulários leem. */
function agrupar(
  issues: readonly { path: PropertyKey[]; message: string }[],
): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of issues) {
    const campo = String(issue.path[0] ?? "_");
    (fieldErrors[campo] ??= []).push(issue.message);
  }
  return fieldErrors;
}

// ── Passo 1 e 2: buscar disponibilidade (UC-030) ─────────────────────────

/** Valores crus do formulário de busca — o schema do domínio é quem converte. */
export type ValoresBusca = {
  checkIn: string;
  checkOut: string;
  hospedes: string;
  propertyId: string;
};

export type RespostaBusca =
  | { ok: true; resultado: ResultadoBuscaUI }
  | { ok: false; error?: string; fieldErrors?: Record<string, string[]> };

export async function buscarDisponibilidadeAction(
  valores: ValoresBusca,
): Promise<RespostaBusca> {
  const actor = await requireActorWith("reservations.create");

  // Mesmo schema que a tela usa no cliente: a validação do navegador é
  // conforto, não garantia — quem chega por POST direto passa por aqui.
  const parsed = buscaSchema.safeParse(valores);
  if (!parsed.success) {
    return { ok: false, fieldErrors: agrupar(parsed.error.issues) };
  }

  try {
    const resultado = await buscarDisponibilidade(actor, {
      checkIn: parsed.data.checkIn,
      checkOut: parsed.data.checkOut,
      hospedes: parsed.data.hospedes,
      propertyId: parsed.data.propertyId,
    });

    return {
      ok: true,
      resultado: {
        ...resultado,
        vendaveis: resultado.vendaveis.map((u) => ({
          ...u,
          cotacao: semSnapshot(u.cotacao),
        })),
      },
    };
  } catch (err) {
    logger.error(
      { tenantId: actor.tenantId, err: (err as Error).message },
      "Falha na busca de disponibilidade",
    );
    return {
      ok: false,
      error:
        "Não foi possível consultar a disponibilidade agora. Tente de novo em instantes.",
    };
  }
}

// ── Passo 3: hóspede (UC-030) ────────────────────────────────────────────

export type RespostaHospedes =
  | { ok: true; hospedes: HospedeResumo[] }
  | { ok: false; error: string };

/**
 * Autocomplete de hóspedes já cadastrados.
 *
 * A permissão é conferida com `hasPermission` em vez de `requirePermission`
 * porque isto roda a cada tecla digitada: um papel sem `guests.view` deve
 * ver uma linha explicando que a busca está indisponível, não a tela de
 * erro do framework no meio do formulário.
 */
export async function buscarHospedesAction(
  termo: string,
): Promise<RespostaHospedes> {
  const actor = await requireActorWith("reservations.create");

  if (!(await hasPermission(actor, "guests.view"))) {
    return {
      ok: false,
      error:
        "Seu perfil não permite consultar hóspedes cadastrados. Preencha a ficha abaixo.",
    };
  }

  try {
    const hospedes = await buscarHospedes(actor, termo.slice(0, 120));
    return { ok: true, hospedes };
  } catch (err) {
    // Sem o termo no log: ele costuma ser o nome ou o e-mail de uma pessoa
    // (docs/11-seguranca-lgpd.md).
    logger.error(
      { tenantId: actor.tenantId, err: (err as Error).message },
      "Falha na busca de hóspedes",
    );
    return { ok: false, error: "Não foi possível buscar hóspedes agora." };
  }
}

// ── Passo 4: criar a reserva (UC-040) ────────────────────────────────────

export type EstadoNovaReserva = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  /**
   * RN-003: cotação recalculada pelo servidor quando o total da tela
   * divergiu. A reserva NÃO foi criada — a tela mostra este valor e pede
   * confirmação explícita antes de tentar de novo.
   */
  cotacaoNova?: CotacaoUI;
  /** Total que estava na tela quando a divergência foi detectada. */
  totalAnteriorCents?: number;
  /** Motivos do motor de cotação quando a unidade deixou de ser vendável. */
  recusas?: Recusa[];
  /** As datas foram tomadas por outra venda enquanto a tela estava aberta. */
  ocupada?: boolean;
};

/**
 * Traduz o erro de domínio para o que a tela precisa mostrar.
 *
 * A ordem importa: `PrecoMudou`, `UnidadeNaoVendavel` e
 * `UnidadeIndisponivel` são todos `ReservaError`, e a checagem genérica
 * primeiro apagaria a cotação nova e os motivos de recusa.
 */
function estadoDeErro(err: unknown): EstadoNovaReserva {
  if (err instanceof PrecoMudou) {
    return {
      error: err.message,
      cotacaoNova: semSnapshot(err.cotacao),
      totalAnteriorCents: err.totalRecebidoCents,
    };
  }
  if (err instanceof UnidadeNaoVendavel) {
    return { error: err.message, recusas: err.recusas };
  }
  if (err instanceof UnidadeIndisponivel) {
    return { error: err.message, ocupada: true };
  }
  if (err instanceof ReservaError) return { error: err.message };

  if (err instanceof EmailJaCadastrado) {
    return {
      fieldErrors: {
        email: [
          "Já existe um hóspede com este e-mail e o cadastro não pôde ser reaproveitado. Confira o endereço.",
        ],
      },
    };
  }
  if (err instanceof DocumentoNaoCifravel) return { error: err.message };

  // Só o inesperado vira log, e sem o corpo do formulário — ele carrega
  // nome, e-mail e documento do hóspede (docs/11-seguranca-lgpd.md).
  logger.error({ err: (err as Error).message }, "Falha ao criar reserva");
  return {
    error:
      "Não foi possível criar a reserva. Nada foi gravado — tente novamente.",
  };
}

export async function criarReservaAction(
  _prev: EstadoNovaReserva | undefined,
  formData: FormData,
): Promise<EstadoNovaReserva> {
  const actor = await requireActorWith("reservations.create");

  // Dois schemas sobre o MESMO FormData, de campos disjuntos: a estadia é
  // do domínio de reservas e a ficha é do de hóspedes. Duplicar aqui as
  // regras de CPF ou de telefone criaria uma segunda verdade sobre elas.
  const dados = Object.fromEntries(formData);
  const reserva = novaReservaSchema.safeParse(dados);
  const hospede = hospedeSchema.safeParse(dados);

  if (!reserva.success || !hospede.success) {
    return {
      fieldErrors: {
        ...(reserva.success ? {} : agrupar(reserva.error.issues)),
        ...(hospede.success ? {} : agrupar(hospede.error.issues)),
      },
    };
  }

  // Não decide nada sobre dinheiro: só define para onde o operador vai
  // depois que a reserva existir.
  const cobranca = formData.get("cobranca") === "link" ? "link" : "manual";

  let criada;
  try {
    criada = await criarReserva(actor, {
      unitId: reserva.data.unitId,
      checkIn: reserva.data.checkIn,
      checkOut: reserva.data.checkOut,
      adults: reserva.data.adultos,
      children: reserva.data.criancas,
      infants: reserva.data.bebes,
      hospede: hospede.data,
      // RN-003: vai só para detectar divergência. O total gravado é sempre
      // o que o servidor recalcular dentro da transação.
      totalConferidoCents: reserva.data.totalConferidoCents,
      origem: reserva.data.origem,
      guestNotes: reserva.data.guestNotes,
      internalNotes: reserva.data.internalNotes,
    });
  } catch (err) {
    return estadoDeErro(err);
  }

  let destino = `/reservas/${criada.id}?cobranca=${cobranca}`;

  if (cobranca === "link") {
    try {
      // O valor não vem daqui: `abrirCobranca` apura o saldo devedor no
      // servidor (RN-003) e devolve o link do provedor.
      const aberta = await abrirCobranca(actor, { reservationId: criada.id });
      destino = aberta.redirectUrl;
    } catch (err) {
      /**
       * A reserva EXISTE e segura as datas — a cobrança é o passo seguinte,
       * não parte da criação. Reportar isto como erro do formulário faria o
       * operador achar que precisa lançar tudo de novo, e a segunda tentativa
       * bateria na constraint de exclusão (RN-002) por conflito com a própria
       * reserva que ele acabou de criar. Então segue para o detalhe da
       * reserva, onde o aviso de cobrança explica como cobrar por fora.
       */
      logger.error(
        {
          tenantId: actor.tenantId,
          reservationId: criada.id,
          err: (err as Error).message,
        },
        "Reserva criada, mas a cobrança por link não pôde ser aberta",
      );
    }
  }

  // Fora do `try`: `redirect` sinaliza por exceção, e capturá-la aqui
  // faria um sucesso ser reportado como falha na criação.
  redirect(destino);
}
