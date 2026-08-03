import { z } from "zod";
import { diffDias, tryParseDateOnly } from "@/lib/dates";

/**
 * Validação de bloqueios manuais de calendário (UC-041).
 *
 * As datas formam um intervalo SEMIABERTO `[startDate, endDate)` — RN-001.
 * O formulário pede "primeira noite" e "última noite" porque é assim que
 * um operador pensa; a conversão para semiaberto acontece aqui, uma única
 * vez, em vez de espalhar `+1 dia` pelo código.
 */

/** Origens de bloqueio que o usuário pode criar pelo calendário. */
export const MOTIVOS_BLOQUEIO = ["MAINTENANCE", "OWNER_STAY", "MANUAL"] as const;

export const MOTIVO_LABELS: Record<(typeof MOTIVOS_BLOQUEIO)[number], string> = {
  MAINTENANCE: "Manutenção",
  OWNER_STAY: "Uso do proprietário",
  MANUAL: "Outro motivo",
};

/** Teto de 2 anos por bloqueio: evita travar uma unidade por engano de digitação. */
export const MAX_NOITES_BLOQUEIO = 730;

const dataSchema = z.string().transform((v, ctx) => {
  const d = tryParseDateOnly(v);
  if (!d) {
    ctx.addIssue({ code: "custom", message: "Informe uma data válida." });
    return z.NEVER;
  }
  return d;
});

export const bloqueioSchema = z
  .object({
    unitId: z.uuid({ error: "Selecione a unidade." }),
    /** Primeira noite bloqueada (inclusiva). */
    primeiraNoite: dataSchema,
    /** Última noite bloqueada (inclusiva, como o operador informa). */
    ultimaNoite: dataSchema,
    motivo: z.enum(MOTIVOS_BLOQUEIO),
    observacao: z
      .string()
      .trim()
      .max(200, { error: "Máximo de 200 caracteres." })
      .transform((v) => (v === "" ? null : v))
      .nullable(),
  })
  .refine((b) => b.ultimaNoite >= b.primeiraNoite, {
    error: "A última noite não pode ser anterior à primeira.",
    path: ["ultimaNoite"],
  })
  .refine(
    (b) => diffDias(b.primeiraNoite, b.ultimaNoite) + 1 <= MAX_NOITES_BLOQUEIO,
    {
      error: `Um bloqueio cobre no máximo ${MAX_NOITES_BLOQUEIO} noites.`,
      path: ["ultimaNoite"],
    },
  )
  .transform((b) => ({
    unitId: b.unitId,
    motivo: b.motivo,
    observacao: b.observacao,
    // Conversão para semiaberto: a última noite informada é a noite de
    // 15→16, então o fim exclusivo é 16 (RN-001). É também o que permite
    // que a próxima reserva comece no dia 16 sem conflitar.
    startDate: b.primeiraNoite,
    endDate: new Date(b.ultimaNoite.getTime() + 86_400_000),
  }));

export type BloqueioInput = z.infer<typeof bloqueioSchema>;
