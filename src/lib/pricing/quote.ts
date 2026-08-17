import { addDias, diasNoIntervalo, diffDias, toDateOnly } from "@/lib/dates";
import {
  criarRecusa,
  EstadiaInvalida,
  RECUSA,
  type CodigoRecusa,
  type ContextoRecusa,
  type Recusa,
} from "./errors";

/**
 * Motor de cotação — cálculo puro, sem I/O.
 *
 * O preço de uma reserva é sempre recalculado aqui, no servidor, a partir
 * das tarifas vigentes (RN-003): o total que vem do cliente é palpite, e
 * nunca entra na conta. Manter o cálculo puro é o que permite testá-lo
 * inteiro sem banco — as regras que decidem se uma unidade é vendável são
 * o miolo do produto e precisam de teste barato.
 *
 * O resultado é determinista: mesmas fixtures, mesma cotação, inclusive
 * na escolha do plano vencedor (todos os desempates terminam num critério
 * total, o id).
 */

/**
 * Versão do algoritmo, gravada no snapshot. Mudou a fórmula? Suba a
 * versão — é o que permite reconhecer, meses depois, que uma reserva
 * antiga foi cotada por outra regra.
 */
export const VERSAO_COTACAO = 1;

export type UnidadeCotavel = {
  id: string;
  maxGuests: number;
  minNights: number;
  maxNights: number | null;
  cleaningFeeCents: number;
  currency: string;
};

export type PlanoCotavel = {
  id: string;
  code: string;
  name: string;
  currency: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  isDefault: boolean;
  priority: number;
  minNights: number;
  maxNights: number | null;
  minAdvanceDays: number;
  maxAdvanceDays: number | null;
  includesCleaningFee: boolean;
  cancellationPolicy: string;
  validFrom: Date | null;
  validTo: Date | null;
};

export type TarifaCotavel = {
  ratePlanId: string;
  date: Date;
  priceCents: number;
  currency: string;
  minNights: number | null;
  isClosed: boolean;
  closedToArrival: boolean;
  closedToDeparture: boolean;
};

/**
 * Taxas extras do canal direto, aplicadas no servidor (RN-003 / RN-006).
 *
 * Não são diária: a diária continua saindo só de `DailyRate`. Os valores
 * vêm de configuração editável (site ao vivo / `direct-booking/config.ts`),
 * nunca de um total enviado pelo cliente. Ausente = zero, e os testes do
 * motor de diária não mudam.
 */
export type ExtrasCotacao = {
  /** Hóspedes já inclusos na diária; o restante paga extra por noite. */
  includedGuests: number;
  extraGuestCentsPerNight: number;
  /** Quantidade informada; a taxa de PET é por estadia, não por animal. */
  pets: number;
  petFeeCents: number;
  parking: boolean;
  parkingFeeCents: number;
};

export type BreakdownExtras = {
  extraGuestCount: number;
  extraGuestCents: number;
  petFeeCents: number;
  parkingFeeCents: number;
};

export function calcularExtras(
  extras: ExtrasCotacao | undefined,
  hospedes: number,
  nights: number,
): BreakdownExtras {
  if (!extras) {
    return {
      extraGuestCount: 0,
      extraGuestCents: 0,
      petFeeCents: 0,
      parkingFeeCents: 0,
    };
  }
  const extraGuestCount = Math.max(0, hospedes - extras.includedGuests);
  return {
    extraGuestCount,
    extraGuestCents: extraGuestCount * extras.extraGuestCentsPerNight * nights,
    petFeeCents: extras.pets > 0 ? extras.petFeeCents : 0,
    parkingFeeCents: extras.parking ? extras.parkingFeeCents : 0,
  };
}

export type EntradaCotacao = {
  unit: UnidadeCotavel;
  planos: PlanoCotavel[];
  /** Tarifas das noites `[checkIn, checkOut)`, de todos os planos. */
  tarifas: TarifaCotavel[];
  checkIn: Date;
  checkOut: Date;
  /** Adultos + crianças (bebês não contam contra `maxGuests`). */
  hospedes: number;
  /** Dia de hoje, para as regras de antecedência. */
  hoje: Date;
  /** Instante da cotação; injetável para o snapshot ficar determinista em teste. */
  agora?: Date;
  /**
   * Quando informado, só este plano é avaliado — o hóspede escolheu entre
   * reembolsável e não reembolsável. Sem isto, vale o vencedor de sempre.
   */
  ratePlanId?: string;
  extras?: ExtrasCotacao;
};

export type NoiteCotada = {
  /** `YYYY-MM-DD` */
  data: string;
  priceCents: number;
};

/**
 * Snapshot serializável gravado em `Reservation.quoteSnapshot` (RN-003).
 *
 * Guarda a quebra por noite, e não só o total: quando o hóspede
 * questionar a cobrança meses depois, a resposta precisa ser a conta que
 * foi feita naquele dia, não a tarifa que estiver publicada agora.
 */
export type QuoteSnapshot = {
  versao: number;
  /** ISO 8601 do instante da cotação. */
  cotadaEm: string;
  unitId: string;
  ratePlanId: string;
  ratePlanCode: string;
  currency: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  hospedes: number;
  noites: NoiteCotada[];
  minNightsEfetivo: number;
  maxNightsEfetivo: number | null;
  nightlyTotalCents: number;
  feesTotalCents: number;
  taxesTotalCents: number;
  discountsTotalCents: number;
  totalCents: number;
  cleaningFeeCents: number;
  /** A limpeza já está embutida na diária do plano? */
  cleaningFeeIncluso: boolean;
  cancellationPolicy: string;
  extras?: BreakdownExtras;
};

export type Cotacao = {
  unitId: string;
  ratePlanId: string;
  ratePlanCode: string;
  ratePlanName: string;
  currency: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  hospedes: number;
  noites: NoiteCotada[];
  nightlyTotalCents: number;
  feesTotalCents: number;
  taxesTotalCents: number;
  discountsTotalCents: number;
  totalCents: number;
  cleaningFeeCents: number;
  cleaningFeeIncluso: boolean;
  cancellationPolicy: string;
  minNightsEfetivo: number;
  maxNightsEfetivo: number | null;
  extras?: BreakdownExtras;
  snapshot: QuoteSnapshot;
};

export type ResultadoCotacao =
  | { ok: true; cotacao: Cotacao }
  | {
      ok: false;
      /** Motivo principal — o do plano mais bem colocado. */
      recusa: Recusa;
      /** Todas as recusas encontradas, já sem repetição. */
      recusas: Recusa[];
    };

/** Menor limite entre os definidos; `null` só quando ninguém definiu teto. */
function menorDefinido(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

/**
 * Ordem de disputa entre planos: maior `priority`, depois o padrão da
 * unidade, depois o código (critério total, para não depender da ordem
 * que o banco devolveu).
 */
function ordenarPlanos(a: PlanoCotavel, b: PlanoCotavel): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
  return a.code.localeCompare(b.code);
}

/** Mesma ordem, com o preço entrando como último desempate de negócio. */
function ordenarCotacoes(
  a: { plano: PlanoCotavel; cotacao: Cotacao },
  b: { plano: PlanoCotavel; cotacao: Cotacao },
): number {
  if (a.plano.priority !== b.plano.priority) return b.plano.priority - a.plano.priority;
  if (a.plano.isDefault !== b.plano.isDefault) return a.plano.isDefault ? -1 : 1;
  if (a.cotacao.totalCents !== b.cotacao.totalCents) {
    return a.cotacao.totalCents - b.cotacao.totalCents;
  }
  return a.plano.id.localeCompare(b.plano.id);
}

function dedupeRecusas(recusas: Recusa[]): Recusa[] {
  const vistas = new Set<string>();
  return recusas.filter((r) => {
    const chave = `${r.codigo}|${r.data}|${r.ratePlanId}`;
    if (vistas.has(chave)) return false;
    vistas.add(chave);
    return true;
  });
}

/**
 * Cota uma unidade para `[checkIn, checkOut)`.
 *
 * Avalia cada plano ativo isoladamente e devolve a melhor cotação; se
 * nenhum plano vender, devolve os motivos — nunca um "indisponível" sem
 * explicação.
 */
export function cotar(entrada: EntradaCotacao): ResultadoCotacao {
  const { unit, checkIn, checkOut, hospedes } = entrada;

  const nights = diffDias(checkIn, checkOut);
  if (nights <= 0) {
    throw new EstadiaInvalida(
      "A saída precisa ser depois da entrada: a estadia é o intervalo " +
        "semiaberto [check-in, check-out) e não pode ter zero noites.",
    );
  }
  if (!Number.isInteger(hospedes) || hospedes < 1) {
    throw new EstadiaInvalida("Informe ao menos um hóspede.");
  }

  if (hospedes > unit.maxGuests) {
    const recusa = criarRecusa(RECUSA.excedeHospedes, {
      limite: unit.maxGuests,
      pedido: hospedes,
    });
    return { ok: false, recusa, recusas: [recusa] };
  }

  const planos = entrada.planos
    .filter((p) => p.status === "ACTIVE")
    .filter((p) => (entrada.ratePlanId ? p.id === entrada.ratePlanId : true))
    .sort(ordenarPlanos);

  if (planos.length === 0) {
    const recusa = criarRecusa(RECUSA.semPlano);
    return { ok: false, recusa, recusas: [recusa] };
  }

  // Índice `plano → data → tarifa`, montado uma vez: a busca varre muitas
  // unidades × muitos planos × muitas noites, e um `find` por noite vira
  // trabalho quadrático à toa.
  const porPlano = new Map<string, Map<string, TarifaCotavel>>();
  for (const t of entrada.tarifas) {
    const doPlano = porPlano.get(t.ratePlanId) ?? new Map<string, TarifaCotavel>();
    doPlano.set(toDateOnly(t.date), t);
    porPlano.set(t.ratePlanId, doPlano);
  }

  const noites = diasNoIntervalo(checkIn, checkOut);
  const vencedoras: { plano: PlanoCotavel; cotacao: Cotacao }[] = [];
  const recusas: Recusa[] = [];

  for (const plano of planos) {
    const r = cotarPlano(entrada, plano, noites, porPlano.get(plano.id));
    if (r.ok) vencedoras.push({ plano, cotacao: r.cotacao });
    else recusas.push(...r.recusas);
  }

  if (vencedoras.length === 0) {
    const todas = dedupeRecusas(recusas);
    // A primeira recusa é a do plano mais bem colocado — o que o operador
    // teria vendido se desse.
    return { ok: false, recusa: todas[0]!, recusas: todas };
  }

  vencedoras.sort(ordenarCotacoes);
  return { ok: true, cotacao: vencedoras[0]!.cotacao };
}

/**
 * Cota TODOS os planos vendáveis, não só o vencedor.
 *
 * O canal direto mostra reembolsável e não reembolsável lado a lado; o
 * operador do painel continua usando `cotar()`, que escolhe um.
 */
export function cotarTodosPlanos(entrada: EntradaCotacao): {
  cotacoes: Cotacao[];
  recusas: Recusa[];
} {
  const resultado: { cotacoes: Cotacao[]; recusas: Recusa[] } = {
    cotacoes: [],
    recusas: [],
  };
  const ativos = entrada.planos.filter((p) => p.status === "ACTIVE");
  for (const plano of ativos) {
    const r = cotar({ ...entrada, ratePlanId: plano.id, planos: [plano] });
    if (r.ok) resultado.cotacoes.push(r.cotacao);
    else resultado.recusas.push(...r.recusas);
  }
  resultado.cotacoes.sort((a, b) => a.totalCents - b.totalCents);
  resultado.recusas = dedupeRecusas(resultado.recusas);
  return resultado;
}

function cotarPlano(
  entrada: EntradaCotacao,
  plano: PlanoCotavel,
  noites: Date[],
  tarifas: Map<string, TarifaCotavel> | undefined,
): { ok: true; cotacao: Cotacao } | { ok: false; recusas: Recusa[] } {
  const { unit, checkIn, checkOut, hoje } = entrada;
  const nights = noites.length;
  const ultimaNoite = addDias(checkOut, -1);
  const recusa = (codigo: CodigoRecusa, ctx: ContextoRecusa = {}): Recusa =>
    criarRecusa(codigo, { ...ctx, ratePlanId: plano.id });

  // Etapa 1 — o plano vale para estas datas?
  const janela: Recusa[] = [];
  if (plano.validFrom && plano.validFrom > checkIn) {
    janela.push(recusa(RECUSA.foraDaJanela, { data: toDateOnly(checkIn) }));
  }
  // `validTo` compara com a última NOITE, não com o check-out: o dia da
  // saída não é vendido, então um plano que vale até 15 cobre a estadia
  // que termina em 16 (RN-001).
  if (plano.validTo && plano.validTo < ultimaNoite) {
    janela.push(recusa(RECUSA.foraDaJanela, { data: toDateOnly(ultimaNoite) }));
  }

  const antecedencia = diffDias(hoje, checkIn);
  if (antecedencia < plano.minAdvanceDays) {
    janela.push(
      recusa(RECUSA.antecedencia, {
        limite: plano.minAdvanceDays,
        pedido: antecedencia,
        data: toDateOnly(checkIn),
      }),
    );
  }
  if (plano.maxAdvanceDays !== null && antecedencia > plano.maxAdvanceDays) {
    janela.push(
      recusa(RECUSA.antecedencia, {
        limite: plano.maxAdvanceDays,
        pedido: antecedencia,
        data: toDateOnly(checkIn),
      }),
    );
  }
  if (janela.length > 0) return { ok: false, recusas: janela };

  if (plano.currency !== unit.currency) {
    return {
      ok: false,
      recusas: [
        recusa(RECUSA.moedaDivergente, { moedas: [unit.currency, plano.currency] }),
      ],
    };
  }

  // Etapa 2 — cada noite precisa ter tarifa publicada e aberta (RN-011).
  const doPlano = tarifas ?? new Map<string, TarifaCotavel>();
  const problemas: Recusa[] = [];
  const cotadas: NoiteCotada[] = [];
  const usadas: TarifaCotavel[] = [];

  for (const noite of noites) {
    const data = toDateOnly(noite);
    const tarifa = doPlano.get(data);

    if (!tarifa) {
      problemas.push(recusa(RECUSA.semTarifa, { data }));
      continue;
    }
    if (tarifa.isClosed) {
      problemas.push(recusa(RECUSA.noiteFechada, { data }));
      continue;
    }
    if (tarifa.currency !== plano.currency) {
      problemas.push(
        recusa(RECUSA.moedaDivergente, {
          data,
          moedas: [plano.currency, tarifa.currency],
        }),
      );
      continue;
    }

    usadas.push(tarifa);
    cotadas.push({ data, priceCents: tarifa.priceCents });
  }
  if (problemas.length > 0) return { ok: false, recusas: problemas };

  // Etapa 3 — fechamentos de chegada e de saída.
  const fechamentos: Recusa[] = [];
  if (usadas[0]!.closedToArrival) {
    fechamentos.push(
      recusa(RECUSA.fechadoParaChegada, { data: toDateOnly(checkIn) }),
    );
  }
  // `closedToDeparture` mora na tarifa da última noite e barra a saída no
  // dia seguinte a ela — é o check-out que o hóspede precisa mudar, então
  // é essa a data reportada.
  if (usadas[usadas.length - 1]!.closedToDeparture) {
    fechamentos.push(
      recusa(RECUSA.fechadoParaSaida, { data: toDateOnly(checkOut) }),
    );
  }
  if (fechamentos.length > 0) return { ok: false, recusas: fechamentos };

  // Etapa 4 — RN-012: vale o mais restritivo entre unidade, plano e a
  // tarifa de cada noite. A tarifa diária só aperta o mínimo (não há teto
  // por noite no modelo), e guardamos a noite que apertou para a mensagem
  // dizer qual data está exigindo a estadia maior.
  let minEfetivo = Math.max(unit.minNights, plano.minNights);
  let dataDoMinimo: string | null = null;
  for (const [i, tarifa] of usadas.entries()) {
    if (tarifa.minNights !== null && tarifa.minNights > minEfetivo) {
      minEfetivo = tarifa.minNights;
      dataDoMinimo = cotadas[i]!.data;
    }
  }
  const maxEfetivo = menorDefinido(unit.maxNights, plano.maxNights);

  if (nights < minEfetivo) {
    return {
      ok: false,
      recusas: [
        recusa(RECUSA.minNoites, {
          limite: minEfetivo,
          pedido: nights,
          data: dataDoMinimo,
        }),
      ],
    };
  }
  if (maxEfetivo !== null && nights > maxEfetivo) {
    return {
      ok: false,
      recusas: [recusa(RECUSA.maxNoites, { limite: maxEfetivo, pedido: nights })],
    };
  }

  // Etapa 5 — aritmética, toda em centavos inteiros (RN-006).
  const nightlyTotalCents = cotadas.reduce((soma, n) => soma + n.priceCents, 0);
  // Quando o plano embute a limpeza, ela já está diluída na diária;
  // somá-la de novo cobraria duas vezes.
  const limpezaCents = plano.includesCleaningFee ? 0 : unit.cleaningFeeCents;
  const extras = calcularExtras(entrada.extras, entrada.hospedes, nights);
  const extrasCents =
    extras.extraGuestCents + extras.petFeeCents + extras.parkingFeeCents;
  const feesTotalCents = limpezaCents + extrasCents;
  // Impostos e descontos existem na Reservation mas ainda não têm cadastro
  // próprio (v1); ficam zerados aqui e não são inventados no total.
  const taxesTotalCents = 0;
  const discountsTotalCents = 0;
  const totalCents =
    nightlyTotalCents + feesTotalCents + taxesTotalCents - discountsTotalCents;

  const snapshot: QuoteSnapshot = {
    versao: VERSAO_COTACAO,
    cotadaEm: (entrada.agora ?? new Date()).toISOString(),
    unitId: unit.id,
    ratePlanId: plano.id,
    ratePlanCode: plano.code,
    currency: unit.currency,
    checkIn: toDateOnly(checkIn),
    checkOut: toDateOnly(checkOut),
    nights,
    hospedes: entrada.hospedes,
    noites: cotadas,
    minNightsEfetivo: minEfetivo,
    maxNightsEfetivo: maxEfetivo,
    nightlyTotalCents,
    feesTotalCents,
    taxesTotalCents,
    discountsTotalCents,
    totalCents,
    cleaningFeeCents: unit.cleaningFeeCents,
    cleaningFeeIncluso: plano.includesCleaningFee,
    cancellationPolicy: plano.cancellationPolicy,
    extras: extrasCents > 0 ? extras : undefined,
  };

  return {
    ok: true,
    cotacao: {
      unitId: unit.id,
      ratePlanId: plano.id,
      ratePlanCode: plano.code,
      ratePlanName: plano.name,
      currency: unit.currency,
      checkIn: snapshot.checkIn,
      checkOut: snapshot.checkOut,
      nights,
      hospedes: entrada.hospedes,
      noites: cotadas,
      nightlyTotalCents,
      feesTotalCents,
      taxesTotalCents,
      discountsTotalCents,
      totalCents,
      cleaningFeeCents: unit.cleaningFeeCents,
      cleaningFeeIncluso: plano.includesCleaningFee,
      cancellationPolicy: plano.cancellationPolicy,
      minNightsEfetivo: minEfetivo,
      maxNightsEfetivo: maxEfetivo,
      extras: extrasCents > 0 ? extras : undefined,
      snapshot,
    },
  };
}

/**
 * O total recalculado bate com o que o cliente mandou? (RN-003)
 *
 * Divergiu, a API responde `409 PRICE_CHANGED` com a cotação nova — o
 * total do cliente jamais vira o total gravado.
 */
export function precoConfere(cotacao: Cotacao, totalCentsDoCliente: number): boolean {
  return cotacao.totalCents === totalCentsDoCliente;
}
