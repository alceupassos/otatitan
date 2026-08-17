import { z } from "zod";
import { tryParseDateOnly } from "@/lib/dates";
import { hospedeSchema } from "@/lib/guests/schemas";
import { MADRE914 } from "./config";

const dataIso = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const d = tryParseDateOnly(v);
    if (!d) {
      ctx.addIssue({ code: "custom", message: "Data inválida." });
      return z.NEVER;
    }
    return d;
  });

export const consultaPublicaSchema = z
  .object({
    checkIn: dataIso,
    checkOut: dataIso,
    adults: z.number().int().min(1).max(MADRE914.maxGuests),
    children: z.number().int().min(0).max(MADRE914.maxGuests).default(0),
    pets: z.number().int().min(0).max(MADRE914.maxPets).default(0),
    parking: z.boolean().default(false),
  })
  .refine((v) => v.adults + v.children <= MADRE914.maxGuests, {
    message: `Capacidade máxima de ${MADRE914.maxGuests} hóspedes por studio.`,
    path: ["adults"],
  });

export type ConsultaPublica = z.infer<typeof consultaPublicaSchema>;

export const reservaPublicaSchema = consultaPublicaSchema.and(
  z.object({
    unitId: z.uuid(),
    ratePlanId: z.uuid(),
    totalConferidoCents: z.number().int().positive(),
    hospede: hospedeSchema,
    fotoResponsavelBase64: z
      .string()
      .min(32, { error: "Envie a foto do responsável pela reserva." })
      .max(2_000_000, { error: "A foto é grande demais. Use outra, mais leve." }),
    aceitouPoliticas: z.boolean().refine((v) => v === true, {
      error: "É preciso aceitar as políticas para concluir a reserva.",
    }),
    aceitouFoto: z.boolean().refine((v) => v === true, {
      error: "É preciso autorizar o uso da foto só para conferência na portaria.",
    }),
  }),
)
  .refine((v) => Boolean(v.hospede.email), {
    message: "Informe o e-mail do responsável.",
    path: ["hospede", "email"],
  })
  .refine((v) => Boolean(v.hospede.phone), {
    message: "Informe o WhatsApp do responsável.",
    path: ["hospede", "phone"],
  })
  .refine((v) => v.hospede.documentType === "CPF" && Boolean(v.hospede.documentNumber), {
    message: "O CPF do responsável é obrigatório.",
    path: ["hospede", "documentNumber"],
  });

export type ReservaPublica = z.infer<typeof reservaPublicaSchema>;

export const calendarioPublicoSchema = z.object({
  mes: dataIso,
});
