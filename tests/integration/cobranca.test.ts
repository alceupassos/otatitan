import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { diasNoIntervalo, parseDateOnly } from "@/lib/dates";
import { basePrisma } from "@/lib/db/client";
import { withTenant } from "@/lib/db/with-tenant";
import type { HospedeInput } from "@/lib/guests/schemas";
import { abrirCobranca } from "@/lib/payments/cobranca";
import { CheckoutError } from "@/lib/payments/errors";
import { MINUTOS_DE_HOLD } from "@/lib/reservations/estados";
import type {
  CheckoutRequest,
  PaymentProviderAdapter,
} from "@/lib/payments/provider";
import type { ActorContext } from "@/lib/rbac/guard";
import {
  cancelarReserva,
  criarReserva,
  registrarPagamentoManual,
} from "@/lib/reservations/actions";
import {
  PagamentoInvalido,
  ReservaNaoEncontrada,
} from "@/lib/reservations/errors";
import {
  cleanupTenants,
  createTestProperty,
  createTestTenant,
  createTestUnit,
} from "../helpers/db";

/**
 * Cobrança por link contra o banco de verdade (UC-050).
 *
 * O que só um teste de integração prova: o valor cobrado sai do saldo
 * devedor apurado pelo servidor, a deduplicação do duplo submit é feita
 * pela unique `(tenantId, idempotencyKey)`, a trilha de auditoria nasce
 * dentro da mesma transação e nada disso alcança reserva de outra empresa
 * (RLS + FKs compostas). Nenhuma dessas afirmações caberia num teste
 * unitário.
 *
 * PROVEDOR SEMPRE FALSO. A chave do Asaas deste ambiente é de PRODUÇÃO:
 * uma cobrança criada por engano movimentaria dinheiro real. Por isso o
 * adapter é injetado em toda chamada e, por cima disso, `fetch` é
 * bloqueado no processo — se algum caminho tentar sair para a internet, o
 * teste falha em vez de cobrar alguém.
 */

const DIARIA_CENTS = 50_000;
const LIMPEZA_CENTS = 12_000;

/** 5 noites × 500,00 + 120,00 de limpeza. */
const TOTAL_5_NOITES = 5 * DIARIA_CENTS + LIMPEZA_CENTS;

type Cenario = {
  tenantId: string;
  userId: string;
  unitId: string;
  actor: ActorContext;
};

/** Adapter de pagamento de mentira, com o registro do que foi pedido a ele. */
function provedorFalso() {
  const estado = {
    chamadas: [] as CheckoutRequest[],
    /** Liga uma falha de rede na próxima abertura. */
    falharProximo: false,
    abertos: 0,
  };

  const adapter: PaymentProviderAdapter = {
    key: "ASAAS",
    async createCheckout(req) {
      estado.chamadas.push(req);
      if (estado.falharProximo) {
        estado.falharProximo = false;
        throw new CheckoutError(
          "Falha de rede ao abrir o checkout no Asaas: simulada pelo teste.",
        );
      }
      estado.abertos += 1;
      return {
        provider: "ASAAS",
        providerSessionId: `chk_${estado.abertos}`,
        redirectUrl: `https://checkout.test/chk_${estado.abertos}`,
      };
    },
    async parseWebhook() {
      throw new Error("parseWebhook não é exercitado neste teste.");
    },
  };

  return { adapter, estado };
}

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

/** Empresa completa e vendável: imóvel, unidade ativa e diárias de 2027. */
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

  const role = await basePrisma.role.findFirstOrThrow({
    where: { tenantId: null, slug: "company_admin" },
  });

  await withTenant({ tenantId: tenant.id }, async (tx) => {
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
  });

  return {
    tenantId: tenant.id,
    userId: user.id,
    unitId: unit.id,
    actor: {
      userId: user.id,
      tenantId: tenant.id,
      roleSlug: "company_admin",
      permVersion: 1,
    },
  };
}

describe("cobrança por link", () => {
  let a: Cenario;
  let b: Cenario;

  const reservar = (cenario: Cenario, de: string, ate: string, nome: string) =>
    criarReserva(cenario.actor, {
      unitId: cenario.unitId,
      checkIn: parseDateOnly(de),
      checkOut: parseDateOnly(ate),
      adults: 2,
      hospede: hospede(nome),
    });

  /** Pagamentos da reserva, do mais antigo ao mais novo. */
  const pagamentosDe = (cenario: Cenario, reservationId: string) =>
    withTenant({ tenantId: cenario.tenantId }, (tx) =>
      tx.payment.findMany({
        where: { reservationId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          provider: true,
          method: true,
          intent: true,
          status: true,
          amountCents: true,
          currency: true,
          providerSessionId: true,
          description: true,
          idempotencyKey: true,
        },
      }),
    );

  /**
   * A trilha é lida DENTRO do tenant: `AuditLog` está sob RLS e o
   * `basePrisma` conecta sem `app.current_tenant_id` fixado — a política
   * nega tudo e a consulta volta vazia, dando a falsa impressão de que a
   * auditoria não foi gravada (RN-010).
   */
  const trilhaDe = (cenario: Cenario, entityId: string) =>
    withTenant({ tenantId: cenario.tenantId, userId: cenario.userId }, (tx) =>
      tx.auditLog.findMany({
        where: { entityType: "Payment", entityId },
        select: { action: true, actorUserId: true },
      }),
    );

  beforeAll(async () => {
    a = await montarCenario("cobA");
    b = await montarCenario("cobB");

    // Rede proibida no processo inteiro: ver o aviso no topo do arquivo.
    vi.spyOn(globalThis, "fetch").mockImplementation((entrada) => {
      throw new Error(
        `Chamada de rede proibida neste teste: ${String(entrada)}`,
      );
    });
  }, 60_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await basePrisma.user.deleteMany({
      where: { id: { in: [a.userId, b.userId] } },
    });
    await cleanupTenants([a.tenantId, b.tenantId]);
    await basePrisma.$disconnect();
  });

  it("cobra o saldo devedor apurado no servidor e carimba tenant e pagamento no metadata", async () => {
    const reserva = await reservar(a, "2027-03-01", "2027-03-06", "Ana");

    // Sinal por fora: o saldo deixa de ser o total da reserva.
    await registrarPagamentoManual(a.actor, {
      reservationId: reserva.id,
      amountCents: 62_000,
      method: "PIX",
    });
    const saldo = TOTAL_5_NOITES - 62_000;

    const { adapter, estado } = provedorFalso();
    const cobranca = await abrirCobranca(a.actor, {
      reservationId: reserva.id,
      provider: adapter,
    });

    /**
     * RN-003 na forma mais forte possível: `abrirCobranca` não tem por onde
     * receber um valor. O que o cliente tinha na tela é irrelevante porque
     * nunca chega até aqui — o número sai de `saldoDevedorCents`.
     */
    expect(cobranca.amountCents).toBe(saldo);
    expect(cobranca.reaproveitada).toBe(false);
    expect(cobranca.redirectUrl).toBe("https://checkout.test/chk_1");

    expect(estado.chamadas).toHaveLength(1);
    const pedido = estado.chamadas[0];
    expect(pedido.amountCents).toBe(saldo);
    expect(pedido.currency).toBe("BRL");
    expect(pedido.reservationId).toBe(reserva.id);
    // Sem estes dois ids o webhook chegaria sem saber de quem é o dinheiro.
    expect(pedido.metadata.tenantId).toBe(a.tenantId);
    expect(pedido.metadata.paymentId).toBe(cobranca.paymentId);
    expect(pedido.idempotencyKey).toBe(`cobranca:${reserva.id}:1`);

    const [manual, link] = await pagamentosDe(a, reserva.id);
    expect(manual.provider).toBe("MANUAL");
    expect(link.id).toBe(cobranca.paymentId);
    // PENDING é o único status que aceita a baixa do webhook depois.
    expect(link.status).toBe("PENDING");
    expect(link.provider).toBe("ASAAS");
    expect(link.amountCents).toBe(saldo);
    // Já houve entrada parcial, então a natureza é saldo, não valor cheio.
    expect(link.intent).toBe("BALANCE");
    // Quem escolhe pix ou cartão é o pagador, na tela do provedor.
    expect(link.method).toBe("OTHER");
    expect(link.providerSessionId).toBe("chk_1");
    // A URL fica em `description` — compromisso documentado em cobranca.ts,
    // porque `Payment` não tem coluna para o link e sem persisti-lo não há
    // reaproveitamento possível.
    expect(link.description).toBe(cobranca.redirectUrl);
  });

  it("manda o pagador de volta para uma página pública, não para o painel", async () => {
    // Faixa própria: cada teste do arquivo ocupa um mês, senão a constraint
    // anti-overbooking (RN-002) recusa a segunda reserva — corretamente.
    const reserva = await reservar(a, "2027-12-01", "2027-12-06", "Íris");
    const { adapter, estado } = provedorFalso();

    await abrirCobranca(a.actor, {
      reservationId: reserva.id,
      provider: adapter,
    });

    const { successUrl, cancelUrl } = estado.chamadas[0];

    /**
     * O link de pagamento circula: quem abre é o operador, mas quem paga
     * costuma ser o hóspede, que não tem conta no painel. Um retorno para
     * `/reservas/[id]` o joga na tela de login logo depois de pagar — o
     * pior momento para pedir uma senha que ele não tem. Por isso as duas
     * URLs apontam para `/stays`, que é público (`PUBLIC_PREFIXES`).
     */
    for (const url of [successUrl, cancelUrl]) {
      expect(url).toContain("/stays/pagamento");
      expect(url).not.toContain("/reservas/");
    }
    // O cancelamento precisa ser distinguível: as instruções que o pagador
    // recebe são outras.
    expect(cancelUrl).toContain("estado=cancelado");
  });

  it("duplo submit reaproveita o link e não abre uma segunda cobrança", async () => {
    const reserva = await reservar(a, "2027-04-01", "2027-04-06", "Bruno");
    const { adapter, estado } = provedorFalso();

    const primeira = await abrirCobranca(a.actor, {
      reservationId: reserva.id,
      provider: adapter,
    });
    const segunda = await abrirCobranca(a.actor, {
      reservationId: reserva.id,
      provider: adapter,
    });

    expect(segunda.paymentId).toBe(primeira.paymentId);
    expect(segunda.redirectUrl).toBe(primeira.redirectUrl);
    expect(segunda.reaproveitada).toBe(true);

    // O provedor foi chamado UMA vez: sem isto o hóspede receberia dois
    // links e pagaria o que estivesse na tela dele.
    expect(estado.chamadas).toHaveLength(1);
    expect(await pagamentosDe(a, reserva.id)).toHaveLength(1);
  });

  it("saldo que mudou invalida o link aberto — nada de cobrar o valor antigo (RN-003)", async () => {
    const reserva = await reservar(a, "2027-05-01", "2027-05-06", "Carla");
    const { adapter, estado } = provedorFalso();

    const cheia = await abrirCobranca(a.actor, {
      reservationId: reserva.id,
      provider: adapter,
    });
    expect(cheia.amountCents).toBe(TOTAL_5_NOITES);
    // Nada pago ainda: a cobrança é do valor cheio.
    expect((await pagamentosDe(a, reserva.id))[0].intent).toBe("FULL");

    await registrarPagamentoManual(a.actor, {
      reservationId: reserva.id,
      amountCents: 100_000,
      method: "CASH",
    });

    const nova = await abrirCobranca(a.actor, {
      reservationId: reserva.id,
      provider: adapter,
    });
    expect(nova.paymentId).not.toBe(cheia.paymentId);
    expect(nova.amountCents).toBe(TOTAL_5_NOITES - 100_000);
    expect(estado.chamadas).toHaveLength(2);
    expect(estado.chamadas[1].idempotencyKey).toBe(`cobranca:${reserva.id}:2`);
  });

  it("hold vencido não abre nem reaproveita cobrança (RN-004)", async () => {
    const reserva = await reservar(a, "2027-06-01", "2027-06-06", "Diego");
    const { adapter, estado } = provedorFalso();

    await abrirCobranca(a.actor, {
      reservationId: reserva.id,
      provider: adapter,
    });
    expect(estado.chamadas).toHaveLength(1);

    // O link morre junto com o hold — `prazoDoLink` devolve o próprio
    // `holdExpiresAt` —, então não existe janela em que o link esteja morto
    // e a reserva ainda segure as datas. Passado o prazo, a resposta certa
    // não é abrir outro link: é recusar. O worker já devolveu a data ao
    // calendário, e um link novo cobraria por uma estadia que pode ter sido
    // revendida (RN-002).
    const depois = new Date(Date.now() + (MINUTOS_DE_HOLD + 1) * 60_000);
    await expect(
      abrirCobranca(a.actor, {
        reservationId: reserva.id,
        provider: adapter,
        agora: depois,
      }),
    ).rejects.toBeInstanceOf(PagamentoInvalido);

    // A recusa é anterior à rede: nenhuma cobrança nova foi aberta no
    // provedor.
    expect(estado.chamadas).toHaveLength(1);
  });

  it("reserva quitada é recusada com mensagem legível, sem cobrança de R$ 0", async () => {
    const reserva = await reservar(a, "2027-07-01", "2027-07-06", "Elisa");
    const quitacao = await registrarPagamentoManual(a.actor, {
      reservationId: reserva.id,
      amountCents: TOTAL_5_NOITES,
      method: "BANK_TRANSFER",
    });
    expect(quitacao.confirmou).toBe(true);

    const { adapter, estado } = provedorFalso();
    await expect(
      abrirCobranca(a.actor, {
        reservationId: reserva.id,
        provider: adapter,
      }),
    ).rejects.toBeInstanceOf(PagamentoInvalido);
    await expect(
      abrirCobranca(a.actor, {
        reservationId: reserva.id,
        provider: adapter,
      }),
    ).rejects.toThrow(/quitada/i);

    // Nem chegou ao provedor, e nenhum `Payment` de link foi criado.
    expect(estado.chamadas).toHaveLength(0);
    const pagamentos = await pagamentosDe(a, reserva.id);
    expect(pagamentos.every((p) => p.provider === "MANUAL")).toBe(true);
  });

  it("reserva cancelada não admite cobrança (máquina de estados)", async () => {
    const reserva = await reservar(a, "2027-08-01", "2027-08-06", "Fabio");
    await cancelarReserva(a.actor, reserva.id, "Desistência do hóspede.");

    const { adapter, estado } = provedorFalso();
    await expect(
      abrirCobranca(a.actor, {
        reservationId: reserva.id,
        provider: adapter,
      }),
    ).rejects.toBeInstanceOf(PagamentoInvalido);
    expect(estado.chamadas).toHaveLength(0);
  });

  it("grava a trilha da abertura e do reaproveitamento (RN-010)", async () => {
    const reserva = await reservar(a, "2027-09-01", "2027-09-06", "Gil");
    const { adapter } = provedorFalso();

    const cobranca = await abrirCobranca(a.actor, {
      reservationId: reserva.id,
      provider: adapter,
    });
    await abrirCobranca(a.actor, {
      reservationId: reserva.id,
      provider: adapter,
    });

    const trilha = await trilhaDe(a, cobranca.paymentId);
    const acoes = trilha.map((t) => t.action);
    expect(acoes).toContain("payment.checkout_opened");
    expect(acoes).toContain("payment.checkout_reused");
    // Quem abriu foi uma pessoa, não o provedor — a trilha precisa saber
    // distinguir isso de uma baixa vinda do webhook.
    expect(trilha.every((t) => t.actorUserId === a.userId)).toBe(true);
  });

  it("falha de rede deixa o pagamento recuperável e a próxima tentativa abre outro link", async () => {
    const reserva = await reservar(a, "2027-10-01", "2027-10-06", "Helena");
    const { adapter, estado } = provedorFalso();

    estado.falharProximo = true;
    await expect(
      abrirCobranca(a.actor, {
        reservationId: reserva.id,
        provider: adapter,
      }),
    ).rejects.toBeInstanceOf(CheckoutError);

    /**
     * O `Payment` fica PENDING de propósito. Uma resposta perdida é
     * indistinguível de uma requisição que nunca chegou: se o checkout
     * existir do outro lado e o hóspede pagar, só um status aberto aceita a
     * baixa do webhook. Fechá-lo aqui trocaria uma linha a mais no extrato
     * por um pagamento perdido em silêncio.
     */
    const [orfao] = await pagamentosDe(a, reserva.id);
    expect(orfao.status).toBe("PENDING");
    expect(orfao.providerSessionId).toBeNull();
    expect(orfao.idempotencyKey).toBe(`cobranca:${reserva.id}:1`);

    const segunda = await abrirCobranca(a.actor, {
      reservationId: reserva.id,
      provider: adapter,
    });
    expect(segunda.redirectUrl).toBe("https://checkout.test/chk_1");

    const pagamentos = await pagamentosDe(a, reserva.id);
    expect(pagamentos.map((p) => p.idempotencyKey)).toEqual([
      `cobranca:${reserva.id}:1`,
      `cobranca:${reserva.id}:2`,
    ]);
  });

  it("isolamento: reserva de outra empresa é inalcançável", async () => {
    const daOutra = await reservar(b, "2027-11-01", "2027-11-06", "Marina");
    const { adapter, estado } = provedorFalso();

    // "Não encontrada", nunca "proibido": responder 403 confirmaria que o
    // id existe na carteira de outra empresa.
    await expect(
      abrirCobranca(a.actor, {
        reservationId: daOutra.id,
        provider: adapter,
      }),
    ).rejects.toBeInstanceOf(ReservaNaoEncontrada);

    expect(estado.chamadas).toHaveLength(0);
    expect(await pagamentosDe(b, daOutra.id)).toHaveLength(0);
  });
});
