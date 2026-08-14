import type {
  PaymentIntentKind,
  ReservationStatus,
} from "@/generated/prisma/enums";

/**
 * Máquina de estados da reserva — a tabela abaixo é a ÚNICA fonte de
 * verdade sobre o que pode virar o quê.
 *
 * Espalhar `if (status === ...)` pelas actions é como um sistema de
 * reservas ganha caminhos impossíveis: cancelar uma estadia que já teve
 * check-out, confirmar uma reserva cancelada meses depois por um webhook
 * atrasado, dar check-in em algo que nunca foi pago. Aqui a resposta é uma
 * consulta a uma tabela, e o que não está na tabela não acontece.
 *
 * Módulo puro (sem I/O, sem Prisma além dos tipos): é a regra que precisa
 * de teste barato e determinista.
 */

/** Rótulos em pt-BR, na forma que cabe na frase "uma reserva ___". */
export const STATUS_LABELS: Record<ReservationStatus, string> = {
  PENDING: "pendente",
  CONFIRMED: "confirmada",
  CHECKED_IN: "com check-in feito",
  CHECKED_OUT: "com check-out feito",
  CANCELLED: "cancelada",
  NO_SHOW: "marcada como no-show",
};

/** Rótulo curto para chips e filtros de tela. */
export const STATUS_CURTO: Record<ReservationStatus, string> = {
  PENDING: "Pendente",
  CONFIRMED: "Confirmada",
  CHECKED_IN: "Hospedado",
  CHECKED_OUT: "Finalizada",
  CANCELLED: "Cancelada",
  NO_SHOW: "No-show",
};

/**
 * Transições permitidas.
 *
 * Observações que não são óbvias no diagrama:
 * - `CHECKED_IN` não cancela: o hóspede está dentro da unidade. Encerrar
 *   uma estadia em curso é check-out, não cancelamento — cancelar liberaria
 *   as datas (RN-005) de um período que está sendo ocupado agora.
 * - `NO_SHOW` sai de `CONFIRMED`, não de `PENDING`: quem nunca confirmou
 *   não faltou, apenas não fechou a reserva (esse caso é o hold expirando,
 *   RN-004, que termina em `CANCELLED`).
 * - Os quatro estados terminais não têm saída. Reserva não é apagada nem
 *   revivida; o histórico é preservado (RN-005).
 */
export const TRANSICOES: Record<ReservationStatus, readonly ReservationStatus[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["CHECKED_IN", "CANCELLED", "NO_SHOW"],
  CHECKED_IN: ["CHECKED_OUT"],
  CHECKED_OUT: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export function podeTransicionar(
  de: ReservationStatus,
  para: ReservationStatus,
): boolean {
  return TRANSICOES[de].includes(para);
}

export function proximosStatus(
  de: ReservationStatus,
): readonly ReservationStatus[] {
  return TRANSICOES[de];
}

/** Estado do qual não se sai mais. */
export function ehStatusFinal(status: ReservationStatus): boolean {
  return TRANSICOES[status].length === 0;
}

/**
 * Estados em que a reserva SEGURA a unidade — isto é, em que o
 * `AvailabilityBlock` correspondente continua bloqueante.
 *
 * `PENDING` está aqui porque o hold é real: a reserva retém a data até
 * `holdExpiresAt` (RN-004). Cancelar e no-show liberam; check-out não
 * libera (as datas já passaram, e o bloqueio é o registro histórico da
 * ocupação).
 */
export const STATUS_QUE_OCUPAM: readonly ReservationStatus[] = [
  "PENDING",
  "CONFIRMED",
  "CHECKED_IN",
  "CHECKED_OUT",
];

export function ocupaDisponibilidade(status: ReservationStatus): boolean {
  return STATUS_QUE_OCUPAM.includes(status);
}

/** Duração do hold de uma reserva `PENDING` (RN-004). */
export const MINUTOS_DE_HOLD = 30;

export function calcularHoldExpiresAt(agora: Date): Date {
  return new Date(agora.getTime() + MINUTOS_DE_HOLD * 60_000);
}

/**
 * A reserva está quitada? (UC-050, passo 5)
 *
 * Política v1: só o total pago confirma. Um sinal parcial mantém a reserva
 * `PENDING` — e isso não a coloca em risco, porque o job de expiração de
 * holds se recusa a expirar reserva com `paidCents > 0`
 * (`avaliarHold`, src/worker/jobs/expirar-holds.ts). Comparação com `>=`:
 * pagamento a maior (arredondamento do provedor, gorjeta) quita.
 */
export function quitada(reserva: {
  paidCents: number;
  totalCents: number;
}): boolean {
  return reserva.paidCents >= reserva.totalCents;
}

/** Quanto ainda falta pagar, nunca negativo. */
export function saldoDevedorCents(reserva: {
  paidCents: number;
  totalCents: number;
}): number {
  return Math.max(0, reserva.totalCents - reserva.paidCents);
}

/**
 * Intenções de pagamento que ABATEM o total da estadia — as únicas que podem
 * entrar em `Reservation.paidCents`.
 *
 * `SECURITY_DEPOSIT` (caução) e `EXTRA` ficam de fora porque não são preço da
 * estadia: a caução volta para o hóspede no fim e o extra é venda avulsa
 * (frigobar, passeio). Somá-las em `paidCents` quitava a reserva sem ninguém
 * ter pago a diária — `quitada()` dava `true`, a reserva era confirmada e a
 * cobrança do saldo passava a ser recusada como "já quitada" (RN-003/RN-006).
 *
 * O `Payment` continua registrado no extrato nos dois casos; o que muda é
 * apenas o que conta como pagamento da estadia.
 */
export const INTENCOES_QUE_PAGAM_A_ESTADIA: readonly PaymentIntentKind[] = [
  "FULL",
  "DEPOSIT",
  "BALANCE",
];

export function pagaAEstadia(intent: PaymentIntentKind): boolean {
  return INTENCOES_QUE_PAGAM_A_ESTADIA.includes(intent);
}
