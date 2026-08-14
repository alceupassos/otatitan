import { formatarData, parseDateOnly } from "@/lib/dates";

/**
 * Motivos de recusa do motor de cotação.
 *
 * Uma unidade indisponível nunca é um booleano mudo: quem atende o
 * hóspede precisa saber POR QUE não dá para vender, e em QUE data, para
 * ou corrigir a tarifa ou propor outro período. Por isso toda recusa
 * carrega código + data + texto pronto para a tela (UC-030).
 *
 * Vivem fora de `queries.ts` porque um arquivo `"use server"` só pode
 * exportar funções assíncronas — e porque `quote.ts` é puro e precisa
 * deles sem arrastar nada de servidor junto.
 */

export const RECUSA = {
  /** A unidade não tem nenhum plano de tarifa ativo. */
  semPlano: "SEM_PLANO",
  /** O plano não vale para essas datas (`validFrom`/`validTo`). */
  foraDaJanela: "FORA_DA_JANELA",
  /** Antecedência mínima/máxima do plano contra a data de hoje. */
  antecedencia: "ANTECEDENCIA",
  /** Noite sem `DailyRate` publicada — RN-011. */
  semTarifa: "SEM_TARIFA",
  /** Noite com `isClosed`. */
  noiteFechada: "NOITE_FECHADA",
  /** Noite de check-in com `closedToArrival`. */
  fechadoParaChegada: "FECHADO_PARA_CHEGADA",
  /** Última noite com `closedToDeparture` — barra a saída no check-out. */
  fechadoParaSaida: "FECHADO_PARA_SAIDA",
  /** Estadia menor que o mínimo efetivo — RN-012. */
  minNoites: "MIN_NOITES",
  /** Estadia maior que o máximo efetivo — RN-012. */
  maxNoites: "MAX_NOITES",
  /** Mais hóspedes do que a unidade comporta. */
  excedeHospedes: "EXCEDE_HOSPEDES",
  /** Unidade, plano e tarifa em moedas diferentes. */
  moedaDivergente: "MOEDA_DIVERGENTE",
} as const;

export type CodigoRecusa = (typeof RECUSA)[keyof typeof RECUSA];

export type Recusa = {
  codigo: CodigoRecusa;
  /**
   * Data (`YYYY-MM-DD`) que causou a recusa — a noite sem tarifa, a noite
   * fechada, o dia da chegada barrada. `null` quando a regra vale para a
   * estadia inteira (ex.: excesso de hóspedes).
   */
  data: string | null;
  /** Texto pronto para a UI, em pt-BR. */
  mensagem: string;
  /** Plano avaliado quando a recusa nasceu dele; `null` quando é da unidade. */
  ratePlanId: string | null;
};

export type ContextoRecusa = {
  data?: string | null;
  ratePlanId?: string | null;
  /** Limite imposto pela regra (mínimo de noites, teto de hóspedes...). */
  limite?: number;
  /** Valor solicitado que estourou o limite. */
  pedido?: number;
  /** Moedas em conflito, na ordem em que foram encontradas. */
  moedas?: string[];
};

/** "10/03/2026", ou vazio quando a recusa não tem data. */
function dataLegivel(data: string | null | undefined): string {
  return data ? formatarData(parseDateOnly(data)) : "";
}

function mensagemDe(codigo: CodigoRecusa, ctx: ContextoRecusa): string {
  const dia = dataLegivel(ctx.data);

  switch (codigo) {
    case RECUSA.semPlano:
      return (
        "Esta unidade não tem plano de tarifa ativo. Publique um plano " +
        "antes de vender as datas."
      );

    case RECUSA.foraDaJanela:
      return `O plano de tarifa não cobre ${dia}. Ajuste a vigência do plano ou escolha outro período.`;

    case RECUSA.antecedencia:
      return ctx.limite !== undefined && ctx.pedido !== undefined && ctx.pedido < ctx.limite
        ? `Este plano exige ${ctx.limite} dia(s) de antecedência e faltam ${ctx.pedido}.`
        : `A reserva está além da antecedência máxima do plano (${ctx.limite} dia(s)).`;

    // RN-011: ausência de tarifa nunca é "de graça" nem "disponível".
    case RECUSA.semTarifa:
      return `Sem tarifa publicada para a noite de ${dia}. Cadastre a diária para liberar a venda.`;

    case RECUSA.noiteFechada:
      return `A noite de ${dia} está fechada para venda.`;

    case RECUSA.fechadoParaChegada:
      return `Não é possível iniciar a estadia em ${dia}: a data está fechada para chegada.`;

    case RECUSA.fechadoParaSaida:
      return `Não é possível encerrar a estadia em ${dia}: a data está fechada para saída.`;

    case RECUSA.minNoites:
      return dia
        ? `A noite de ${dia} exige estadia mínima de ${ctx.limite} noite(s); o período pedido tem ${ctx.pedido}.`
        : `A estadia mínima é de ${ctx.limite} noite(s); o período pedido tem ${ctx.pedido}.`;

    case RECUSA.maxNoites:
      return `A estadia máxima é de ${ctx.limite} noite(s); o período pedido tem ${ctx.pedido}.`;

    case RECUSA.excedeHospedes:
      return `A unidade acomoda até ${ctx.limite} hóspede(s) e foram pedidos ${ctx.pedido}.`;

    // Converter moeda em silêncio produziria um total errado sem ninguém
    // perceber; melhor recusar e mandar corrigir o cadastro.
    case RECUSA.moedaDivergente: {
      const [a, b] = ctx.moedas ?? [];
      const onde = dia ? ` na noite de ${dia}` : "";
      return `Moedas diferentes no cadastro${onde}: ${a} e ${b}. Padronize a moeda — o sistema nunca converte valores automaticamente.`;
    }
  }
}

export function criarRecusa(
  codigo: CodigoRecusa,
  ctx: ContextoRecusa = {},
): Recusa {
  return {
    codigo,
    data: ctx.data ?? null,
    mensagem: mensagemDe(codigo, ctx),
    ratePlanId: ctx.ratePlanId ?? null,
  };
}

/**
 * Entrada que nem chega a ser cotável — zero noites, hóspede zero.
 *
 * É erro, não recusa: recusa é "o negócio não permite vender essas
 * datas"; isto é pedido malformado, que o schema deveria ter barrado
 * antes de chegar ao motor.
 */
export class EstadiaInvalida extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EstadiaInvalida";
  }
}
