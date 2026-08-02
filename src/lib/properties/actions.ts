"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { writeAudit } from "@/lib/audit/log";
import { requireActorWith } from "@/lib/auth/session";
import type { TenantTx } from "@/lib/db/with-tenant";
import { withTenant } from "@/lib/db/with-tenant";
import { logger } from "@/lib/logging/logger";
import { scopeFor } from "@/lib/rbac/guard";
import { ERRO_QUERY, NotFoundInScope, UnitEmUso } from "./errors";
import { propertySchema, slugify, unitSchema } from "./schemas";

/**
 * Mutações de imóveis e unidades.
 *
 * Toda action começa por `requireActorWith(...)`: uma server action é
 * alcançável por POST direto, sem passar pela UI, então a checagem do
 * proxy não vale como autorização aqui (ADR-007).
 */

export type FormState = {
  /** Mensagem geral de erro (falha inesperada, conflito). */
  error?: string;
  /** Erros por campo, no formato que o formulário consome. */
  fieldErrors?: Record<string, string[]>;
  /** Valores digitados, para o formulário não perder o que o usuário escreveu. */
  values?: Record<string, string>;
};

function coletarCampos(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    if (typeof v === "string" && k !== "$ACTION_ID") out[k] = v;
  }
  return out;
}

function erroDeValidacao(
  issues: { path: PropertyKey[]; message: string }[],
  formData: FormData,
): FormState {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of issues) {
    const campo = String(issue.path[0] ?? "_");
    (fieldErrors[campo] ??= []).push(issue.message);
  }
  return { fieldErrors, values: coletarCampos(formData) };
}

/**
 * Garante slug único dentro do tenant. Colisão é esperada — duas unidades
 * "Casa da Praia" na mesma empresa é caso comum —, então em vez de recusar
 * o cadastro, acrescenta sufixo numérico.
 */
async function slugDisponivel(
  tx: TenantTx,
  base: string,
  ignorarId?: string,
): Promise<string> {
  const raiz = base || "imovel";
  for (let n = 0; n < 50; n++) {
    const candidato = n === 0 ? raiz : `${raiz}-${n + 1}`;
    const existente = await tx.property.findFirst({
      where: { slug: candidato },
      select: { id: true },
    });
    if (!existente || existente.id === ignorarId) return candidato;
  }
  // 50 homônimos no mesmo tenant é implausível; o sufixo aleatório evita
  // um laço infinito em vez de estourar na cara do usuário.
  return `${raiz}-${Date.now().toString(36)}`;
}

// ── Imóveis ───────────────────────────────────────────────────────────────

export async function createPropertyAction(
  _prev: FormState | undefined,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireActorWith("properties.create");

  const parsed = propertySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return erroDeValidacao(parsed.error.issues, formData);

  let novoId: string;
  try {
    novoId = await withTenant(
      { tenantId: actor.tenantId, userId: actor.userId },
      async (tx) => {
        const slug = await slugDisponivel(tx, slugify(parsed.data.name));
        const property = await tx.property.create({
          data: { ...parsed.data, slug, createdById: actor.userId },
        });

        await writeAudit(tx, {
          action: "property.created",
          entityType: "Property",
          entityId: property.id,
          actorUserId: actor.userId,
          after: { name: property.name, slug: property.slug, status: property.status },
        });

        return property.id;
      },
    );
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Falha ao criar imóvel");
    return { error: "Não foi possível salvar o imóvel.", values: coletarCampos(formData) };
  }

  revalidatePath("/imoveis");
  // Fora do try: `redirect` sinaliza por exceção e seria engolido pelo catch.
  redirect(`/imoveis/${novoId}`);
}

export async function updatePropertyAction(
  propertyId: string,
  _prev: FormState | undefined,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireActorWith("properties.edit");

  const parsed = propertySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return erroDeValidacao(parsed.error.issues, formData);

  try {
    await withTenant(
      { tenantId: actor.tenantId, userId: actor.userId },
      async (tx) => {
        const antes = await tx.property.findFirst({
          where: { id: propertyId, ...scopeFor(actor, "Property") },
        });
        // NotFound (não Forbidden) quando está fora do escopo: responder
        // 403 revelaria que aquele id existe em algum lugar.
        if (!antes) throw new NotFoundInScope();

        const slug =
          antes.name === parsed.data.name
            ? antes.slug
            : await slugDisponivel(tx, slugify(parsed.data.name), propertyId);

        const depois = await tx.property.update({
          where: { id: propertyId },
          data: { ...parsed.data, slug },
        });

        await writeAudit(tx, {
          action: "property.updated",
          entityType: "Property",
          entityId: propertyId,
          actorUserId: actor.userId,
          before: { name: antes.name, status: antes.status, slug: antes.slug },
          after: { name: depois.name, status: depois.status, slug: depois.slug },
        });
      },
    );
  } catch (err) {
    if (err instanceof NotFoundInScope) {
      return { error: "Imóvel não encontrado." };
    }
    logger.error({ err: (err as Error).message }, "Falha ao atualizar imóvel");
    return { error: "Não foi possível salvar as alterações.", values: coletarCampos(formData) };
  }

  revalidatePath("/imoveis");
  revalidatePath(`/imoveis/${propertyId}`);
  return {};
}

/**
 * "Excluir" um imóvel é ARQUIVAR.
 *
 * Reservas, pagamentos e auditoria apontam para o imóvel; apagar de
 * verdade ou quebraria essas referências ou apagaria histórico
 * financeiro em cascata. Arquivar tira da operação e preserva o passado
 * (mesmo princípio da RN-005 para reservas).
 */
export async function archivePropertyAction(formData: FormData): Promise<void> {
  const actor = await requireActorWith("properties.delete");
  const propertyId = String(formData.get("propertyId") ?? "");

  try {
    await withTenant(
      { tenantId: actor.tenantId, userId: actor.userId },
      async (tx) => {
        const antes = await tx.property.findFirst({
          where: { id: propertyId, ...scopeFor(actor, "Property") },
          select: { id: true, name: true, status: true },
        });
        if (!antes) throw new NotFoundInScope();

        await tx.property.update({
          where: { id: propertyId },
          data: { status: "ARCHIVED", archivedAt: new Date() },
        });
        // As unidades acompanham: uma unidade ativa sob imóvel arquivado
        // continuaria aparecendo em busca de disponibilidade.
        await tx.unit.updateMany({
          where: { propertyId },
          data: { status: "ARCHIVED", archivedAt: new Date() },
        });

        await writeAudit(tx, {
          action: "property.archived",
          entityType: "Property",
          entityId: propertyId,
          actorUserId: actor.userId,
          before: { status: antes.status },
          after: { status: "ARCHIVED" },
        });
      },
    );
  } catch (err) {
    // Erro aqui vira redirect com código na querystring, não página de
    // erro: a ação partiu de um formulário, e o usuário precisa voltar
    // para a lista sabendo o que houve.
    const codigo =
      err instanceof NotFoundInScope ? ERRO_QUERY.naoEncontrado : ERRO_QUERY.falha;
    if (!(err instanceof NotFoundInScope)) {
      logger.error({ err: (err as Error).message }, "Falha ao arquivar imóvel");
    }
    redirect(`/imoveis?erro=${codigo}`);
  }

  revalidatePath("/imoveis");
  redirect("/imoveis");
}

// ── Unidades ──────────────────────────────────────────────────────────────

export async function createUnitAction(
  propertyId: string,
  _prev: FormState | undefined,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireActorWith("units.create");

  const bruto = {
    ...Object.fromEntries(formData),
    amenityIds: formData.getAll("amenityIds").map(String),
  };
  const parsed = unitSchema.safeParse(bruto);
  if (!parsed.success) return erroDeValidacao(parsed.error.issues, formData);

  const { amenityIds, ...dados } = parsed.data;

  try {
    await withTenant(
      { tenantId: actor.tenantId, userId: actor.userId },
      async (tx) => {
        const property = await tx.property.findFirst({
          where: { id: propertyId, ...scopeFor(actor, "Property") },
          select: { id: true },
        });
        if (!property) throw new NotFoundInScope();

        const unit = await tx.unit.create({ data: { ...dados, propertyId } });

        if (amenityIds.length > 0) {
          await tx.unitAmenity.createMany({
            data: amenityIds.map((amenityId) => ({ unitId: unit.id, amenityId })),
            skipDuplicates: true,
          });
        }

        await writeAudit(tx, {
          action: "unit.created",
          entityType: "Unit",
          entityId: unit.id,
          actorUserId: actor.userId,
          after: { name: unit.name, internalCode: unit.internalCode, propertyId },
        });
      },
    );
  } catch (err) {
    if (err instanceof NotFoundInScope) return { error: "Imóvel não encontrado." };
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      // Unique (tenantId, propertyId, internalCode).
      return {
        fieldErrors: { internalCode: ["Já existe uma unidade com este código."] },
        values: coletarCampos(formData),
      };
    }
    logger.error({ err: (err as Error).message }, "Falha ao criar unidade");
    return { error: "Não foi possível salvar a unidade.", values: coletarCampos(formData) };
  }

  revalidatePath(`/imoveis/${propertyId}`);
  redirect(`/imoveis/${propertyId}`);
}

export async function updateUnitAction(
  propertyId: string,
  unitId: string,
  _prev: FormState | undefined,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireActorWith("units.edit");

  const bruto = {
    ...Object.fromEntries(formData),
    amenityIds: formData.getAll("amenityIds").map(String),
  };
  const parsed = unitSchema.safeParse(bruto);
  if (!parsed.success) return erroDeValidacao(parsed.error.issues, formData);

  const { amenityIds, ...dados } = parsed.data;

  try {
    await withTenant(
      { tenantId: actor.tenantId, userId: actor.userId },
      async (tx) => {
        const property = await tx.property.findFirst({
          where: { id: propertyId, ...scopeFor(actor, "Property") },
          select: { id: true },
        });
        if (!property) throw new NotFoundInScope();

        const antes = await tx.unit.findFirst({ where: { id: unitId, propertyId } });
        if (!antes) throw new NotFoundInScope();

        await tx.unit.update({ where: { id: unitId }, data: dados });

        // Comodidades: troca o conjunto inteiro. Um diff seria mais
        // econômico, mas aqui são poucas linhas e a substituição elimina
        // a chance de sobrar vínculo órfão.
        await tx.unitAmenity.deleteMany({ where: { unitId } });
        if (amenityIds.length > 0) {
          await tx.unitAmenity.createMany({
            data: amenityIds.map((amenityId) => ({ unitId, amenityId })),
            skipDuplicates: true,
          });
        }

        await writeAudit(tx, {
          action: "unit.updated",
          entityType: "Unit",
          entityId: unitId,
          actorUserId: actor.userId,
          before: { name: antes.name, status: antes.status, maxGuests: antes.maxGuests },
          after: { name: dados.name, status: dados.status, maxGuests: dados.maxGuests },
        });
      },
    );
  } catch (err) {
    if (err instanceof NotFoundInScope) return { error: "Unidade não encontrada." };
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return {
        fieldErrors: { internalCode: ["Já existe uma unidade com este código."] },
        values: coletarCampos(formData),
      };
    }
    logger.error({ err: (err as Error).message }, "Falha ao atualizar unidade");
    return { error: "Não foi possível salvar a unidade.", values: coletarCampos(formData) };
  }

  revalidatePath(`/imoveis/${propertyId}`);
  return {};
}

export async function archiveUnitAction(formData: FormData): Promise<void> {
  const actor = await requireActorWith("units.delete");
  const propertyId = String(formData.get("propertyId") ?? "");
  const unitId = String(formData.get("unitId") ?? "");

  try {
    await withTenant(
      { tenantId: actor.tenantId, userId: actor.userId },
      async (tx) => {
        const property = await tx.property.findFirst({
          where: { id: propertyId, ...scopeFor(actor, "Property") },
          select: { id: true },
        });
        if (!property) throw new NotFoundInScope();

        const unit = await tx.unit.findFirst({
          where: { id: unitId, propertyId },
          select: { id: true, status: true },
        });
        if (!unit) throw new NotFoundInScope();

        // Uma unidade com ocupação futura não pode sumir do calendário sem
        // que alguém resolva as reservas primeiro (RN-002/RN-005).
        const hoje = new Date();
        hoje.setUTCHours(0, 0, 0, 0);
        const ocupacaoFutura = await tx.availabilityBlock.count({
          where: {
            unitId,
            isBlocking: true,
            releasedAt: null,
            endDate: { gt: hoje },
          },
        });
        if (ocupacaoFutura > 0) throw new UnitEmUso(ocupacaoFutura);

        await tx.unit.update({
          where: { id: unitId },
          data: { status: "ARCHIVED", archivedAt: new Date() },
        });

        await writeAudit(tx, {
          action: "unit.archived",
          entityType: "Unit",
          entityId: unitId,
          actorUserId: actor.userId,
          before: { status: unit.status },
          after: { status: "ARCHIVED" },
        });
      },
    );
  } catch (err) {
    let codigo: string = ERRO_QUERY.falha;
    if (err instanceof UnitEmUso) codigo = ERRO_QUERY.unidadeEmUso;
    else if (err instanceof NotFoundInScope) codigo = ERRO_QUERY.naoEncontrado;
    else logger.error({ err: (err as Error).message }, "Falha ao arquivar unidade");

    redirect(`/imoveis/${propertyId}?erro=${codigo}`);
  }

  revalidatePath(`/imoveis/${propertyId}`);
  redirect(`/imoveis/${propertyId}`);
}
