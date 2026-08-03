"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { writeAudit } from "@/lib/audit/log";
import { requireActorWith } from "@/lib/auth/session";
import { toDateOnly } from "@/lib/dates";
import { withTenant } from "@/lib/db/with-tenant";
import { logger } from "@/lib/logging/logger";
import { scopeFor } from "@/lib/rbac/guard";
import { ERRO_CALENDARIO, PG_EXCLUSION_VIOLATION } from "./errors";
import { bloqueioSchema } from "./schemas";

export type CalendarioFormState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  values?: Record<string, string>;
  ok?: boolean;
};

function coletar(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    if (typeof v === "string" && k !== "$ACTION_ID") out[k] = v;
  }
  return out;
}

/** A constraint de exclusão GiST falhou — as datas já estão ocupadas. */
function ehConflitoDeOcupacao(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // P2010 = raw query falhou; o código do Postgres vem em `meta.code`.
    const meta = err.meta as { code?: string } | undefined;
    if (meta?.code === PG_EXCLUSION_VIOLATION) return true;
    if (err.code === "P2002") return true;
  }
  // A mensagem carrega o nome da constraint quando o erro sobe cru.
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes(PG_EXCLUSION_VIOLATION) ||
    msg.includes("availability_block_no_overlap")
  );
}

class NaoEncontrado extends Error {}
class EhReserva extends Error {}

/**
 * Cria um bloqueio manual (UC-041).
 *
 * O `pg_advisory_xact_lock` por unidade serializa tentativas concorrentes
 * na MESMA unidade (ADR-003). Ele não é a garantia — a garantia é a
 * constraint de exclusão, que vale mesmo se este código tiver bug — mas
 * reduz o retrabalho de duas requisições simultâneas colidirem no commit.
 */
export async function criarBloqueioAction(
  _prev: CalendarioFormState | undefined,
  formData: FormData,
): Promise<CalendarioFormState> {
  const actor = await requireActorWith("availability.create");

  const parsed = bloqueioSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const campo = String(issue.path[0] ?? "_");
      (fieldErrors[campo] ??= []).push(issue.message);
    }
    return { fieldErrors, values: coletar(formData) };
  }

  const { unitId, startDate, endDate, motivo, observacao } = parsed.data;

  try {
    await withTenant(
      { tenantId: actor.tenantId, userId: actor.userId },
      async (tx) => {
        // A unidade tem de estar no escopo do ator — não basta o id existir.
        const unit = await tx.unit.findFirst({
          where: {
            id: unitId,
            property: scopeFor(actor, "Property"),
          },
          select: { id: true, internalCode: true },
        });
        if (!unit) throw new NaoEncontrado();

        // hashtextextended dá um bigint estável a partir do uuid, que é o
        // que o advisory lock aceita.
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtextextended(${unitId}::text, 0))
        `;

        const bloco = await tx.availabilityBlock.create({
          data: {
            unitId,
            startDate,
            endDate,
            source: motivo,
            isBlocking: true,
            reason: observacao,
            createdById: actor.userId,
          },
        });

        await writeAudit(tx, {
          action: "availability.blocked",
          entityType: "AvailabilityBlock",
          entityId: bloco.id,
          actorUserId: actor.userId,
          after: {
            unitId,
            unidade: unit.internalCode,
            de: toDateOnly(startDate),
            ate: toDateOnly(endDate),
            origem: motivo,
            motivo: observacao,
          },
        });
      },
    );
  } catch (err) {
    if (err instanceof NaoEncontrado) {
      return { error: "Unidade não encontrada.", values: coletar(formData) };
    }
    if (ehConflitoDeOcupacao(err)) {
      // Não é erro de sistema: é o banco cumprindo a RN-002. A mensagem
      // lembra que saída e entrada no mesmo dia são permitidas, porque é
      // a confusão mais comum de quem vê "datas ocupadas".
      return {
        error:
          "Essas datas já estão ocupadas nesta unidade. Uma saída e uma " +
          "entrada no mesmo dia não são conflito — confira o calendário.",
        values: coletar(formData),
      };
    }
    logger.error({ err: (err as Error).message }, "Falha ao criar bloqueio");
    return { error: "Não foi possível criar o bloqueio.", values: coletar(formData) };
  }

  revalidatePath("/calendario");
  return { ok: true };
}

/**
 * Libera um bloqueio manual.
 *
 * Marca `releasedAt` em vez de apagar: a constraint de exclusão ignora
 * bloqueios liberados, então a data volta a ficar livre, e o histórico de
 * quem bloqueou e quando permanece (RN-010).
 *
 * Bloqueio de origem RESERVATION é recusado — UC-041. Liberá-lo deixaria
 * a reserva sem lugar no calendário e abriria a data para outra venda.
 */
export async function liberarBloqueioAction(formData: FormData): Promise<void> {
  const actor = await requireActorWith("availability.delete");
  const blockId = String(formData.get("blockId") ?? "");
  const mes = String(formData.get("mes") ?? "");

  const destino = mes ? `/calendario?mes=${mes}` : "/calendario";

  try {
    await withTenant(
      { tenantId: actor.tenantId, userId: actor.userId },
      async (tx) => {
        const bloco = await tx.availabilityBlock.findFirst({
          where: {
            id: blockId,
            unit: { property: scopeFor(actor, "Property") },
          },
          select: {
            id: true,
            source: true,
            startDate: true,
            endDate: true,
            unitId: true,
            reservationId: true,
          },
        });
        if (!bloco) throw new NaoEncontrado();
        if (bloco.source === "RESERVATION" || bloco.reservationId) {
          throw new EhReserva();
        }

        await tx.availabilityBlock.update({
          where: { id: blockId },
          data: { releasedAt: new Date(), isBlocking: false },
        });

        await writeAudit(tx, {
          action: "availability.released",
          entityType: "AvailabilityBlock",
          entityId: blockId,
          actorUserId: actor.userId,
          before: {
            unitId: bloco.unitId,
            de: toDateOnly(bloco.startDate),
            ate: toDateOnly(bloco.endDate),
            origem: bloco.source,
          },
        });
      },
    );
  } catch (err) {
    let codigo: string = ERRO_CALENDARIO.falha;
    if (err instanceof EhReserva) codigo = ERRO_CALENDARIO.ehReserva;
    else if (err instanceof NaoEncontrado) codigo = ERRO_CALENDARIO.naoEncontrado;
    else logger.error({ err: (err as Error).message }, "Falha ao liberar bloqueio");

    redirect(`${destino}${destino.includes("?") ? "&" : "?"}erro=${codigo}`);
  }

  revalidatePath("/calendario");
  redirect(destino);
}
