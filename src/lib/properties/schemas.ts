import { z } from "zod";
import { tryParseMoneyToCents } from "@/lib/money";

/**
 * Validação de imóveis e unidades. Roda no SERVIDOR — o formulário pode
 * repetir parte disso para dar retorno imediato, mas nunca é a fonte de
 * verdade (uma server action é alcançável por POST direto).
 */

export const PROPERTY_TYPES = [
  "APARTMENT",
  "HOUSE",
  "POUSADA",
  "CHALE",
  "CONDO",
  "FLAT",
  "ROOM",
  "OTHER",
] as const;

export const PROPERTY_TYPE_LABELS: Record<
  (typeof PROPERTY_TYPES)[number],
  string
> = {
  APARTMENT: "Apartamento",
  HOUSE: "Casa",
  POUSADA: "Pousada",
  CHALE: "Chalé",
  CONDO: "Condomínio",
  FLAT: "Flat",
  ROOM: "Quarto",
  OTHER: "Outro",
};

export const PROPERTY_STATUSES = ["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"] as const;

export const PROPERTY_STATUS_LABELS: Record<
  (typeof PROPERTY_STATUSES)[number],
  string
> = {
  DRAFT: "Rascunho",
  ACTIVE: "Ativo",
  INACTIVE: "Inativo",
  ARCHIVED: "Arquivado",
};

export const UNIT_STATUS_LABELS = PROPERTY_STATUS_LABELS;

/** Siglas das 27 unidades federativas. */
export const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS",
  "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC",
  "SP", "SE", "TO",
] as const;

/** `HH:MM` em 24h — o banco guarda como texto (Property.checkInTime). */
const horaSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: "Use o formato HH:MM." });

/** Campo de texto opcional: string vazia do formulário vira `null`. */
const opcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: `Máximo de ${max} caracteres.` })
    .transform((v) => (v === "" ? null : v))
    .nullable();

const dinheiroOpcional = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (v === "") return null;
    const cents = tryParseMoneyToCents(v);
    if (cents === null) {
      ctx.addIssue({ code: "custom", message: "Valor monetário inválido." });
      return z.NEVER;
    }
    if (cents < 0) {
      ctx.addIssue({ code: "custom", message: "O valor não pode ser negativo." });
      return z.NEVER;
    }
    return cents;
  })
  .nullable();

const dinheiroObrigatorio = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const cents = tryParseMoneyToCents(v);
    if (cents === null) {
      ctx.addIssue({ code: "custom", message: "Valor monetário inválido." });
      return z.NEVER;
    }
    if (cents < 0) {
      ctx.addIssue({ code: "custom", message: "O valor não pode ser negativo." });
      return z.NEVER;
    }
    return cents;
  });

/** Inteiro vindo de `<input type=number>`, que sempre chega como string. */
const inteiro = (opts: { min: number; max: number; rotulo: string }) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      const n = Number(v);
      if (v === "" || !Number.isInteger(n)) {
        ctx.addIssue({ code: "custom", message: `${opts.rotulo}: informe um número inteiro.` });
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

export const propertySchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, { error: "Informe o nome do imóvel." })
    .max(120, { error: "Máximo de 120 caracteres." }),
  type: z.enum(PROPERTY_TYPES),
  status: z.enum(["DRAFT", "ACTIVE", "INACTIVE"]),
  description: opcional(2000),
  addressLine1: opcional(200),
  addressLine2: opcional(200),
  neighborhood: opcional(120),
  city: opcional(120),
  state: z
    .string()
    .trim()
    .toUpperCase()
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .refine((v) => v === null || (UFS as readonly string[]).includes(v), {
      error: "UF inválida.",
    }),
  postalCode: opcional(9),
  checkInTime: horaSchema,
  checkOutTime: horaSchema,
  houseRules: opcional(2000),
});

export type PropertyInput = z.infer<typeof propertySchema>;

export const unitSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, { error: "Informe o nome da unidade." })
      .max(120, { error: "Máximo de 120 caracteres." }),
    internalCode: z
      .string()
      .trim()
      .min(1, { error: "Informe o código interno." })
      .max(40, { error: "Máximo de 40 caracteres." }),
    status: z.enum(["DRAFT", "ACTIVE", "INACTIVE"]),
    maxGuests: inteiro({ min: 1, max: 60, rotulo: "Capacidade" }),
    bedrooms: inteiro({ min: 0, max: 40, rotulo: "Quartos" }),
    beds: inteiro({ min: 0, max: 60, rotulo: "Camas" }),
    bathrooms: inteiro({ min: 0, max: 40, rotulo: "Banheiros" }),
    sizeM2: z
      .string()
      .trim()
      .transform((v, ctx) => {
        if (v === "") return null;
        const n = Number(v);
        if (!Number.isInteger(n) || n <= 0 || n > 100_000) {
          ctx.addIssue({ code: "custom", message: "Área inválida." });
          return z.NEVER;
        }
        return n;
      })
      .nullable(),
    baseRateCents: dinheiroOpcional,
    cleaningFeeCents: dinheiroObrigatorio,
    minNights: inteiro({ min: 1, max: 365, rotulo: "Estadia mínima" }),
    maxNights: z
      .string()
      .trim()
      .transform((v, ctx) => {
        if (v === "") return null;
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > 3650) {
          ctx.addIssue({ code: "custom", message: "Estadia máxima inválida." });
          return z.NEVER;
        }
        return n;
      })
      .nullable(),
    amenityIds: z.array(z.uuid()).default([]),
  })
  .refine((u) => u.maxNights === null || u.maxNights >= u.minNights, {
    error: "A estadia máxima não pode ser menor que a mínima.",
    path: ["maxNights"],
  })
  // Uma unidade que acomoda gente precisa de onde dormir. Pega o caso
  // comum de cadastrar capacidade 6 e esquecer de informar as camas.
  .refine((u) => u.beds > 0 || u.maxGuests === 0, {
    error: "Informe ao menos uma cama.",
    path: ["beds"],
  });

export type UnitInput = z.infer<typeof unitSchema>;

/**
 * Slug a partir do nome: minúsculas, sem acento, hifenizado.
 * Usado como parte da URL pública do imóvel (`/stays/[slug]`), por isso
 * precisa ser estável e legível — não é um id.
 */
export function slugify(nome: string): string {
  return nome
    .normalize("NFD")
    // Marcas de combinação (os acentos que o NFD separou da letra).
    // Escapes explícitos em vez dos caracteres literais, que são
    // invisíveis no editor e somem numa cópia descuidada.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
