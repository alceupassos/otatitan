/**
 * Datas de estadia (RN-007): são `DATE`, no fuso do imóvel — nunca
 * `timestamptz`. O único jeito de manter isso honesto em JavaScript, onde
 * `Date` é sempre um instante, é fixar tudo em UTC meia-noite e tratar o
 * objeto como "um dia do calendário", não como um momento.
 *
 * Misturar fuso local aqui é o que produz o clássico "a reserva mudou de
 * dia" para quem está a oeste de Greenwich — todo o Brasil.
 */

export const MS_DIA = 86_400_000;

/** `YYYY-MM-DD` → dia de calendário. Lança se o formato não bater. */
export function parseDateOnly(valor: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor.trim());
  if (!m) throw new Error(`Data inválida: "${valor}" (esperado YYYY-MM-DD).`);

  const [, ano, mes, dia] = m.map(Number) as [never, number, number, number];
  const d = new Date(Date.UTC(ano, mes - 1, dia));

  // `Date.UTC` aceita 2026-02-31 e rola para março. Comparar de volta
  // rejeita a data que não existe, em vez de gravar outro dia em silêncio.
  if (
    d.getUTCFullYear() !== ano ||
    d.getUTCMonth() !== mes - 1 ||
    d.getUTCDate() !== dia
  ) {
    throw new Error(`Data inexistente: "${valor}".`);
  }
  return d;
}

export function tryParseDateOnly(valor: string): Date | null {
  try {
    return parseDateOnly(valor);
  } catch {
    return null;
  }
}

/** Dia de calendário → `YYYY-MM-DD` (o formato aceito por `<input type=date>`). */
export function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Hoje, como dia de calendário em UTC. */
export function hojeUtc(): Date {
  const agora = new Date();
  return new Date(
    Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate()),
  );
}

export function addDias(base: Date, dias: number): Date {
  return new Date(base.getTime() + dias * MS_DIA);
}

/** Diferença em dias (= número de noites de `de` até `ate`, semiaberto). */
export function diffDias(de: Date, ate: Date): number {
  return Math.round((ate.getTime() - de.getTime()) / MS_DIA);
}

/**
 * Dias do intervalo SEMIABERTO `[inicio, fim)` — inclui `inicio`, exclui
 * `fim` (RN-001). É por isso que um check-out no dia 10 e um check-in no
 * dia 10 não se sobrepõem: same-day turnover é permitido.
 */
export function diasNoIntervalo(inicio: Date, fim: Date): Date[] {
  const dias: Date[] = [];
  for (let t = inicio.getTime(); t < fim.getTime(); t += MS_DIA) {
    dias.push(new Date(t));
  }
  return dias;
}

/** Dois intervalos semiabertos se sobrepõem? */
export function seSobrepoem(
  aInicio: Date,
  aFim: Date,
  bInicio: Date,
  bFim: Date,
): boolean {
  return aInicio < bFim && bInicio < aFim;
}

const DIAS_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"] as const;

export function diaDaSemanaCurto(d: Date): string {
  return DIAS_SEMANA[d.getUTCDay()]!;
}

export function ehFimDeSemana(d: Date): boolean {
  const dia = d.getUTCDay();
  return dia === 0 || dia === 6;
}

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
] as const;

/** "março de 2026" — para o cabeçalho do calendário. */
export function mesAnoLongo(d: Date): string {
  return `${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
}

/** "10/03/2026" — formatação pt-BR sem depender do fuso do navegador. */
export function formatarData(d: Date): string {
  const dia = String(d.getUTCDate()).padStart(2, "0");
  const mes = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dia}/${mes}/${d.getUTCFullYear()}`;
}

/** Primeiro dia do mês de `d`. */
export function inicioDoMes(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** Primeiro dia do mês seguinte (fim exclusivo do mês de `d`). */
export function inicioDoMesSeguinte(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}
