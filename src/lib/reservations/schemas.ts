import { z } from "zod";
import { diffDias, tryParseDateOnly } from "@/lib/dates";
import { tryParseMoneyToCents } from "@/lib/money";
import { MAX_NOITES_COTACAO } from "@/lib/pricing/schemas";
import { normalizarCodigo } from "./codigo";

/**
 * Validação da entrada de reservas (UC-040).
 *
 * A ficha do hóspede NÃO está aqui: ela é validada por `hospedeSchema`
 * (`@/lib/guests/schemas`) sobre o MESMO `FormData`. Os dois schemas têm
 * campos disjuntos e Zod ignora chaves desconhecidas, então
 * `novaReservaSchema.safeParse(dados)` e `hospedeSchema.safeParse(dados)`
 * convivem no mesmo formulário — duplicar as regras de nome, CPF e
 * telefone aqui criaria duas verdades sobre a mesma ficha.
 *
 * As datas chegam como entrada e saída — intervalo semiaberto
 * `[checkIn, checkOut)`, RN-001 — porque é assim que o hóspede pensa a
 * estadia: "chego dia 10, saio dia 13" são três noites.
 */

/** Teto defensivo do formulário; o limite real é `Unit.maxGuests`. */
const MAX_HOSPEDES = 50;

export const ORIGENS_RESERVA = ["DIRECT", "MANUAL", "WEBSITE", "CHANNEL"] as const;

export const ORIGEM_LABELS: Record<(typeof ORIGENS_RESERVA)[number], string> = {
  DIRECT: "Direta",
  MANUAL: "Lançada pelo operador",
  WEBSITE: "Site",
  CHANNEL: "Canal de distribuição",
};

export const STATUS_RESERVA = [
  "PENDING",
  "CONFIRMED",
  "CHECKED_IN",
  "CHECKED_OUT",
  "CANCELLED",
  "NO_SHOW",
] as const;

export const MEIOS_PAGAMENTO_MANUAL = [
  "CASH",
  "PIX",
  "BANK_TRANSFER",
  "CARD",
  "BOLETO",
  "OTHER",
] as const;

export const MEIO_PAGAMENTO_LABELS: Record<
  (typeof MEIOS_PAGAMENTO_MANUAL)[number],
  string
> = {
  CASH: "Dinheiro",
  PIX: "Pix",
  BANK_TRANSFER: "Transferência",
  CARD: "Maquininha",
  BOLETO: "Boleto",
  OTHER: "Outro",
};

/** Naturezas de cobrança que o operador lança na mão. */
export const INTENCOES_PAGAMENTO = ["DEPOSIT", "BALANCE", "FULL"] as const;

const dataSchema = z.string().transform((v, ctx) => {
  const d = tryParseDateOnly(v);
  if (!d) {
    ctx.addIssue({ code: "custom", message: "Informe uma data válida." });
    return z.NEVER;
  }
  return d;
});

const contagem = (opts: { min: number; max: number; rotulo: string }) =>
  z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === "") return opts.min;
      const n = Number(v);
      if (!Number.isInteger(n) || n < opts.min || n > opts.max) {
        ctx.addIssue({
          code: "custom",
          message: `${opts.rotulo}: informe um número entre ${opts.min} e ${opts.max}.`,
        });
        return z.NEVER;
      }
      return n;
    });

const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: `Máximo de ${max} caracteres.` })
    .optional()
    .transform((v) => (v === undefined || v === "" ? null : v));

/**
 * Total que o cliente tinha na tela, em CENTAVOS inteiros (RN-003).
 *
 * Vem em centavos, e não formatado, porque o valor é ecoado de volta de
 * uma cotação nossa — reparsear "R$ 1.234,56" só acrescentaria uma chance
 * de perder um centavo no caminho. Vazio significa "não vi preço nenhum"
 * (reserva lançada pelo operador), e aí não há o que conferir.
 */
const totalConferidoSchema = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (v === undefined || v === "") return null;
    const n = Number(v);
    if (!Number.isSafeInteger(n) || n < 0) {
      ctx.addIssue({
        code: "custom",
        message: "Total inválido — recarregue a cotação.",
      });
      return z.NEVER;
    }
    return n;
  });

const MSG_SAIDA = "A saída precisa ser pelo menos um dia depois da entrada.";
const MSG_TETO = `Uma reserva cobre no máximo ${MAX_NOITES_COTACAO} noites.`;

export const novaReservaSchema = z
  .object({
    unitId: z.uuid({ error: "Selecione a unidade." }),
    checkIn: dataSchema,
    checkOut: dataSchema,
    adultos: contagem({ min: 1, max: MAX_HOSPEDES, rotulo: "Adultos" }),
    criancas: contagem({ min: 0, max: MAX_HOSPEDES, rotulo: "Crianças" }),
    bebes: contagem({ min: 0, max: MAX_HOSPEDES, rotulo: "Bebês" }),
    totalConferidoCents: totalConferidoSchema,
    origem: z.enum(ORIGENS_RESERVA).optional(),
    guestNotes: textoOpcional(2000),
    internalNotes: textoOpcional(2000),
  })
  .refine((r) => diffDias(r.checkIn, r.checkOut) >= 1, {
    error: MSG_SAIDA,
    path: ["checkOut"],
  })
  .refine((r) => diffDias(r.checkIn, r.checkOut) <= MAX_NOITES_COTACAO, {
    error: MSG_TETO,
    path: ["checkOut"],
  })
  .transform((r) => ({
    ...r,
    origem: r.origem ?? ("DIRECT" as const),
    // Bebês não ocupam vaga: a lotação da unidade conta adultos e crianças
    // (mesma regra do motor de cotação — `cotacaoSchema`).
    hospedes: r.adultos + r.criancas,
  }));

export type NovaReservaInput = z.infer<typeof novaReservaSchema>;

/**
 * Cancelamento (RN-005). O motivo é obrigatório: é ele que explica, seis
 * meses depois, por que a data foi devolvida ao calendário.
 */
export const cancelamentoSchema = z.object({
  motivo: z
    .string()
    .trim()
    .min(3, { error: "Descreva o motivo do cancelamento." })
    .max(300, { error: "Máximo de 300 caracteres." }),
});

export type CancelamentoInput = z.infer<typeof cancelamentoSchema>;

/** Baixa manual de pagamento (dinheiro, pix, transferência). */
export const pagamentoManualSchema = z.object({
  valor: z.string().transform((v, ctx) => {
    const cents = tryParseMoneyToCents(v ?? "");
    if (cents === null || cents <= 0) {
      ctx.addIssue({
        code: "custom",
        message: "Informe um valor maior que zero, ex.: 1.250,00.",
      });
      return z.NEVER;
    }
    return cents;
  }),
  meio: z.enum(MEIOS_PAGAMENTO_MANUAL),
  intencao: z
    .enum(INTENCOES_PAGAMENTO)
    .optional()
    .transform((v) => v ?? ("BALANCE" as const)),
  descricao: textoOpcional(200),
  /**
   * Token da abertura do diálogo, para o duplo clique virar recusa em vez de
   * dois pagamentos. Passa por validação como qualquer campo: é texto vindo
   * de um `<input type="hidden">`, e o servidor ainda o prefixa antes de
   * gravar (`chaveDaBaixaManual`) — a chave final nunca é a do cliente.
   */
  idempotencyKey: z
    .string()
    .trim()
    .max(80, { error: "Token de idempotência longo demais." })
    .optional()
    .transform((v) => (v === undefined || v === "" ? undefined : v)),
  /** Data em que o dinheiro entrou; vazio = agora. */
  recebidoEm: z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === "") return null;
      const d = tryParseDateOnly(v);
      if (!d) {
        ctx.addIssue({ code: "custom", message: "Informe uma data válida." });
        return z.NEVER;
      }
      return d;
    }),
});

export type PagamentoManualInput = z.infer<typeof pagamentoManualSchema>;

/** Página padrão da listagem — o suficiente para uma tela sem rolagem infinita. */
export const POR_PAGINA_PADRAO = 20;
export const POR_PAGINA_MAXIMO = 100;

/**
 * Filtros da listagem, lidos da querystring.
 *
 * Tudo opcional e tolerante: um filtro inválido na URL (link antigo,
 * usuário editando a mão) não pode derrubar a tela de reservas — cai no
 * padrão e mostra a lista.
 */
export const filtroReservasSchema = z.object({
  status: z
    .string()
    .trim()
    .optional()
    .transform((v) => {
      if (!v) return [];
      const pedidos = v.toUpperCase().split(",");
      return STATUS_RESERVA.filter((s) => pedidos.includes(s));
    }),
  de: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? tryParseDateOnly(v) : null)),
  ate: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? tryParseDateOnly(v) : null)),
  propertyId: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v && z.uuid().safeParse(v).success ? v : null)),
  unitId: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v && z.uuid().safeParse(v).success ? v : null)),
  busca: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((v) => (v === undefined || v === "" ? null : v)),
  pagina: z
    .string()
    .trim()
    .optional()
    .transform((v) => {
      const n = Number(v ?? "");
      return Number.isInteger(n) && n >= 1 ? n : 1;
    }),
  porPagina: z
    .string()
    .trim()
    .optional()
    .transform((v) => {
      const n = Number(v ?? "");
      if (!Number.isInteger(n) || n < 1) return POR_PAGINA_PADRAO;
      return Math.min(n, POR_PAGINA_MAXIMO);
    }),
  ordem: z
    .enum(["recentes", "chegada"])
    .optional()
    .transform((v) => v ?? ("recentes" as const)),
});

export type FiltroReservasInput = z.infer<typeof filtroReservasSchema>;

/**
 * O termo de busca serve a duas perguntas ("qual o código?" e "qual o
 * nome?") e a normalização de cada uma é diferente. Resolver isso aqui
 * evita que a query em `queries.ts` precise adivinhar.
 */
export function interpretarBusca(termo: string | null): {
  codigo: string | null;
  palavras: string[];
} {
  if (!termo) return { codigo: null, palavras: [] };

  const codigo = normalizarCodigo(termo);
  return {
    codigo: codigo.length >= 3 ? codigo : null,
    palavras: termo.split(/\s+/).filter((p) => p.length >= 2),
  };
}
