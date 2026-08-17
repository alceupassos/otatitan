import "server-only";
import { writeAudit } from "@/lib/audit/log";
import { withTenant } from "@/lib/db/with-tenant";
import { abrirCobranca } from "@/lib/payments/cobranca";
import { criarReserva } from "@/lib/reservations/actions";
import { PrecoMudou, UnidadeIndisponivel, UnidadeNaoVendavel } from "@/lib/reservations/errors";
import { MADRE914, publicBaseUrl } from "./config";
import { atorCanalDireto } from "./actor";
import { extrasDoPedido } from "./search";
import { resolverCanalDireto } from "./tenant";
import { guardarFotoResponsavel } from "@/lib/media/storage";
import type { ReservaPublica } from "./schemas";

export type ReservaPublicaCriada = {
  reservationId: string;
  code: string;
  totalCents: number;
  currency: string;
  redirectUrl: string | null;
  holdExpiresAt: Date | null;
  avisoPagamento?: string;
};

/**
 * Cria a reserva no canal direto e tenta abrir o checkout Asaas.
 *
 * O total da tela só confere (RN-003). Extras (PET, garagem, hóspede extra)
 * entram na cotação do servidor. Foto do responsável vai para Media
 * (S3 se houver, disco local senão) — nunca para o AuditLog.
 */
export async function reservarNoCanalDireto(
  pedido: ReservaPublica,
): Promise<ReservaPublicaCriada> {
  const canal = await resolverCanalDireto();
  const actor = atorCanalDireto(canal.tenantId);
  const hospedes = pedido.adults + pedido.children;

  const criada = await criarReserva(
    actor,
    {
      unitId: pedido.unitId,
      checkIn: pedido.checkIn,
      checkOut: pedido.checkOut,
      adults: pedido.adults,
      children: pedido.children,
      hospede: pedido.hospede,
      totalConferidoCents: pedido.totalConferidoCents,
      origem: "WEBSITE",
      ratePlanId: pedido.ratePlanId,
      extras: extrasDoPedido({
        pets: pedido.pets,
        parking: pedido.parking,
        hospedes,
      }),
      guestNotes: [
        pedido.pets > 0 ? `PETs: ${pedido.pets}` : null,
        pedido.parking ? "Garagem solicitada" : null,
      ]
        .filter(Boolean)
        .join(" · ") || null,
    },
    { autorizar: false },
  );

  await withTenant({ tenantId: canal.tenantId, userId: actor.userId }, async (tx) => {
    await tx.consent.createMany({
      data: [
        {
          subjectType: "GUEST",
          subjectId: criada.hospedeId,
          purpose: "privacy",
          granted: true,
          documentVersion: "madre914-politicas-v4",
        },
        {
          subjectType: "GUEST",
          subjectId: criada.hospedeId,
          purpose: "access_photo",
          granted: true,
          documentVersion: "madre914-foto-v4",
        },
      ],
    });

    await guardarFotoResponsavel({
      tx,
      tenantId: canal.tenantId,
      guestId: criada.hospedeId,
      reservationId: criada.id,
      base64: pedido.fotoResponsavelBase64,
    });

    await writeAudit(tx, {
      action: "direct_booking.created",
      entityType: "Reservation",
      entityId: criada.id,
      actorType: "SYSTEM",
      actorLabel: "canal-direto-madre914",
      after: {
        code: criada.code,
        unitId: pedido.unitId,
        pets: pedido.pets,
        parking: pedido.parking,
        totalCents: criada.totalCents,
        maxGuests: MADRE914.maxGuests,
      },
    });
  });

  try {
    const cobranca = await abrirCobranca(
      actor,
      {
        reservationId: criada.id,
        returnBaseUrl: publicBaseUrl(),
      },
      { autorizar: false },
    );
    return {
      reservationId: criada.id,
      code: criada.code,
      totalCents: cobranca.amountCents,
      currency: criada.currency,
      redirectUrl: cobranca.redirectUrl,
      holdExpiresAt: criada.holdExpiresAt,
    };
  } catch (err) {
    const aviso =
      err instanceof Error
        ? err.message
        : "Reserva criada, mas o link de pagamento não abriu. Fale no WhatsApp.";
    return {
      reservationId: criada.id,
      code: criada.code,
      totalCents: criada.totalCents,
      currency: criada.currency,
      redirectUrl: null,
      holdExpiresAt: criada.holdExpiresAt,
      avisoPagamento: aviso,
    };
  }
}

export { PrecoMudou, UnidadeIndisponivel, UnidadeNaoVendavel };
