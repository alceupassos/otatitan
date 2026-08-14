import { z } from "zod";
import { diffDias, tryParseDateOnly } from "@/lib/dates";

/**
 * Validação da entrada de cotação e de busca de disponibilidade (UC-030).
 *
 * O intervalo chega do formulário já como entrada e saída — semiaberto
 * `[checkIn, checkOut)`, ao contrário do bloqueio manual, porque é assim
 * que o hóspede pensa a estadia: "chego dia 10, saio dia 13" são três
 * noites (RN-001).
 */

/** Teto por cotação: estadia de mais de dois anos é erro de digitação. */
export const MAX_NOITES_COTACAO = 730;

/** Teto defensivo do formulário; o limite real é `Unit.maxGuests`. */
const MAX_HOSPEDES = 50;

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
    .transform((v, ctx) => {
      if (v === "") return opts.min;
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

// Zero noites não é estadia: o intervalo é semiaberto, então sair no mesmo
// dia em que se entra não reserva noite nenhuma.
const MSG_SAIDA = "A saída precisa ser pelo menos um dia depois da entrada.";
const MSG_TETO = `Uma cotação cobre no máximo ${MAX_NOITES_COTACAO} noites.`;

export const cotacaoSchema = z
  .object({
    unitId: z.uuid({ error: "Selecione a unidade." }),
    checkIn: dataSchema,
    checkOut: dataSchema,
    adultos: contagem({ min: 1, max: MAX_HOSPEDES, rotulo: "Adultos" }),
    criancas: contagem({ min: 0, max: MAX_HOSPEDES, rotulo: "Crianças" }),
    bebes: contagem({ min: 0, max: MAX_HOSPEDES, rotulo: "Bebês" }),
  })
  .refine((c) => diffDias(c.checkIn, c.checkOut) >= 1, {
    error: MSG_SAIDA,
    path: ["checkOut"],
  })
  .refine((c) => diffDias(c.checkIn, c.checkOut) <= MAX_NOITES_COTACAO, {
    error: MSG_TETO,
    path: ["checkOut"],
  })
  .transform((c) => ({
    ...c,
    // Bebês não ocupam vaga: a lotação da unidade conta adultos e
    // crianças, e contar berço como hóspede é o tipo de surpresa que
    // derruba a reserva no check-in.
    hospedes: c.adultos + c.criancas,
  }));

export type CotacaoInput = z.infer<typeof cotacaoSchema>;

export const buscaSchema = z
  .object({
    checkIn: dataSchema,
    checkOut: dataSchema,
    hospedes: contagem({ min: 1, max: MAX_HOSPEDES, rotulo: "Hóspedes" }),
    /** Restringe a busca a um imóvel; vazio = todos os do escopo do ator. */
    propertyId: z
      .string()
      .trim()
      .transform((v, ctx) => {
        if (v === "") return null;
        if (!z.uuid().safeParse(v).success) {
          ctx.addIssue({ code: "custom", message: "Imóvel inválido." });
          return z.NEVER;
        }
        return v;
      }),
  })
  .refine((b) => diffDias(b.checkIn, b.checkOut) >= 1, {
    error: MSG_SAIDA,
    path: ["checkOut"],
  })
  .refine((b) => diffDias(b.checkIn, b.checkOut) <= MAX_NOITES_COTACAO, {
    error: MSG_TETO,
    path: ["checkOut"],
  });

export type BuscaInput = z.infer<typeof buscaSchema>;
