import type {
  PaymentIntentKind,
  PaymentMethod,
  PaymentProviderKey,
  PaymentStatus,
  ReservationStatus,
  TaskPriority,
  TaskStatus,
  TaskType,
} from "@/generated/prisma/enums";

/**
 * Rótulos de TELA das entidades vizinhas da reserva (pagamento, tarefa).
 *
 * O que já tem rótulo no domínio não é redigitado aqui: status de reserva
 * vem de `STATUS_CURTO`/`STATUS_LABELS` (`@/lib/reservations/estados`) e
 * meio de pagamento de `MEIO_PAGAMENTO_LABELS`
 * (`@/lib/reservations/schemas`). Só entra neste arquivo o que a UI
 * precisa e o domínio ainda não nomeia.
 *
 * Importa apenas TIPOS do Prisma, de propósito: assim o módulo atravessa
 * a fronteira servidor→cliente. `@/lib/reservations/schemas` não
 * atravessa — ele arrasta `./codigo`, que é `server-only` por dentro.
 */

/** Cor do selo de status da reserva. */
export const STATUS_VARIANTE: Record<
  ReservationStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  PENDING: "outline",
  CONFIRMED: "default",
  CHECKED_IN: "default",
  CHECKED_OUT: "secondary",
  CANCELLED: "destructive",
  NO_SHOW: "destructive",
};

export const PAGAMENTO_STATUS_LABELS: Record<PaymentStatus, string> = {
  REQUIRES_ACTION: "Aguardando ação",
  PENDING: "Pendente",
  PROCESSING: "Processando",
  SUCCEEDED: "Recebido",
  FAILED: "Falhou",
  CANCELLED: "Cancelado",
  REFUNDED: "Estornado",
  PARTIALLY_REFUNDED: "Estornado em parte",
};

export const PAGAMENTO_STATUS_VARIANTE: Record<
  PaymentStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  REQUIRES_ACTION: "outline",
  PENDING: "outline",
  PROCESSING: "outline",
  SUCCEEDED: "default",
  FAILED: "destructive",
  CANCELLED: "destructive",
  REFUNDED: "secondary",
  PARTIALLY_REFUNDED: "secondary",
};

/** Natureza da cobrança — o que aquele dinheiro estava pagando. */
export const INTENCAO_LABELS: Record<PaymentIntentKind, string> = {
  DEPOSIT: "Sinal",
  BALANCE: "Saldo",
  FULL: "Valor integral",
  SECURITY_DEPOSIT: "Caução",
  EXTRA: "Extra",
};

export const PROVEDOR_LABELS: Record<PaymentProviderKey, string> = {
  STRIPE: "Stripe",
  ASAAS: "Asaas",
  MANUAL: "Baixa manual",
  MERCADOPAGO: "Mercado Pago",
  PAGARME: "Pagar.me",
};

/** Meio de pagamento — mesmo texto de `MEIO_PAGAMENTO_LABELS`, para leitura. */
export const MEIO_LABELS: Record<PaymentMethod, string> = {
  CARD: "Cartão",
  PIX: "Pix",
  BOLETO: "Boleto",
  CASH: "Dinheiro",
  BANK_TRANSFER: "Transferência",
  OTHER: "Outro",
};

export const TAREFA_TIPO_LABELS: Record<TaskType, string> = {
  CHECK_IN: "Check-in",
  CHECK_OUT: "Check-out",
  CLEANING: "Limpeza",
  INSPECTION: "Vistoria",
  MAINTENANCE: "Manutenção",
  CUSTOM: "Outra",
};

export const TAREFA_STATUS_LABELS: Record<TaskStatus, string> = {
  OPEN: "Aberta",
  IN_PROGRESS: "Em andamento",
  BLOCKED: "Bloqueada",
  DONE: "Concluída",
  CANCELLED: "Cancelada",
};

export const TAREFA_STATUS_VARIANTE: Record<
  TaskStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  OPEN: "outline",
  IN_PROGRESS: "default",
  BLOCKED: "destructive",
  DONE: "secondary",
  CANCELLED: "secondary",
};

export const TAREFA_PRIORIDADE_LABELS: Record<TaskPriority, string> = {
  LOW: "Baixa",
  NORMAL: "Normal",
  HIGH: "Alta",
  URGENT: "Urgente",
};
