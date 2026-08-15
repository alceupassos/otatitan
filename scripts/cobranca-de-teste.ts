/**
 * Cria uma reserva de valor baixo e abre a cobrança, para validar o fluxo
 * de pagamento ponta a ponta contra o provedor REAL.
 *
 * Existe porque nenhum teste automatizado toca a API do provedor — em
 * produção a chave move dinheiro de verdade, e um teste que cobra alguém
 * por engano é pior que um teste a menos. Esta é a verificação manual,
 * deliberada e rastreável que fecha essa lacuna.
 *
 * Uso (no servidor):
 *   docker compose -f docker-compose.prod.yml --env-file .env.production \
 *     run --rm --no-deps migrate \
 *     npx tsx scripts/cobranca-de-teste.ts --valor 500
 *
 *   --valor <centavos>   valor da diária. Padrão 500 (R$ 5,00).
 *   --unidade <código>   código interno da unidade. Padrão: a primeira.
 *   --email <e-mail>     hóspede de teste. Padrão: teste@<domínio do app>.
 *   --executar           SEM esta flag o script só mostra o que faria.
 *
 * O que ele faz, em ordem:
 *   1. escolhe uma unidade e uma data livre BEM no futuro, para não
 *      esbarrar em venda real (a constraint GiST recusaria, mas o ponto é
 *      não ocupar data vendável);
 *   2. publica UMA diária no valor pedido, num plano próprio de teste;
 *   3. cria a reserva pelo `criarReserva` de verdade — mesma função da
 *      tela, com hold, bloqueio e auditoria;
 *   4. abre a cobrança pelo `abrirCobranca` de verdade e imprime o link.
 *
 * Depois de pagar (ou desistir), CANCELE a reserva pelo painel: ela segura
 * uma data real até o hold expirar.
 */
import Module from "node:module";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { describePaymentConfig, loadPaymentConfig } from "../src/lib/payments/config";
import type { ActorContext } from "../src/lib/rbac/guard";
import type { RoleSlug } from "../src/lib/rbac/roles";
import { formatMoney } from "../src/lib/money";

/**
 * Neutraliza o `server-only` antes de carregar o domínio.
 *
 * O pacote real lança ao ser importado fora de um Server Component — que é
 * o que se quer na aplicação e é exatamente o que impede este script, Node
 * puro, de usar `criarReserva` e `abrirCobranca`. Os testes resolvem com um
 * alias no Vitest (`tests/helpers/server-only-stub.ts`); aqui não há
 * bundler, então o jeito é interceptar a resolução.
 *
 * A proteção continua valendo onde importa: no build da aplicação. E o
 * import do domínio é DINÂMICO logo abaixo de propósito — um `import`
 * estático é içado para antes deste patch e voltaria a estourar.
 */
type CarregadorDeModulo = (this: unknown, pedido: string, ...resto: unknown[]) => unknown;
const interno = Module as unknown as { _load: CarregadorDeModulo };
const carregarOriginal = interno._load;
interno._load = function (this: unknown, pedido: string, ...resto: unknown[]) {
  if (pedido === "server-only") return {};
  return carregarOriginal.call(this, pedido, ...resto);
};

/**
 * Os imports do domínio ficam DENTRO da função: precisam acontecer depois
 * do patch acima, e `await` no topo do arquivo não compila aqui (o tsx
 * emite CJS, porque o projeto não declara `"type": "module"`).
 */
async function carregarDominio() {
  const [{ withTenant }, { abrirCobranca }, { criarReserva }] = await Promise.all([
    import("../src/lib/db/with-tenant"),
    import("../src/lib/payments/cobranca"),
    import("../src/lib/reservations/actions"),
  ]);
  return { withTenant, abrirCobranca, criarReserva };
}

function arg(chave: string): string | undefined {
  const i = process.argv.indexOf(`--${chave}`);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : undefined;
}
const temFlag = (f: string) => process.argv.includes(`--${f}`);

const VALOR_CENTS = Number(arg("valor") ?? 500);
const CODIGO_UNIDADE = arg("unidade");
const EXECUTAR = temFlag("executar");

/**
 * Teto de segurança. Este script existe para gastar pouco de propósito; um
 * dedo trêmulo em `--valor` não pode virar uma cobrança de mil reais.
 */
const TETO_CENTS = 2_000;

async function main() {
  if (!Number.isInteger(VALOR_CENTS) || VALOR_CENTS <= 0) {
    throw new Error("--valor precisa ser um inteiro de centavos maior que zero.");
  }
  if (VALOR_CENTS > TETO_CENTS) {
    throw new Error(
      `--valor ${VALOR_CENTS} passa do teto de ${TETO_CENTS} centavos deste ` +
        "script. Se a intenção é cobrar mais, use a tela de reservas.",
    );
  }

  const config = loadPaymentConfig();
  console.log(`Provedor: ${describePaymentConfig(config)}`);
  if (config.provider === "MANUAL") {
    throw new Error(
      "O provedor ativo é o manual, que não gera link. Configure o Asaas em " +
        ".env.production (ver .env.production.example) e suba de novo.",
    );
  }

  const { withTenant, abrirCobranca, criarReserva } = await carregarDominio();

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_MIGRATE_URL });
  const db = new PrismaClient({ adapter });

  // Como otatitan_owner: precisamos ler tenant/membership ANTES de existir
  // contexto de tenant — mesmo motivo do seed e do create-tenant.
  const tenant = await db.tenant.findFirst({
    where: { deletedAt: null },
    select: { id: true, name: true, permVersion: true },
    orderBy: { createdAt: "asc" },
  });
  if (!tenant) throw new Error("Nenhuma empresa cadastrada. Rode tenant:create antes.");

  const membership = await db.membership.findFirst({
    where: { tenantId: tenant.id, status: "ACTIVE" },
    select: { userId: true, role: { select: { slug: true } } },
  });
  if (!membership) {
    throw new Error(
      `A empresa "${tenant.name}" não tem nenhum membro ativo — não há ator ` +
        "em nome de quem criar a reserva.",
    );
  }

  const actor: ActorContext = {
    userId: membership.userId,
    tenantId: tenant.id,
    roleSlug: membership.role.slug as RoleSlug,
    permVersion: tenant.permVersion,
  };

  const unidade = await db.unit.findFirst({
    where: {
      tenantId: tenant.id,
      status: { not: "ARCHIVED" },
      ...(CODIGO_UNIDADE ? { internalCode: CODIGO_UNIDADE } : {}),
    },
    select: {
      id: true,
      name: true,
      internalCode: true,
      currency: true,
      maxGuests: true,
      property: { select: { name: true } },
    },
    orderBy: { internalCode: "asc" },
  });
  if (!unidade) {
    throw new Error(
      CODIGO_UNIDADE
        ? `Unidade "${CODIGO_UNIDADE}" não encontrada.`
        : "Nenhuma unidade cadastrada.",
    );
  }

  /**
   * Data bem à frente e fora de temporada: a reserva vai segurar essa data
   * de verdade até alguém cancelá-la, e ocupar um feriado por engano seria
   * um prejuízo real, não um detalhe de teste.
   */
  const checkIn = new Date(Date.UTC(new Date().getUTCFullYear() + 3, 4, 12));
  const checkOut = new Date(Date.UTC(new Date().getUTCFullYear() + 3, 4, 13));
  const dia = checkIn.toISOString().slice(0, 10);

  console.log(
    [
      "",
      `Empresa:  ${tenant.name}`,
      `Imóvel:   ${unidade.property.name}`,
      `Unidade:  ${unidade.internalCode} — ${unidade.name}`,
      `Estadia:  ${dia} → ${checkOut.toISOString().slice(0, 10)} (1 noite)`,
      `Diária:   ${formatMoney(VALOR_CENTS, unidade.currency)}`,
      "",
    ].join("\n"),
  );

  if (!EXECUTAR) {
    console.log("Simulação — nada foi criado. Repita com --executar para valer.");
    await db.$disconnect();
    return;
  }

  // ── Tarifa ────────────────────────────────────────────────────────────
  // Sem `DailyRate` publicada a noite é invendável (RN-011), então o plano
  // e a diária vêm antes da reserva. Plano próprio, com código explícito,
  // para não contaminar a precificação real da unidade.
  const CODIGO_PLANO = "TESTE-COBRANCA";
  await withTenant({ tenantId: actor.tenantId, userId: actor.userId }, async (tx) => {
    const plano = await tx.ratePlan.upsert({
      where: {
        tenantId_unitId_code: {
          tenantId: actor.tenantId,
          unitId: unidade.id,
          code: CODIGO_PLANO,
        },
      },
      update: { status: "ACTIVE" },
      create: {
        unitId: unidade.id,
        code: CODIGO_PLANO,
        name: "Validação de cobrança",
        currency: unidade.currency,
        status: "ACTIVE",
        minNights: 1,
        cancellationPolicy: "FLEXIBLE",
      },
      select: { id: true },
    });

    await tx.dailyRate.upsert({
      where: {
        tenantId_ratePlanId_unitId_date: {
          tenantId: actor.tenantId,
          ratePlanId: plano.id,
          unitId: unidade.id,
          date: checkIn,
        },
      },
      update: { priceCents: VALOR_CENTS, isClosed: false },
      create: {
        ratePlanId: plano.id,
        unitId: unidade.id,
        date: checkIn,
        priceCents: VALOR_CENTS,
        currency: unidade.currency,
        minNights: 1,
        source: "MANUAL",
        sourceNote: "Validação do fluxo de pagamento",
      },
    });
  });
  console.log(`✔ Tarifa de ${formatMoney(VALOR_CENTS, unidade.currency)} publicada em ${dia}.`);

  // ── Reserva ───────────────────────────────────────────────────────────
  /**
   * Uma tentativa anterior pode ter criado a reserva e falhado só na
   * cobrança (provedor fora do ar, URL recusada). A reserva sobrevive e
   * SEGURA a data — rodar de novo esbarraria na constraint anti-overbooking
   * contra a nossa própria reserva, e a mensagem ("datas ocupadas") mandaria
   * procurar um conflito que não existe. Reaproveitar é o comportamento
   * certo: é a mesma venda, retomada.
   */
  const jaExiste = await db.reservation.findFirst({
    where: {
      tenantId: actor.tenantId,
      unitId: unidade.id,
      checkIn,
      status: "PENDING",
    },
    select: { id: true, code: true, totalCents: true, currency: true, holdExpiresAt: true },
  });

  if (jaExiste) {
    console.log(
      `↺ Reserva ${jaExiste.code} já existia para esta data — retomando a ` +
        "cobrança dela em vez de criar outra.",
    );
    const cobrancaExistente = await abrirCobranca(actor, { reservationId: jaExiste.id });
    imprimirLink(cobrancaExistente, jaExiste.code, jaExiste.holdExpiresAt);
    await db.$disconnect();
    return;
  }

  const reserva = await criarReserva(actor, {
    unitId: unidade.id,
    checkIn,
    checkOut,
    adults: 1,
    hospede: {
      firstName: "Teste",
      lastName: "Cobrança",
      email: arg("email") ?? "teste-cobranca@otatitan.local",
      phone: null,
      // Sem documento: a ficha é descartável e documento de hóspede é dado
      // sensível (LGPD) — não se inventa um só para preencher campo.
      documentType: null,
      documentNumber: null,
      birthDate: null,
      nationality: null,
      country: "BR",
      notes: "Cadastro de teste do fluxo de pagamento.",
      // Consentimento nunca é marcado por nós.
      marketingOptIn: false,
    },
    origem: "DIRECT",
    internalNotes:
      "Reserva criada por scripts/cobranca-de-teste.ts para validar o " +
      "fluxo de pagamento. Cancelar depois do teste.",
  });

  console.log(
    `✔ Reserva ${reserva.codigoFormatado} criada — ` +
      `${formatMoney(reserva.totalCents, reserva.currency)}, ` +
      `hold até ${reserva.holdExpiresAt?.toISOString() ?? "—"}.`,
  );

  // ── Cobrança ──────────────────────────────────────────────────────────
  const cobranca = await abrirCobranca(actor, { reservationId: reserva.id });
  imprimirLink(cobranca, reserva.codigoFormatado, reserva.holdExpiresAt);

  await db.$disconnect();
}

function imprimirLink(
  cobranca: { redirectUrl: string; amountCents: number; currency: string },
  codigo: string,
  holdExpiresAt: Date | null,
) {
  console.log(
    [
      "",
      "═".repeat(64),
      `LINK DE PAGAMENTO — ${formatMoney(cobranca.amountCents, cobranca.currency)}`,
      "",
      cobranca.redirectUrl,
      "═".repeat(64),
      "",
      `Reserva:  ${codigo}`,
      `Expira:   junto com o hold (${holdExpiresAt?.toISOString() ?? "—"})`,
      "",
      "Depois de pagar, a reserva confirma sozinha pelo webhook.",
      "Se desistir, CANCELE a reserva no painel — ela segura a data até o",
      "hold vencer.",
    ].join("\n"),
  );
}

main().catch((err) => {
  console.error(`\n❌ ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
