/**
 * Erros do calendário. Separados das actions porque um arquivo
 * `"use server"` só pode exportar funções assíncronas.
 */

/** Código do Postgres para violação de constraint de exclusão. */
export const PG_EXCLUSION_VIOLATION = "23P01";

export const ERRO_CALENDARIO = {
  conflito: "conflito_ocupacao",
  naoEncontrado: "nao_encontrado",
  ehReserva: "bloqueio_de_reserva",
  falha: "falha",
} as const;

export const ERRO_CALENDARIO_MENSAGENS: Record<string, string> = {
  [ERRO_CALENDARIO.conflito]:
    "Essas datas já estão ocupadas nesta unidade. Confira o calendário — " +
    "lembre que uma saída e uma entrada no mesmo dia não são conflito.",
  [ERRO_CALENDARIO.naoEncontrado]: "Unidade ou bloqueio não encontrado.",
  [ERRO_CALENDARIO.ehReserva]:
    "Este período está ocupado por uma reserva. Cancele a reserva para " +
    "liberar as datas — remover só o bloqueio deixaria a reserva sem lugar.",
  [ERRO_CALENDARIO.falha]: "Não foi possível concluir a operação.",
};
