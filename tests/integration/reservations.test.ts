import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { diasNoIntervalo, parseDateOnly, toDateOnly } from "@/lib/dates";
import { basePrisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/with-tenant";
import type { HospedeInput } from "@/lib/guests/schemas";
import type { ActorContext } from "@/lib/rbac/guard";
import {
  cancelarReserva,
  criarReserva,
  registrarCheckIn,
  registrarCheckOut,
  registrarPagamentoManual,
} from "@/lib/reservations/actions";
import {
  PrecoMudou,
  ReservaNaoEncontrada,
  TransicaoInvalida,
  UnidadeIndisponivel,
  UnidadeNaoEncontrada,
  UnidadeNaoVendavel,
} from "@/lib/reservations/errors";
import { listarReservas, obterReserva } from "@/lib/reservations/queries";
import {
  cleanupTenants,
  createTestProperty,
  createTestTenant,
  createTestUnit,
} from "../helpers/db";

/**
 * Fluxo vertical de reserva contra o banco de verdade (UC-040, UC-050).
 *
 * O que só um teste de integração prova: a garantia anti-overbooking é do
 * Postgres (RN-002) e não da aplicação; o cancelamento devolve a data ao
 * calendário (RN-005); e nada disso vaza entre empresas. Estas afirmações
 * dependem da constraint de exclusão, do RLS e das FKs compostas — todas
 * fora do alcance de um teste unitário.
 *
 * Precisa de Postgres no ar E do seed de papéis/permissões
 * (`npm run db:seed`), porque as escritas conferem permissão de verdade
 * pelo papel do usuário, sem atalho.
 */

const DIARIA_CENTS = 50_000;
const LIMPEZA_CENTS = 12_000;

/** 5 noites × 500,00 + 120,00 de limpeza. */
const TOTAL_5_NOITES = 5 * DIARIA_CENTS + LIMPEZA_CENTS;

type Cenario = {
  tenantId: string;
  userId: string;
  propertyId: string;
  unitId: string;
  ratePlanId: string;
  actor: ActorContext;
};

function hospede(nome: string): HospedeInput {
  return {
    firstName: nome,
    lastName: "Teste",
    email: `${nome.toLowerCase()}-${randomUUID().slice(0, 8)}@hospede.test`,
    phone: null,
    documentType: null,
    documentNumber: null,
    birthDate: null,
    nationality: null,
    country: "BR",
    notes: null,
    marketingOptIn: false,
  };
}

/**
 * Monta uma empresa completa: imóvel, unidade ativa, plano de tarifa
 * vigente e diárias publicadas para 2027 inteiro — noite sem `DailyRate` é
 * indisponível (RN-011), então sem isto nada é vendável.
 */
async function montarCenario(rotulo: string): Promise<Cenario> {
  const tenant = await createTestTenant(rotulo);
  const property = await createTestProperty(tenant.id, `Pousada ${rotulo}`);
  const unit = await createTestUnit(tenant.id, property.id, `${rotulo}-1`);

  const user = await basePrisma.user.create({
    data: {
      email: `op-${randomUUID().slice(0, 8)}@t.test`,
      name: `Operador ${rotulo}`,
    },
  });

  // Papel-template do seed: company_admin tem todas as permissões, que é o
  // que estes testes precisam exercitar (criar, cancelar, cobrar).
  const role = await basePrisma.role.findFirstOrThrow({
    where: { tenantId: null, slug: "company_admin" },
  });

  const ratePlanId = await withTenant({ tenantId: tenant.id }, async (tx) => {
    await tx.membership.create({
      data: { userId: user.id, roleId: role.id, status: "ACTIVE" },
    });

    const plano = await tx.ratePlan.create({
      data: {
        unitId: unit.id,
        code: "PADRAO",
        name: "Tarifa padrão",
        status: "ACTIVE",
        isDefault: true,
        cancellationPolicy: "MODERATE",
      },
    });

    const noites = diasNoIntervalo(
      parseDateOnly("2027-01-01"),
      parseDateOnly("2028-01-01"),
    );
    await tx.dailyRate.createMany({
      data: noites.map((date) => ({
        ratePlanId: plano.id,
        unitId: unit.id,
        date,
        priceCents: DIARIA_CENTS,
      })),
    });

    return plano.id;
  });

  return {
    tenantId: tenant.id,
    userId: user.id,
    propertyId: property.id,
    unitId: unit.id,
    ratePlanId,
    actor: {
      userId: user.id,
      tenantId: tenant.id,
      roleSlug: "company_admin",
      permVersion: 1,
    },
  };
}

describe("reservas — fluxo vertical", () => {
  let a: Cenario;
  let b: Cenario;

  const reservar = (
    cenario: Cenario,
    de: string,
    ate: string,
    extra: Partial<Parameters<typeof criarReserva>[1]> = {},
  ) =>
    criarReserva(cenario.actor, {
      unitId: cenario.unitId,
      checkIn: parseDateOnly(de),
      checkOut: parseDateOnly(ate),
      adults: 2,
      hospede: hospede("Ana"),
      ...extra,
    });

  beforeAll(async () => {
    a = await montarCenario("resA");
    b = await montarCenario("resB");
  }, 60_000);

  afterAll(async () => {
    await basePrisma.user.deleteMany({
      where: { id: { in: [a.userId, b.userId] } },
    });
    await cleanupTenants([a.tenantId, b.tenantId]);
    await basePrisma.$disconnect();
  });

  it("cria reserva PENDING com hold, bloqueio e preço do servidor", async () => {
    const reserva = await reservar(a, "2027-03-10", "2027-03-15");

    expect(reserva.status).toBe("PENDING");
    expect(reserva.code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
    expect(reserva.totalCents).toBe(TOTAL_5_NOITES);
    // RN-004: a reserva segura a unidade por 30 minutos.
    expect(reserva.holdExpiresAt).not.toBeNull();

    const detalhe = await obterReserva(a.actor, reserva.id);
    expect(detalhe?.nights).toBe(5);
    expect(detalhe?.nightlyTotalCents).toBe(5 * DIARIA_CENTS);
    expect(detalhe?.feesTotalCents).toBe(LIMPEZA_CENTS);
    // O snapshot guarda a conta noite a noite (RN-003).
    expect((detalhe?.quoteSnapshot as { noites: unknown[] }).noites).toHaveLength(5);

    // O bloqueio cobre exatamente a estadia, no intervalo semiaberto.
    expect(detalhe?.availabilityBlock?.isBlocking).toBe(true);
    expect(toDateOnly(detalhe!.availabilityBlock!.startDate)).toBe("2027-03-10");
    expect(toDateOnly(detalhe!.availabilityBlock!.endDate)).toBe("2027-03-15");

    // A trilha é lida DENTRO do tenant: `AuditLog` também está sob RLS, e
    // `basePrisma` conecta como `otatitan_app` sem `app.current_tenant_id`
    // fixado — a política nega tudo e a consulta volta vazia, dando a
    // impressão de que a auditoria não foi gravada (RN-010).
    const trilha = await withTenant(
      { tenantId: a.actor.tenantId, userId: a.actor.userId },
      (tx) =>
        tx.auditLog.findMany({
          where: { entityType: "Reservation", entityId: reserva.id },
          select: { action: true },
        }),
    );
    expect(trilha.map((t) => t.action)).toContain("reservation.created");
  });

  it("duas reservas concorrentes na mesma unidade: uma passa, a outra é recusada (RN-002)", async () => {
    const [uma, outra] = await Promise.allSettled([
      reservar(a, "2027-04-01", "2027-04-06", { hospede: hospede("Bruno") }),
      reservar(a, "2027-04-03", "2027-04-08", { hospede: hospede("Carla") }),
    ]);

    const aceitas = [uma, outra].filter((r) => r.status === "fulfilled");
    const recusadas = [uma, outra].filter((r) => r.status === "rejected");

    expect(aceitas).toHaveLength(1);
    expect(recusadas).toHaveLength(1);
    expect((recusadas[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      UnidadeIndisponivel,
    );
  });

  it("same-day turnover é permitido — sair e entrar no dia 15 (RN-001)", async () => {
    const primeira = await reservar(a, "2027-05-10", "2027-05-15", {
      hospede: hospede("Diego"),
    });
    const segunda = await reservar(a, "2027-05-15", "2027-05-20", {
      hospede: hospede("Elisa"),
    });

    expect(primeira.id).toBeTruthy();
    expect(segunda.id).toBeTruthy();
  });

  it("recusa total divergente do recalculado (RN-003)", async () => {
    await expect(
      reservar(a, "2027-06-01", "2027-06-06", {
        hospede: hospede("Fabio"),
        // O que o cliente "viu": 100,00 a menos do que a tarifa vigente.
        totalConferidoCents: TOTAL_5_NOITES - 10_000,
      }),
    ).rejects.toBeInstanceOf(PrecoMudou);

    // E o preço certo passa, com o mesmo pedido.
    const ok = await reservar(a, "2027-06-01", "2027-06-06", {
      hospede: hospede("Fabio"),
      totalConferidoCents: TOTAL_5_NOITES,
    });
    expect(ok.totalCents).toBe(TOTAL_5_NOITES);
  });

  it("noite sem tarifa publicada não é vendável (RN-011)", async () => {
    // 2028 está fora da janela de diárias criadas no cenário.
    await expect(
      reservar(a, "2028-02-10", "2028-02-13", { hospede: hospede("Gil") }),
    ).rejects.toBeInstanceOf(UnidadeNaoVendavel);
  });

  it("cancelar libera a data e permite reservar de novo (RN-005)", async () => {
    const original = await reservar(a, "2027-07-01", "2027-07-05", {
      hospede: hospede("Helena"),
    });

    // Enquanto vive, a reserva segura as datas.
    await expect(
      reservar(a, "2027-07-02", "2027-07-04", { hospede: hospede("Ivo") }),
    ).rejects.toBeInstanceOf(UnidadeIndisponivel);

    const cancelada = await cancelarReserva(
      a.actor,
      original.id,
      "Desistência do hóspede.",
    );
    expect(cancelada.aplicada).toBe(true);

    const depois = await obterReserva(a.actor, original.id);
    // A reserva permanece no histórico — nunca é apagada.
    expect(depois?.status).toBe("CANCELLED");
    expect(depois?.cancellationReason).toBe("Desistência do hóspede.");
    expect(depois?.availabilityBlock?.releasedAt).not.toBeNull();

    const rebook = await reservar(a, "2027-07-02", "2027-07-04", {
      hospede: hospede("Ivo"),
    });
    expect(rebook.id).toBeTruthy();
  });

  it("pagamento manual que quita a reserva a confirma (UC-050)", async () => {
    const reserva = await reservar(a, "2027-08-01", "2027-08-06", {
      hospede: hospede("Joana"),
    });

    // Sinal: não quita, não confirma — mas já protege o hold (RN-004).
    const sinal = await registrarPagamentoManual(a.actor, {
      reservationId: reserva.id,
      amountCents: 50_000,
      method: "PIX",
    });
    expect(sinal.confirmou).toBe(false);
    expect((await obterReserva(a.actor, reserva.id))?.status).toBe("PENDING");

    const quitacao = await registrarPagamentoManual(a.actor, {
      reservationId: reserva.id,
      amountCents: TOTAL_5_NOITES - 50_000,
      method: "BANK_TRANSFER",
    });
    expect(quitacao.confirmou).toBe(true);
    expect(quitacao.saldoCents).toBe(0);

    const confirmada = await obterReserva(a.actor, reserva.id);
    expect(confirmada?.status).toBe("CONFIRMED");
    expect(confirmada?.confirmedAt).not.toBeNull();
    // O hold morre com a confirmação: o job de expiração não pode mais
    // enxergar esta reserva como candidata.
    expect(confirmada?.holdExpiresAt).toBeNull();
    expect(confirmada?.payments).toHaveLength(2);
  });

  it("recusa pagamento acima do saldo devedor", async () => {
    const reserva = await reservar(a, "2027-08-20", "2027-08-23", {
      hospede: hospede("Karina"),
    });

    await expect(
      registrarPagamentoManual(a.actor, {
        reservationId: reserva.id,
        amountCents: reserva.totalCents + 1,
        method: "CASH",
      }),
    ).rejects.toThrow(/excede o saldo/i);
  });

  it("máquina de estados: não se cancela reserva com check-out feito", async () => {
    const reserva = await reservar(a, "2027-09-01", "2027-09-04", {
      hospede: hospede("Lucas"),
    });
    await registrarPagamentoManual(a.actor, {
      reservationId: reserva.id,
      amountCents: reserva.totalCents,
      method: "CASH",
    });

    await registrarCheckIn(a.actor, reserva.id);
    await registrarCheckOut(a.actor, reserva.id);

    await expect(
      cancelarReserva(a.actor, reserva.id, "Tarde demais."),
    ).rejects.toBeInstanceOf(TransicaoInvalida);

    // Check-in em reserva finalizada também não existe.
    await expect(registrarCheckIn(a.actor, reserva.id)).rejects.toBeInstanceOf(
      TransicaoInvalida,
    );
  });

  it("isolamento entre empresas: unidade e reserva da outra são inalcançáveis", async () => {
    const daOutra = await reservar(b, "2027-10-01", "2027-10-05", {
      hospede: hospede("Marina"),
    });

    // Criar na unidade da outra empresa: "não encontrada", não "proibido" —
    // responder 403 confirmaria que o id existe em algum lugar.
    await expect(
      criarReserva(a.actor, {
        unitId: b.unitId,
        checkIn: parseDateOnly("2027-11-01"),
        checkOut: parseDateOnly("2027-11-04"),
        adults: 2,
        hospede: hospede("Nadia"),
      }),
    ).rejects.toBeInstanceOf(UnidadeNaoEncontrada);

    expect(await obterReserva(a.actor, daOutra.id)).toBeNull();

    await expect(
      cancelarReserva(a.actor, daOutra.id, "tentativa"),
    ).rejects.toBeInstanceOf(ReservaNaoEncontrada);

    const listaDeA = await listarReservas(a.actor, { porPagina: 100 });
    expect(listaDeA.itens.map((r) => r.id)).not.toContain(daOutra.id);
  });

  it("listagem acha por código, por nome do hóspede e recorta por período", async () => {
    const reserva = await reservar(a, "2027-12-10", "2027-12-14", {
      hospede: { ...hospede("Otavio"), lastName: "Bittencourt" },
    });

    // O código é buscável com a formatação que aparece no e-mail.
    const porCodigo = await listarReservas(a.actor, {
      busca: reserva.codigoFormatado.toLowerCase(),
    });
    expect(porCodigo.itens.map((r) => r.id)).toContain(reserva.id);

    const porNome = await listarReservas(a.actor, {
      busca: "bittencourt otavio",
    });
    expect(porNome.itens.map((r) => r.id)).toContain(reserva.id);

    // Sobreposição, não data de início: o período pedido começa DEPOIS do
    // check-in e ainda assim tem de encontrar a estadia em curso.
    const emCurso = await listarReservas(a.actor, {
      de: parseDateOnly("2027-12-12"),
      ate: parseDateOnly("2027-12-13"),
      porPagina: 100,
    });
    expect(emCurso.itens.map((r) => r.id)).toContain(reserva.id);

    const foraDoPeriodo = await listarReservas(a.actor, {
      de: parseDateOnly("2027-12-20"),
      ate: parseDateOnly("2027-12-25"),
      porPagina: 100,
    });
    expect(foraDoPeriodo.itens.map((r) => r.id)).not.toContain(reserva.id);
  });
});
