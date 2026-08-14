import { formatarData, parseDateOnly } from "@/lib/dates";

/**
 * Formatação de apoio das telas de reserva.
 *
 * Duas naturezas de data convivem aqui e não podem ser confundidas
 * (RN-007): a estadia é DIA DE CALENDÁRIO (`YYYY-MM-DD`, sem fuso) e os
 * carimbos de auditoria (criada em, pago em) são INSTANTES. Formatar um
 * dia de calendário com fuso é o que faz a reserva "mudar de dia" para
 * quem está a oeste de Greenwich.
 */

/** Dia de calendário `YYYY-MM-DD` → "10/03/2026". */
export function formatarDia(iso: string): string {
  return formatarData(parseDateOnly(iso));
}

/**
 * Instante → "10/03/2026 14:32".
 *
 * Use apenas em Server Component: sai no fuso do servidor, e renderizar
 * o mesmo texto no cliente daria divergência de hidratação.
 */
export function formatarInstante(d: Date): string {
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/** "12:05" a partir de segundos — o formato do relógio de um hold. */
export function formatarContagem(segundos: number): string {
  const seguros = Math.max(0, Math.floor(segundos));
  const minutos = Math.floor(seguros / 60);
  const resto = seguros % 60;
  return `${String(minutos).padStart(2, "0")}:${String(resto).padStart(2, "0")}`;
}
