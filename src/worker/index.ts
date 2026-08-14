import { Worker, type Job } from "bullmq";
import { conexaoFilas, PREFIXO_FILAS } from "@/lib/queue/connection";
import {
  agendarExpiracaoDeHolds,
  fecharFilas,
  FILA_MANUTENCAO,
  FILA_RESERVAS,
  JOB_EXPIRAR_HOLDS,
  JOB_TAREFAS_DA_RESERVA,
  type DadosExpirarHolds,
  type DadosTarefasDaReserva,
} from "@/lib/queue/filas";
import { logger } from "@/lib/logging/logger";
import { expirarHolds } from "./jobs/expirar-holds";
import { criarTarefasDaReserva } from "./jobs/tarefas-da-reserva";

/**
 * Processo de fila (`npm run worker`), separado do servidor web.
 *
 * Roda fora de qualquer requisição: não há sessão, não há tenant ativo.
 * Cada job descobre os tenants que precisa e entra em `withTenant` por
 * tenant — ver `jobs/expirar-holds.ts`.
 */

const log = logger.child({ processo: "worker" });

const workerManutencao = new Worker<DadosExpirarHolds>(
  FILA_MANUTENCAO,
  async (job: Job<DadosExpirarHolds>) => {
    if (job.name !== JOB_EXPIRAR_HOLDS) {
      log.warn({ job: job.name }, "Job desconhecido na fila de manutenção");
      return;
    }
    const resultado = await expirarHolds();
    // Silenciar a varredura vazia: um log por minuto sem nada acontecendo
    // afoga o que importa.
    if (resultado.expiradas > 0) {
      log.info(resultado, "Varredura de holds concluída");
    }
    return resultado;
  },
  {
    connection: conexaoFilas,
    prefix: PREFIXO_FILAS,
    // A varredura é global e serial por natureza; duas em paralelo só
    // disputariam as mesmas linhas.
    concurrency: 1,
  },
);

const workerReservas = new Worker<DadosTarefasDaReserva>(
  FILA_RESERVAS,
  async (job: Job<DadosTarefasDaReserva>) => {
    if (job.name !== JOB_TAREFAS_DA_RESERVA) {
      log.warn({ job: job.name }, "Job desconhecido na fila de reservas");
      return;
    }
    const { tenantId, reservationId } = job.data;
    return criarTarefasDaReserva(tenantId, reservationId);
  },
  { connection: conexaoFilas, prefix: PREFIXO_FILAS, concurrency: 5 },
);

const workers = [workerManutencao, workerReservas];

for (const worker of workers) {
  // O BullMQ já isola a falha do processador e reagenda pelo `attempts`.
  // Aqui só registramos: derrubar o processo por causa de um job faria
  // todos os outros pararem junto.
  worker.on("failed", (job, err) => {
    log.error(
      { fila: worker.name, job: job?.name, jobId: job?.id, err: err.message },
      "Job falhou",
    );
  });

  worker.on("error", (err) => {
    log.error({ fila: worker.name, err: err.message }, "Erro no worker");
  });
}

let encerrando = false;

/**
 * Encerramento gracioso: para de puxar jobs novos e espera os que já estão
 * rodando. Sem isso, um deploy no meio de uma varredura deixaria a reserva
 * marcada como cancelada com o bloqueio ainda ocupado — a transação
 * protege o banco, mas o job ficaria travado até o lock expirar.
 */
async function encerrar(sinal: string) {
  if (encerrando) return;
  encerrando = true;
  log.info({ sinal }, "Encerrando worker");

  await Promise.allSettled(workers.map((w) => w.close()));
  await fecharFilas();

  log.info("Worker encerrado");
  process.exit(0);
}

process.on("SIGTERM", () => void encerrar("SIGTERM"));
process.on("SIGINT", () => void encerrar("SIGINT"));

process.on("unhandledRejection", (motivo) => {
  log.error({ err: String(motivo) }, "Promise rejeitada sem tratamento");
});

process.on("uncaughtException", (err) => {
  log.fatal({ err: err.message, stack: err.stack }, "Exceção não capturada");
  void encerrar("uncaughtException");
});

async function iniciar() {
  await agendarExpiracaoDeHolds();
  log.info(
    { filas: workers.map((w) => w.name) },
    "Worker pronto",
  );
}

iniciar().catch((err: Error) => {
  log.fatal({ err: err.message }, "Falha ao iniciar o worker");
  process.exit(1);
});
