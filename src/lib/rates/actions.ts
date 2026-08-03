"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { writeAudit } from "@/lib/audit/log";
import { requireActorWith } from "@/lib/auth/session";
import { diasNoIntervalo, toDateOnly } from "@/lib/dates";
import { withTenant } from "@/lib/db/with-tenant";
import { logger } from "@/lib/logging/logger";
import { scopeFor } from "@/lib/rbac/guard";
import { dailyRateBatchSchema, ratePlanSchema } from "./schemas";

export type RatesFormState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  values?: Record<string, string>;
  ok?: boolean;
  /** Mensagem de sucesso com o que foi feito ("120 diárias atualizadas"). */
  resumo?: string;
};

class NaoEncontrado extends Error {}

function coletar(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    if (typeof v === "string" && k !== "$ACTION_ID") out[k] = v;
  }
  return out;
}

function erroDeValidacao(
  issues: { path: PropertyKey[]; message: string }[],
  formData: FormData,
): RatesFormState {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of issues) {
    const campo = String(issue.path[0] ?? "_");
    (fieldErrors[campo] ??= []).push(issue.message);
  }
  return { fieldErrors, values: coletar(formData) };
}

// ── Planos de tarifa (UC-020) ─────────────────────────────────────────────

export async function criarRatePlanAction(
  unitId: string,
  _prev: RatesFormState | undefined,
  formData: FormData,
): Promise<RatesFormState> {
  const actor = await requireActorWith("rates.create");

  const parsed = ratePlanSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return erroDeValidacao(parsed.error.issues, formData);

  const dados = parsed.data;

  try {
    await withTenant(
      { tenantId: actor.tenantId, userId: actor.userId },
      async (tx) => {
        const unit = await tx.unit.findFirst({
          where: { id: unitId, property: scopeFor(actor, "Property") },
          select: { id: true, currency: true },
        });
        if (!unit) throw new NaoEncontrado();

        const existentes = await tx.ratePlan.count({
          where: { unitId, status: { not: "ARCHIVED" } },
        });

        // UC-020: o primeiro plano da unidade é padrão e ativo, sem o
        // usuário precisar marcar nada — uma unidade com plano nenhum
        // ativo não vende, e esse é o erro mais fácil de cometer.
        const primeiro = existentes === 0;
        const status = primeiro ? "ACTIVE" : dados.status;
        const querSerPadrao = primeiro || dados.isDefault;

        // O índice parcial `rate_plan_one_default_per_unit` permite um só
        // padrão-ativo por unidade. Desmarcar o anterior ANTES de criar
        // evita a violação — e tudo na mesma transação, para não existir
        // instante com zero padrão.
        if (querSerPadrao && status === "ACTIVE") {
          await tx.ratePlan.updateMany({
            where: { unitId, isDefault: true },
            data: { isDefault: false },
          });
        }

        const plano = await tx.ratePlan.create({
          data: {
            unitId,
            code: dados.code,
            name: dados.name,
            status,
            isDefault: querSerPadrao && status === "ACTIVE",
            currency: unit.currency,
            minNights: dados.minNights,
            maxNights: dados.maxNights,
            minAdvanceDays: dados.minAdvanceDays,
            maxAdvanceDays: dados.maxAdvanceDays,
            includesCleaningFee: dados.includesCleaningFee,
            cancellationPolicy: dados.cancellationPolicy,
          },
        });

        await writeAudit(tx, {
          action: "rate_plan.created",
          entityType: "RatePlan",
          entityId: plano.id,
          actorUserId: actor.userId,
          after: {
            unitId,
            code: plano.code,
            name: plano.name,
            status: plano.status,
            isDefault: plano.isDefault,
          },
        });
      },
    );
  } catch (err) {
    if (err instanceof NaoEncontrado) {
      return { error: "Unidade não encontrada." };
    }
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return {
        fieldErrors: { code: ["Já existe um plano com este código nesta unidade."] },
        values: coletar(formData),
      };
    }
    logger.error({ err: (err as Error).message }, "Falha ao criar plano de tarifa");
    return { error: "Não foi possível criar o plano.", values: coletar(formData) };
  }

  revalidatePath(`/tarifas/${unitId}`);
  revalidatePath("/tarifas");
  return { ok: true, resumo: "Plano criado." };
}

/** Torna um plano o padrão da unidade. */
export async function definirPadraoAction(formData: FormData): Promise<void> {
  const actor = await requireActorWith("rates.edit");
  const unitId = String(formData.get("unitId") ?? "");
  const planId = String(formData.get("planId") ?? "");

  await withTenant(
    { tenantId: actor.tenantId, userId: actor.userId },
    async (tx) => {
      const plano = await tx.ratePlan.findFirst({
        where: {
          id: planId,
          unitId,
          unit: { property: scopeFor(actor, "Property") },
        },
        select: { id: true, name: true, status: true },
      });
      // Silencioso quando fora do escopo: a ação vem de um formulário na
      // listagem, e revelar "existe mas não é seu" não ajuda ninguém.
      if (!plano) return;

      await tx.ratePlan.updateMany({
        where: { unitId, isDefault: true },
        data: { isDefault: false },
      });
      await tx.ratePlan.update({
        where: { id: planId },
        // Padrão só faz sentido ativo — o índice parcial só considera
        // ACTIVE, e um padrão em rascunho não venderia nada.
        data: { isDefault: true, status: "ACTIVE" },
      });

      await writeAudit(tx, {
        action: "rate_plan.set_default",
        entityType: "RatePlan",
        entityId: planId,
        actorUserId: actor.userId,
        after: { unitId, name: plano.name },
      });
    },
  );

  revalidatePath(`/tarifas/${unitId}`);
}

// ── Tarifas diárias (UC-021) ──────────────────────────────────────────────

/**
 * Aplica um preço a um intervalo de datas, em lote.
 *
 * Usa `upsert` por data porque a operação é idempotente por natureza:
 * republicar o mesmo período com preço novo é o fluxo normal de quem
 * ajusta tarifa, não um erro a ser recusado.
 */
export async function aplicarTarifasAction(
  unitId: string,
  _prev: RatesFormState | undefined,
  formData: FormData,
): Promise<RatesFormState> {
  const actor = await requireActorWith("rates.edit");

  const bruto = {
    ...Object.fromEntries(formData),
    diasSemana: formData.getAll("diasSemana").map(String),
  };
  const parsed = dailyRateBatchSchema.safeParse(bruto);
  if (!parsed.success) return erroDeValidacao(parsed.error.issues, formData);

  const d = parsed.data;
  let aplicadas = 0;

  try {
    await withTenant(
      { tenantId: actor.tenantId, userId: actor.userId },
      async (tx) => {
        const plano = await tx.ratePlan.findFirst({
          where: {
            id: d.ratePlanId,
            unitId,
            unit: { property: scopeFor(actor, "Property") },
          },
          select: { id: true, code: true, currency: true },
        });
        if (!plano) throw new NaoEncontrado();

        // `ate` é inclusivo aqui: o usuário pediu "de 10 a 20", e o dia 20
        // deve receber tarifa. Diferente de estadia, que é semiaberta.
        const fimExclusivo = new Date(d.ate.getTime() + 86_400_000);
        const dias = diasNoIntervalo(d.de, fimExclusivo).filter(
          (dia) =>
            d.diasSemana.length === 0 || d.diasSemana.includes(dia.getUTCDay()),
        );

        for (const dia of dias) {
          await tx.dailyRate.upsert({
            where: {
              tenantId_ratePlanId_unitId_date: {
                tenantId: actor.tenantId,
                ratePlanId: plano.id,
                unitId,
                date: dia,
              },
            },
            update: {
              priceCents: d.priceCents,
              minNights: d.minNights,
              isClosed: d.isClosed,
              closedToArrival: d.closedToArrival,
              closedToDeparture: d.closedToDeparture,
              source: "BULK_EDIT",
              updatedById: actor.userId,
            },
            create: {
              ratePlanId: plano.id,
              unitId,
              date: dia,
              priceCents: d.priceCents,
              currency: plano.currency,
              minNights: d.minNights,
              isClosed: d.isClosed,
              closedToArrival: d.closedToArrival,
              closedToDeparture: d.closedToDeparture,
              source: "BULK_EDIT",
              updatedById: actor.userId,
            },
          });
        }
        aplicadas = dias.length;

        // Uma linha de auditoria para o lote, não uma por dia: 730 linhas
        // por edição afogariam a trilha sem acrescentar informação.
        await writeAudit(tx, {
          action: "daily_rate.bulk_updated",
          entityType: "DailyRate",
          entityId: plano.id,
          actorUserId: actor.userId,
          after: {
            unitId,
            plano: plano.code,
            de: toDateOnly(d.de),
            ate: toDateOnly(d.ate),
            dias: dias.length,
            priceCents: d.priceCents,
            fechado: d.isClosed,
            diasSemana: d.diasSemana,
          },
        });
      },
    );
  } catch (err) {
    if (err instanceof NaoEncontrado) {
      return { error: "Plano de tarifa não encontrado." };
    }
    logger.error({ err: (err as Error).message }, "Falha ao aplicar tarifas");
    return { error: "Não foi possível aplicar as tarifas.", values: coletar(formData) };
  }

  revalidatePath(`/tarifas/${unitId}`);
  revalidatePath("/tarifas");

  if (aplicadas === 0) {
    return {
      ok: true,
      resumo:
        "Nenhuma data no intervalo casou com os dias da semana escolhidos.",
    };
  }
  return {
    ok: true,
    resumo: `${aplicadas} ${aplicadas === 1 ? "diária" : "diárias"} atualizada${aplicadas === 1 ? "" : "s"}.`,
  };
}

/**
 * Remove as tarifas de um intervalo.
 *
 * Apagar torna as noites INDISPONÍVEIS (RN-011) — não gratuitas. É por
 * isso que a UI chama isso de "despublicar", e não de "zerar o preço".
 */
export async function removerTarifasAction(
  unitId: string,
  _prev: RatesFormState | undefined,
  formData: FormData,
): Promise<RatesFormState> {
  const actor = await requireActorWith("rates.delete");

  const ratePlanId = String(formData.get("ratePlanId") ?? "");
  const deRaw = String(formData.get("de") ?? "");
  const ateRaw = String(formData.get("ate") ?? "");

  const parsed = dailyRateBatchSchema.safeParse({
    ratePlanId,
    de: deRaw,
    ate: ateRaw,
    // Campos exigidos pelo schema mas irrelevantes na remoção.
    priceCents: "1",
    minNights: "",
    diasSemana: [],
  });
  if (!parsed.success) return erroDeValidacao(parsed.error.issues, formData);

  let removidas = 0;
  try {
    await withTenant(
      { tenantId: actor.tenantId, userId: actor.userId },
      async (tx) => {
        const plano = await tx.ratePlan.findFirst({
          where: {
            id: ratePlanId,
            unitId,
            unit: { property: scopeFor(actor, "Property") },
          },
          select: { id: true, code: true },
        });
        if (!plano) throw new NaoEncontrado();

        const fimExclusivo = new Date(parsed.data.ate.getTime() + 86_400_000);
        const r = await tx.dailyRate.deleteMany({
          where: {
            unitId,
            ratePlanId: plano.id,
            date: { gte: parsed.data.de, lt: fimExclusivo },
          },
        });
        removidas = r.count;

        await writeAudit(tx, {
          action: "daily_rate.bulk_removed",
          entityType: "DailyRate",
          entityId: plano.id,
          actorUserId: actor.userId,
          before: {
            unitId,
            plano: plano.code,
            de: toDateOnly(parsed.data.de),
            ate: toDateOnly(parsed.data.ate),
            dias: r.count,
          },
        });
      },
    );
  } catch (err) {
    if (err instanceof NaoEncontrado) return { error: "Plano não encontrado." };
    logger.error({ err: (err as Error).message }, "Falha ao remover tarifas");
    return { error: "Não foi possível remover as tarifas." };
  }

  revalidatePath(`/tarifas/${unitId}`);
  revalidatePath("/tarifas");
  return {
    ok: true,
    resumo: `${removidas} ${removidas === 1 ? "diária removida" : "diárias removidas"} — essas noites ficam indisponíveis.`,
  };
}
