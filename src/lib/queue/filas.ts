import { Queue } from "bullmq";
import { logger } from "@/lib/logging/logger";
import { conexaoFilas, PREFIXO_FILAS, RETENCAO_PADRAO } from "./connection";

/**
 * Filas e contratos dos jobs.
 *
 * Este módulo é importado tanto pelo app (para enfileirar) quanto pelo
 * worker (para processar), então ele define os nomes e os tipos, e nada
 * mais — a lógica dos jobs mora em `src/worker/jobs/`.
 */

/** Rotinas de plataforma, sem gatilho de usuário (jobs repetíveis). */
export const FILA_MANUTENCAO = "manutencao";

/** Efeitos colaterais disparados pelo ciclo de vida de uma reserva. */
export const FILA_RESERVAS = "reservas";

export const JOB_EXPIRAR_HOLDS = "expirar-holds";
export const JOB_TAREFAS_DA_RESERVA = "tarefas-da-reserva";

/** O job varre todos os tenants; não carrega payload (RN-004). */
export type DadosExpirarHolds = Record<string, never>;

export type DadosTarefasDaReserva = {
  tenantId: string;
  reservationId: string;
};

/** Intervalo da varredura de holds. O hold dura 30 min; 1 min de granularidade
 *  deixa a liberação praticamente imediata sem martelar o banco. */
export const INTERVALO_EXPIRAR_HOLDS_MS = 60_000;

// Instanciação preguiçosa: importar este módulo (num teste, ou no server do
// Next durante o build) não pode abrir socket com o Redis.
let filaManutencao: Queue<DadosExpirarHolds> | null = null;
let filaReservas: Queue<DadosTarefasDaReserva> | null = null;

export function getFilaManutencao(): Queue<DadosExpirarHolds> {
  filaManutencao ??= new Queue<DadosExpirarHolds>(FILA_MANUTENCAO, {
    connection: conexaoFilas,
    prefix: PREFIXO_FILAS,
    defaultJobOptions: { ...RETENCAO_PADRAO, attempts: 3 },
  });
  return filaManutencao;
}

export function getFilaReservas(): Queue<DadosTarefasDaReserva> {
  filaReservas ??= new Queue<DadosTarefasDaReserva>(FILA_RESERVAS, {
    connection: conexaoFilas,
    prefix: PREFIXO_FILAS,
    defaultJobOptions: {
      ...RETENCAO_PADRAO,
      attempts: 5,
      backoff: { type: "exponential", delay: 2_000 },
    },
  });
  return filaReservas;
}

/**
 * Registra a varredura de holds como job repetível.
 *
 * `upsertJobScheduler` é idempotente pelo id: reiniciar o worker (ou subir
 * duas réplicas) não cria dois agendamentos.
 */
export async function agendarExpiracaoDeHolds(): Promise<void> {
  await getFilaManutencao().upsertJobScheduler(
    JOB_EXPIRAR_HOLDS,
    { every: INTERVALO_EXPIRAR_HOLDS_MS },
    { name: JOB_EXPIRAR_HOLDS },
  );
}

/**
 * Enfileira a criação das tarefas operacionais de uma reserva confirmada
 * (RN-008). Chamada pelo módulo de reservas depois do commit da
 * confirmação — nunca dentro da transação, para não enfileirar trabalho
 * de algo que ainda pode dar rollback.
 *
 * Falha de Redis não propaga: uma reserva já paga e confirmada não pode
 * ser desfeita porque a fila caiu. O `jobId` determinístico evita
 * duplicata na fila, e a unique `(tenantId, dedupeKey)` garante que nem
 * uma reexecução cria tarefa em dobro — o custo de perder o enfileiramento
 * é a tarefa não nascer, não nascer duas vezes.
 */
export async function enfileirarTarefasDaReserva(
  dados: DadosTarefasDaReserva,
): Promise<boolean> {
  try {
    await getFilaReservas().add(JOB_TAREFAS_DA_RESERVA, dados, {
      jobId: `${JOB_TAREFAS_DA_RESERVA}:${dados.tenantId}:${dados.reservationId}`,
    });
    return true;
  } catch (err) {
    logger.error(
      { ...dados, err: (err as Error).message },
      "Falha ao enfileirar tarefas da reserva",
    );
    return false;
  }
}

/** Fecha as filas abertas neste processo (encerramento gracioso). */
export async function fecharFilas(): Promise<void> {
  const abertas = [filaManutencao, filaReservas];
  filaManutencao = null;
  filaReservas = null;
  await Promise.allSettled(abertas.map((f) => f?.close()));
}
