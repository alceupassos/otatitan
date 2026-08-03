import { z } from "zod";
import { diffDias, tryParseDateOnly } from "@/lib/dates";
import { tryParseMoneyToCents } from "@/lib/money";

/**
 * Validação de planos de tarifa (UC-020) e tarifas diárias (UC-021).
 */

export const POLITICAS_CANCELAMENTO = [
  "FLEXIBLE",
  "MODERATE",
  "STRICT",
  "NON_REFUNDABLE",
] as const;

export const POLITICA_LABELS: Record<
  (typeof POLITICAS_CANCELAMENTO)[number],
  string
> = {
  FLEXIBLE: "Flexível",
  MODERATE: "Moderada",
  STRICT: "Rigorosa",
  NON_REFUNDABLE: "Não reembolsável",
};

export const POLITICA_DESCRICOES: Record<
  (typeof POLITICAS_CANCELAMENTO)[number],
  string
> = {
  FLEXIBLE: "Reembolso integral até 24h antes do check-in.",
  MODERATE: "Reembolso integral até 5 dias antes do check-in.",
  STRICT: "Reembolso de 50% até 7 dias antes do check-in.",
  NON_REFUNDABLE: "Sem reembolso após a confirmação.",
};

export const STATUS_PLANO = ["DRAFT", "ACTIVE", "ARCHIVED"] as const;

export const STATUS_PLANO_LABELS: Record<(typeof STATUS_PLANO)[number], string> = {
  DRAFT: "Rascunho",
  ACTIVE: "Ativo",
  ARCHIVED: "Arquivado",
};

/** Teto por chamada de edição em lote (UC-021). */
export const MAX_DIAS_LOTE = 730;

const inteiro = (opts: { min: number; max: number; rotulo: string }) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      const n = Number(v);
      if (v === "" || !Number.isInteger(n)) {
        ctx.addIssue({
          code: "custom",
          message: `${opts.rotulo}: informe um número inteiro.`,
        });
        return z.NEVER;
      }
      if (n < opts.min || n > opts.max) {
        ctx.addIssue({
          code: "custom",
          message: `${opts.rotulo}: use um valor entre ${opts.min} e ${opts.max}.`,
        });
        return z.NEVER;
      }
      return n;
    });

const inteiroOpcional = (opts: { min: number; max: number; rotulo: string }) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === "") return null;
      const n = Number(v);
      if (!Number.isInteger(n) || n < opts.min || n > opts.max) {
        ctx.addIssue({ code: "custom", message: `${opts.rotulo}: valor inválido.` });
        return z.NEVER;
      }
      return n;
    })
    .nullable();

const dataSchema = z.string().transform((v, ctx) => {
  const d = tryParseDateOnly(v);
  if (!d) {
    ctx.addIssue({ code: "custom", message: "Informe uma data válida." });
    return z.NEVER;
  }
  return d;
});

export const ratePlanSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .min(2, { error: "Informe um código." })
      .max(24, { error: "Máximo de 24 caracteres." })
      .regex(/^[A-Z0-9_-]+$/, {
        error: "Use apenas letras, números, hífen e sublinhado.",
      }),
    name: z
      .string()
      .trim()
      .min(2, { error: "Informe o nome do plano." })
      .max(80, { error: "Máximo de 80 caracteres." }),
    status: z.enum(["DRAFT", "ACTIVE"]),
    cancellationPolicy: z.enum(POLITICAS_CANCELAMENTO),
    minNights: inteiro({ min: 1, max: 365, rotulo: "Estadia mínima" }),
    maxNights: inteiroOpcional({ min: 1, max: 3650, rotulo: "Estadia máxima" }),
    minAdvanceDays: inteiro({ min: 0, max: 365, rotulo: "Antecedência mínima" }),
    maxAdvanceDays: inteiroOpcional({
      min: 0,
      max: 3650,
      rotulo: "Antecedência máxima",
    }),
    includesCleaningFee: z
      .string()
      .optional()
      // Checkbox só aparece no FormData quando marcado.
      .transform((v) => v === "on" || v === "true"),
    /**
     * Torna este o plano padrão da unidade. Só um pode ser padrão-e-ativo
     * ao mesmo tempo (índice parcial `rate_plan_one_default_per_unit`), então
     * marcar aqui desmarca o anterior — ver actions.
     */
    isDefault: z
      .string()
      .optional()
      .transform((v) => v === "on" || v === "true"),
  })
  .refine((p) => p.maxNights === null || p.maxNights >= p.minNights, {
    error: "A estadia máxima não pode ser menor que a mínima.",
    path: ["maxNights"],
  })
  .refine(
    (p) => p.maxAdvanceDays === null || p.maxAdvanceDays >= p.minAdvanceDays,
    {
      error: "A antecedência máxima não pode ser menor que a mínima.",
      path: ["maxAdvanceDays"],
    },
  );

export type RatePlanInput = z.infer<typeof ratePlanSchema>;

/**
 * Edição de tarifas em lote (UC-021).
 *
 * O usuário informa um intervalo INCLUSIVO de datas ("de 10 a 20 de
 * março") — diferente de estadia, aqui cada data é um dia tarifado, não
 * uma noite entre duas datas. Por isso não há conversão para semiaberto.
 */
export const dailyRateBatchSchema = z
  .object({
    ratePlanId: z.uuid({ error: "Selecione o plano de tarifa." }),
    de: dataSchema,
    ate: dataSchema,
    priceCents: z
      .string()
      .trim()
      .transform((v, ctx) => {
        const cents = tryParseMoneyToCents(v);
        if (cents === null) {
          ctx.addIssue({ code: "custom", message: "Valor monetário inválido." });
          return z.NEVER;
        }
        // A CHECK do banco exige priceCents > 0: diária zero significaria
        // "de graça", e uma noite sem preço deve ser indisponível (RN-011),
        // não gratuita.
        if (cents <= 0) {
          ctx.addIssue({
            code: "custom",
            message: "A diária precisa ser maior que zero.",
          });
          return z.NEVER;
        }
        return cents;
      }),
    minNights: inteiroOpcional({ min: 1, max: 365, rotulo: "Estadia mínima" }),
    /** Fecha as datas para venda sem apagar o preço. */
    isClosed: z
      .string()
      .optional()
      .transform((v) => v === "on" || v === "true"),
    closedToArrival: z
      .string()
      .optional()
      .transform((v) => v === "on" || v === "true"),
    closedToDeparture: z
      .string()
      .optional()
      .transform((v) => v === "on" || v === "true"),
    /** Só os dias da semana marcados recebem a tarifa (vazio = todos). */
    diasSemana: z.array(z.string()).default([]),
  })
  .refine((r) => r.ate >= r.de, {
    error: "A data final não pode ser anterior à inicial.",
    path: ["ate"],
  })
  .refine((r) => diffDias(r.de, r.ate) + 1 <= MAX_DIAS_LOTE, {
    error: `Uma edição cobre no máximo ${MAX_DIAS_LOTE} dias.`,
    path: ["ate"],
  })
  .transform((r) => ({
    ...r,
    // Índices de dia da semana (0=domingo), validados. Fora da faixa é
    // descartado em vez de derrubar a operação.
    diasSemana: r.diasSemana
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6),
  }));

export type DailyRateBatchInput = z.infer<typeof dailyRateBatchSchema>;

export const DIAS_SEMANA_LABELS = [
  { valor: "0", label: "dom" },
  { valor: "1", label: "seg" },
  { valor: "2", label: "ter" },
  { valor: "3", label: "qua" },
  { valor: "4", label: "qui" },
  { valor: "5", label: "sex" },
  { valor: "6", label: "sáb" },
] as const;
