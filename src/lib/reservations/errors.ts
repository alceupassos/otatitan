import { Prisma } from "@/generated/prisma/client";
import type { ReservationStatus } from "@/generated/prisma/enums";
import { PG_EXCLUSION_VIOLATION } from "@/lib/availability/errors";
import { ehUniqueViolada, UNIQUE_CODIGO_DE_RESERVA } from "@/lib/db/errors";
import type { Recusa } from "@/lib/pricing/errors";
import type { Cotacao } from "@/lib/pricing/quote";
import { STATUS_LABELS } from "./estados";

/**
 * Erros do domínio de reservas.
 *
 * Cada recusa é um tipo com código, mensagem em pt-BR pronta para a tela e
 * o dado que explica a recusa (a cotação nova, o motivo da indisponibilidade,
 * a transição tentada). Um `boolean` mudo obrigaria a UI a inventar o texto
 * e a API a inventar o status HTTP — e é assim que "não foi possível criar a
 * reserva" vira o único diagnóstico disponível às 22h de uma sexta-feira.
 */

export const ERRO_RESERVA = {
  unidadeIndisponivel: "UNIDADE_INDISPONIVEL",
  unidadeNaoVendavel: "UNIDADE_NAO_VENDAVEL",
  unidadeNaoEncontrada: "UNIDADE_NAO_ENCONTRADA",
  precoMudou: "PRECO_MUDOU",
  naoEncontrada: "RESERVA_NAO_ENCONTRADA",
  transicaoInvalida: "TRANSICAO_INVALIDA",
  pagamentoInvalido: "PAGAMENTO_INVALIDO",
  codigoNaoGerado: "CODIGO_NAO_GERADO",
} as const;

export type CodigoErroReserva =
  (typeof ERRO_RESERVA)[keyof typeof ERRO_RESERVA];

export class ReservaError extends Error {
  readonly codigo: CodigoErroReserva;
  /** Status HTTP correspondente, para route handlers não reinventarem o mapa. */
  readonly httpStatus: number;

  constructor(codigo: CodigoErroReserva, message: string, httpStatus = 409) {
    super(message);
    this.name = new.target.name;
    this.codigo = codigo;
    this.httpStatus = httpStatus;
  }
}

/**
 * As datas foram tomadas por outra ocupação (RN-002 / `409 UNIT_UNAVAILABLE`).
 *
 * Quem produz este erro é o Postgres, pela constraint de exclusão — não uma
 * checagem prévia da aplicação, que sempre teria uma janela entre o SELECT e
 * o INSERT.
 */
export class UnidadeIndisponivel extends ReservaError {
  constructor() {
    super(
      ERRO_RESERVA.unidadeIndisponivel,
      "Estas datas acabaram de ser ocupadas nesta unidade. Uma saída e uma " +
        "entrada no mesmo dia não são conflito — confira o calendário e " +
        "tente outro período ou outra unidade.",
    );
  }
}

/**
 * A unidade está livre, mas não é vendável para o período: falta tarifa
 * publicada, a noite está fechada, a estadia é curta demais (RN-011,
 * RN-012). O motivo vem tipado do motor de cotação.
 */
export class UnidadeNaoVendavel extends ReservaError {
  readonly recusa: Recusa;
  readonly recusas: Recusa[];

  constructor(recusa: Recusa, recusas: Recusa[] = [recusa]) {
    super(ERRO_RESERVA.unidadeNaoVendavel, recusa.mensagem, 422);
    this.recusa = recusa;
    this.recusas = recusas;
  }
}

/**
 * Unidade inexistente OU fora do escopo do ator — de propósito o mesmo
 * erro, para não confirmar a existência de um id de outro tenant
 * (docs/12-plano-testes.md).
 */
export class UnidadeNaoEncontrada extends ReservaError {
  constructor() {
    super(
      ERRO_RESERVA.unidadeNaoEncontrada,
      "Unidade não encontrada.",
      404,
    );
  }
}

/**
 * RN-003 / `409 PRICE_CHANGED`.
 *
 * Carrega a cotação NOVA: a tela não deve mandar o usuário "tentar de
 * novo" às cegas, e sim mostrar o preço recalculado para ele confirmar.
 */
export class PrecoMudou extends ReservaError {
  readonly cotacao: Cotacao;
  readonly totalRecebidoCents: number;

  constructor(cotacao: Cotacao, totalRecebidoCents: number) {
    super(
      ERRO_RESERVA.precoMudou,
      "O valor da reserva mudou desde a última consulta. Confira o novo " +
        "total antes de confirmar.",
    );
    this.cotacao = cotacao;
    this.totalRecebidoCents = totalRecebidoCents;
  }
}

export class ReservaNaoEncontrada extends ReservaError {
  constructor() {
    super(ERRO_RESERVA.naoEncontrada, "Reserva não encontrada.", 404);
  }
}

/**
 * A máquina de estados recusou (ver `estados.ts`). A mensagem nomeia a
 * ação e o estado atual porque é isso que o operador precisa entender:
 * "não é possível cancelar uma reserva com check-out feito".
 */
export class TransicaoInvalida extends ReservaError {
  readonly de: ReservationStatus;
  readonly para: ReservationStatus;

  constructor(de: ReservationStatus, para: ReservationStatus, acao?: string) {
    super(
      ERRO_RESERVA.transicaoInvalida,
      acao
        ? `Não é possível ${acao} uma reserva ${STATUS_LABELS[de]}.`
        : `Uma reserva ${STATUS_LABELS[de]} não pode passar para ` +
          `"${STATUS_LABELS[para]}".`,
    );
    this.de = de;
    this.para = para;
  }
}

/** Valor, meio ou momento do pagamento manual que a reserva não aceita. */
export class PagamentoInvalido extends ReservaError {
  constructor(message: string) {
    super(ERRO_RESERVA.pagamentoInvalido, message, 422);
  }
}

/** Não saiu código livre em N tentativas — ver `codigo.ts`. */
export class CodigoNaoGerado extends ReservaError {
  constructor(tentativas: number) {
    super(
      ERRO_RESERVA.codigoNaoGerado,
      `Não foi possível gerar um código de reserva único em ${tentativas} ` +
        "tentativas. Tente novamente.",
      500,
    );
  }
}

// ── Tradução de erros do banco ────────────────────────────────────────────

/**
 * A constraint de exclusão GiST recusou o bloqueio: as datas já estão
 * ocupadas (RN-002).
 *
 * Três formas de reconhecer, porque o mesmo erro chega diferente conforme
 * o caminho: `meta.code` quando o Prisma embrulha um raw query (P2010), a
 * mensagem crua quando ele não embrulha, e o nome da constraint. Mesma
 * lógica de `src/lib/availability/actions.ts` — ver pendência sobre
 * extrair isto para `src/lib/db/errors.ts`.
 *
 * P2002 NÃO entra aqui: unicidade violada é outra coisa (código de reserva
 * repetido, bloqueio duplicado da mesma reserva), e traduzir tudo para
 * "datas ocupadas" esconderia um bug atrás de uma mensagem plausível.
 */
export function ehConflitoDeOcupacao(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const meta = err.meta as { code?: string } | undefined;
    if (meta?.code === PG_EXCLUSION_VIOLATION) return true;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes(PG_EXCLUSION_VIOLATION) ||
    msg.includes("availability_block_no_overlap")
  );
}

/**
 * Colisão da unique `(tenantId, code)`.
 *
 * É a única violação de unicidade que vale a pena retentar: o código é
 * sorteado, então tentar de novo resolve. Qualquer outro P2002 é defeito e
 * precisa subir.
 *
 * O reconhecimento é delegado a `ehUniqueViolada` porque olhar só
 * `meta.target` NÃO funciona com o driver adapter que este projeto usa — ver
 * a nota longa em src/lib/db/errors.ts. Enquanto olhava, este detector
 * devolvia `false` para toda colisão real e a retentativa de
 * `criarReserva` era código morto.
 */
export function ehColisaoDeCodigo(err: unknown): boolean {
  return ehUniqueViolada(err, UNIQUE_CODIGO_DE_RESERVA);
}
