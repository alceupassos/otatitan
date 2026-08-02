/**
 * Seed do Otatitan — `npm run db:seed`.
 *
 * Roda como `otatitan_owner` (DATABASE_MIGRATE_URL), a única role com
 * BYPASSRLS: o seed grava catálogo global (sem tenant) e dados de vários
 * tenants na mesma execução, o que é justamente o que o RLS impede para a
 * role de runtime. Por isso NÃO usa `src/lib/db/client.ts` nem
 * `withTenant(...)` — aqui todo `tenantId` é passado explicitamente.
 *
 * É idempotente: rodar de novo converge para o mesmo estado, sem duplicar.
 * As linhas de catálogo com `tenantId` nulo (Role-template, Amenity) usam
 * find-then-create em vez de upsert porque o índice único do Postgres trata
 * NULL como distinto — um upsert criaria uma cópia a cada execução.
 *
 * Fonte de verdade das permissões/papéis: src/lib/rbac/* e
 * docs/07-matriz-permissoes.md. Nunca escrever a lista à mão aqui.
 */
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  PERMISSION_CODES,
  describePermission,
  parsePermission,
  type PermissionCode,
} from "../src/lib/rbac/permissions";
import {
  ROLE_LABELS,
  ROLE_SLUGS,
  SYSTEM_ROLES,
  type RoleSlug,
} from "../src/lib/rbac/roles";

const connectionString =
  process.env.DATABASE_MIGRATE_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_MIGRATE_URL (ou DATABASE_URL) não definida — o seed precisa da role dona do schema.",
  );
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/** Senha única de todos os usuários demo — só para ambiente local. */
const DEMO_PASSWORD = "Otatitan@2026";
/**
 * Janela de tarifas gerada em torno de hoje. Começa no passado de propósito:
 * as reservas demo já concluídas precisam ter diária publicada, senão o
 * histórico e os relatórios nascem zerados.
 */
const RATE_WINDOW_PAST_DAYS = 60;
const RATE_WINDOW_FUTURE_DAYS = 180;

const MS_DAY = 86_400_000;

function today(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * MS_DAY);
}

function nightsBetween(checkIn: Date, checkOut: Date): number {
  return Math.round((checkOut.getTime() - checkIn.getTime()) / MS_DAY);
}

function eachNight(checkIn: Date, checkOut: Date): Date[] {
  const dates: Date[] = [];
  for (let t = checkIn.getTime(); t < checkOut.getTime(); t += MS_DAY) {
    dates.push(new Date(t));
  }
  return dates;
}

/**
 * Tarifa do dia a partir da diária base: fim de semana +35%, alta temporada
 * (20/dez a 05/mar) +60%, arredondado para real inteiro. É só uma curva
 * plausível para a demo — a precificação real é de PricingRule (v2).
 */
function priceForDate(baseCents: number, date: Date): number {
  const weekday = date.getUTCDay();
  let price = baseCents;
  if (weekday === 5 || weekday === 6) price = price * 1.35;

  const monthDay = (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
  if (monthDay >= 1220 || monthDay <= 305) price = price * 1.6;

  return Math.round(price / 100) * 100;
}

function money(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Catálogo global (sem tenant)
// ─────────────────────────────────────────────────────────────────────────

async function seedPermissions(): Promise<Map<PermissionCode, string>> {
  for (const code of PERMISSION_CODES) {
    const { module, action } = parsePermission(code);
    await db.permission.upsert({
      where: { code },
      update: { module, action, description: describePermission(code) },
      create: { code, module, action, description: describePermission(code) },
    });
  }

  const rows = await db.permission.findMany({ select: { id: true, code: true } });
  return new Map(rows.map((r) => [r.code as PermissionCode, r.id]));
}

/**
 * Alinha as permissões de um papel com a matriz — remove as que sobraram e
 * cria as que faltam. Sem isso, tirar uma permissão de docs/07 não teria
 * efeito nenhum em banco já semeado.
 */
async function syncRolePermissions(
  roleId: string,
  codes: readonly PermissionCode[],
  permissionIds: Map<PermissionCode, string>,
): Promise<void> {
  const wanted = new Set(
    codes.map((code) => {
      const id = permissionIds.get(code);
      if (!id) throw new Error(`Permissão desconhecida no catálogo: ${code}`);
      return id;
    }),
  );

  const current = await db.rolePermission.findMany({
    where: { roleId },
    select: { permissionId: true },
  });
  const currentIds = new Set(current.map((rp) => rp.permissionId));

  const toRemove = [...currentIds].filter((id) => !wanted.has(id));
  if (toRemove.length > 0) {
    await db.rolePermission.deleteMany({
      where: { roleId, permissionId: { in: toRemove } },
    });
  }

  const toAdd = [...wanted].filter((id) => !currentIds.has(id));
  if (toAdd.length > 0) {
    await db.rolePermission.createMany({
      data: toAdd.map((permissionId) => ({ roleId, permissionId })),
      skipDuplicates: true,
    });
  }
}

const ROLE_DESCRIPTIONS: Record<RoleSlug, string> = {
  company_admin: "Acesso total ao tenant, incluindo usuários, papéis e auditoria.",
  reservations_manager: "Opera reservas, disponibilidade, tarifas e imóveis.",
  sales_agent: "Atende e cria reservas; não altera tarifas nem configurações.",
  finance: "Pagamentos, reembolsos, relatórios financeiros e auditoria.",
  operations_coordinator: "Coordena tarefas de limpeza, manutenção e vistoria.",
  cleaning_staff: "Vê e atualiza apenas as próprias tarefas de limpeza.",
  maintenance_staff: "Vê e atualiza apenas as próprias tarefas de manutenção.",
  property_owner: "Portal do proprietário: apenas os próprios imóveis.",
  guest: "Portal do hóspede: apenas a própria reserva.",
};

/** Papéis-template de sistema (tenantId nulo), clonados por tenant. */
async function seedRoleTemplates(
  permissionIds: Map<PermissionCode, string>,
): Promise<void> {
  for (const slug of ROLE_SLUGS) {
    const existing = await db.role.findFirst({ where: { tenantId: null, slug } });
    const role =
      existing ??
      (await db.role.create({
        data: {
          tenantId: null,
          slug,
          name: ROLE_LABELS[slug],
          description: ROLE_DESCRIPTIONS[slug],
          isSystem: true,
        },
      }));

    if (existing) {
      await db.role.update({
        where: { id: role.id },
        data: {
          name: ROLE_LABELS[slug],
          description: ROLE_DESCRIPTIONS[slug],
          isSystem: true,
        },
      });
    }

    await syncRolePermissions(role.id, SYSTEM_ROLES[slug], permissionIds);
  }
}

type AmenitySeed = {
  slug: string;
  name: string;
  category:
    | "ESSENTIALS"
    | "KITCHEN"
    | "OUTDOOR"
    | "LEISURE"
    | "ACCESSIBILITY"
    | "SAFETY"
    | "OTHER";
  icon: string;
};

const GLOBAL_AMENITIES: AmenitySeed[] = [
  { slug: "wifi", name: "Wi-Fi", category: "ESSENTIALS", icon: "wifi" },
  { slug: "ar-condicionado", name: "Ar-condicionado", category: "ESSENTIALS", icon: "air-vent" },
  { slug: "roupa-de-cama", name: "Roupa de cama", category: "ESSENTIALS", icon: "bed-double" },
  { slug: "tv-smart", name: "Smart TV", category: "ESSENTIALS", icon: "tv" },
  { slug: "maquina-lavar", name: "Máquina de lavar", category: "ESSENTIALS", icon: "washing-machine" },
  { slug: "cozinha-equipada", name: "Cozinha equipada", category: "KITCHEN", icon: "cooking-pot" },
  { slug: "lava-loucas", name: "Lava-louças", category: "KITCHEN", icon: "utensils" },
  { slug: "cafeteira", name: "Cafeteira", category: "KITCHEN", icon: "coffee" },
  { slug: "churrasqueira", name: "Churrasqueira", category: "OUTDOOR", icon: "flame" },
  { slug: "varanda", name: "Varanda", category: "OUTDOOR", icon: "sun" },
  { slug: "vista-mar", name: "Vista para o mar", category: "OUTDOOR", icon: "waves" },
  { slug: "acesso-praia", name: "Acesso à praia", category: "OUTDOOR", icon: "palmtree" },
  { slug: "piscina", name: "Piscina", category: "LEISURE", icon: "waves" },
  { slug: "academia", name: "Academia", category: "LEISURE", icon: "dumbbell" },
  { slug: "estacionamento", name: "Estacionamento", category: "OTHER", icon: "car" },
  { slug: "pet-friendly", name: "Aceita pets", category: "OTHER", icon: "paw-print" },
  { slug: "berco", name: "Berço", category: "ACCESSIBILITY", icon: "baby" },
  { slug: "elevador", name: "Elevador", category: "ACCESSIBILITY", icon: "move-vertical" },
  { slug: "portaria-24h", name: "Portaria 24h", category: "SAFETY", icon: "shield-check" },
  { slug: "extintor", name: "Extintor de incêndio", category: "SAFETY", icon: "fire-extinguisher" },
];

async function seedGlobalAmenities(): Promise<Map<string, string>> {
  for (const amenity of GLOBAL_AMENITIES) {
    const existing = await db.amenity.findFirst({
      where: { tenantId: null, slug: amenity.slug },
    });
    if (existing) {
      await db.amenity.update({
        where: { id: existing.id },
        data: { name: amenity.name, category: amenity.category, icon: amenity.icon },
      });
    } else {
      await db.amenity.create({ data: { tenantId: null, ...amenity } });
    }
  }

  const rows = await db.amenity.findMany({
    where: { tenantId: null },
    select: { id: true, slug: true },
  });
  return new Map(rows.map((a) => [a.slug, a.id]));
}

// ─────────────────────────────────────────────────────────────────────────
// Tenants demo
// ─────────────────────────────────────────────────────────────────────────

type UserSeed = {
  email: string;
  name: string;
  role: RoleSlug;
};

type UnitSeed = {
  internalCode: string;
  name: string;
  maxGuests: number;
  bedrooms: number;
  beds: number;
  bathrooms: number;
  sizeM2: number;
  baseRateCents: number;
  cleaningFeeCents: number;
  minNights: number;
  amenities: string[];
};

type PropertySeed = {
  slug: string;
  name: string;
  type: "APARTMENT" | "HOUSE" | "CONDO" | "FLAT" | "ROOM" | "OTHER";
  description: string;
  city: string;
  state: string;
  neighborhood: string;
  addressLine1: string;
  units: UnitSeed[];
};

type TenantSeed = {
  slug: string;
  name: string;
  legalName: string;
  taxId: string;
  users: UserSeed[];
  ownerName: string;
  ownerEmail: string;
  /** E-mail do usuário ligado ao Owner (portal do proprietário). */
  ownerUserEmail?: string;
  properties: PropertySeed[];
  reservationPrefix: string;
};

const TENANTS: TenantSeed[] = [
  {
    slug: "costa-verde",
    name: "Costa Verde Temporada",
    legalName: "Costa Verde Administração de Imóveis LTDA",
    taxId: "12.345.678/0001-90",
    reservationPrefix: "CV",
    ownerName: "Helena Duarte",
    ownerEmail: "helena.duarte@exemplo.com.br",
    ownerUserEmail: "proprietario@costaverde.com.br",
    users: [
      { email: "admin@costaverde.com.br", name: "Ana Ribeiro", role: "company_admin" },
      { email: "reservas@costaverde.com.br", name: "Bruno Tavares", role: "reservations_manager" },
      { email: "vendas@costaverde.com.br", name: "Carla Nunes", role: "sales_agent" },
      { email: "financeiro@costaverde.com.br", name: "Diego Prado", role: "finance" },
      { email: "operacoes@costaverde.com.br", name: "Elisa Moraes", role: "operations_coordinator" },
      { email: "limpeza@costaverde.com.br", name: "Fátima Souza", role: "cleaning_staff" },
      { email: "manutencao@costaverde.com.br", name: "Gilberto Lima", role: "maintenance_staff" },
      { email: "proprietario@costaverde.com.br", name: "Helena Duarte", role: "property_owner" },
      { email: "hospede@exemplo.com.br", name: "Igor Fontes", role: "guest" },
    ],
    properties: [
      {
        slug: "residencial-enseada",
        name: "Residencial Enseada",
        type: "CONDO",
        description:
          "Condomínio pé na areia na Enseada, com piscina e portaria 24h. A 200 m do centrinho.",
        city: "Angra dos Reis",
        state: "RJ",
        neighborhood: "Enseada",
        addressLine1: "Rua das Palmeiras, 120",
        units: [
          {
            internalCode: "ENS-101",
            name: "Apto 101 — Vista Mar",
            maxGuests: 6,
            bedrooms: 3,
            beds: 4,
            bathrooms: 2,
            sizeM2: 92,
            baseRateCents: 68_000,
            cleaningFeeCents: 15_000,
            minNights: 2,
            amenities: [
              "wifi",
              "ar-condicionado",
              "tv-smart",
              "cozinha-equipada",
              "vista-mar",
              "piscina",
              "estacionamento",
              "portaria-24h",
              "elevador",
            ],
          },
          {
            internalCode: "ENS-102",
            name: "Apto 102 — Jardim",
            maxGuests: 4,
            bedrooms: 2,
            beds: 3,
            bathrooms: 1,
            sizeM2: 64,
            baseRateCents: 45_000,
            cleaningFeeCents: 12_000,
            minNights: 2,
            amenities: [
              "wifi",
              "ar-condicionado",
              "tv-smart",
              "cozinha-equipada",
              "piscina",
              "estacionamento",
              "portaria-24h",
              "pet-friendly",
            ],
          },
        ],
      },
      {
        slug: "casa-vista-mar-paraty",
        name: "Casa Vista Mar",
        type: "HOUSE",
        description:
          "Casa de 4 suítes com churrasqueira e acesso privativo à praia, no Centro Histórico de Paraty.",
        city: "Paraty",
        state: "RJ",
        neighborhood: "Centro Histórico",
        addressLine1: "Travessa do Comércio, 45",
        units: [
          {
            internalCode: "VM-CASA",
            name: "Casa inteira",
            maxGuests: 10,
            bedrooms: 4,
            beds: 6,
            bathrooms: 4,
            sizeM2: 210,
            baseRateCents: 145_000,
            cleaningFeeCents: 32_000,
            minNights: 3,
            amenities: [
              "wifi",
              "ar-condicionado",
              "tv-smart",
              "cozinha-equipada",
              "lava-loucas",
              "churrasqueira",
              "varanda",
              "vista-mar",
              "acesso-praia",
              "estacionamento",
              "berco",
            ],
          },
        ],
      },
    ],
  },
  {
    // Segundo tenant: existe para que o isolamento seja visível na própria
    // UI (dados que o tenant 1 nunca pode enxergar), não só nos testes.
    slug: "ilha-azul",
    name: "Ilha Azul Locações",
    legalName: "Ilha Azul Locações por Temporada ME",
    taxId: "98.765.432/0001-10",
    reservationPrefix: "IA",
    ownerName: "Marcos Vilela",
    ownerEmail: "marcos.vilela@exemplo.com.br",
    users: [
      { email: "admin@ilhaazul.com.br", name: "Juliana Cordeiro", role: "company_admin" },
      { email: "reservas@ilhaazul.com.br", name: "Rafael Antunes", role: "reservations_manager" },
    ],
    properties: [
      {
        slug: "chale-ilha-grande",
        name: "Chalé Ilha Grande",
        type: "HOUSE",
        description: "Chalé de madeira a 5 minutos da Vila do Abraão, cercado de mata atlântica.",
        city: "Angra dos Reis",
        state: "RJ",
        neighborhood: "Vila do Abraão",
        addressLine1: "Caminho da Praia Preta, s/n",
        units: [
          {
            internalCode: "IG-CHALE",
            name: "Chalé completo",
            maxGuests: 4,
            bedrooms: 2,
            beds: 2,
            bathrooms: 1,
            sizeM2: 58,
            baseRateCents: 52_000,
            cleaningFeeCents: 10_000,
            minNights: 2,
            amenities: ["wifi", "varanda", "acesso-praia", "cozinha-equipada", "pet-friendly"],
          },
        ],
      },
    ],
  },
];

type SeededUnit = {
  id: string;
  propertyId: string;
  internalCode: string;
  ratePlanId: string;
  baseRateCents: number;
  cleaningFeeCents: number;
  /** Tarifa por dia (chave = YYYY-MM-DD), já com a curva aplicada. */
  rates: Map<string, number>;
};

async function seedTenant(
  tenant: TenantSeed,
  amenityIds: Map<string, string>,
  passwordHash: string,
): Promise<void> {
  const row = await db.tenant.upsert({
    where: { slug: tenant.slug },
    update: { name: tenant.name, legalName: tenant.legalName, taxId: tenant.taxId },
    create: {
      slug: tenant.slug,
      name: tenant.name,
      legalName: tenant.legalName,
      taxId: tenant.taxId,
      status: "ACTIVE",
    },
  });
  const tenantId = row.id;

  // ── Papéis do tenant (cópia dos templates) ──────────────────────────────
  const permissionIds = new Map<PermissionCode, string>(
    (await db.permission.findMany({ select: { id: true, code: true } })).map((p) => [
      p.code as PermissionCode,
      p.id,
    ]),
  );

  const roleIds = new Map<RoleSlug, string>();
  for (const slug of ROLE_SLUGS) {
    const role = await db.role.upsert({
      where: { tenantId_slug: { tenantId, slug } },
      update: { name: ROLE_LABELS[slug], description: ROLE_DESCRIPTIONS[slug], isSystem: true },
      create: {
        tenantId,
        slug,
        name: ROLE_LABELS[slug],
        description: ROLE_DESCRIPTIONS[slug],
        isSystem: true,
      },
    });
    roleIds.set(slug, role.id);
    await syncRolePermissions(role.id, SYSTEM_ROLES[slug], permissionIds);
  }

  // ── Usuários e vínculos ─────────────────────────────────────────────────
  const userIds = new Map<string, string>();
  for (const user of tenant.users) {
    const created = await db.user.upsert({
      where: { email: user.email },
      update: { name: user.name },
      create: {
        email: user.email,
        name: user.name,
        passwordHash,
        emailVerified: new Date(),
      },
    });
    userIds.set(user.email, created.id);

    const roleId = roleIds.get(user.role);
    if (!roleId) throw new Error(`Papel não semeado: ${user.role}`);

    await db.membership.upsert({
      where: { userId_tenantId: { userId: created.id, tenantId } },
      update: { roleId, status: "ACTIVE" },
      create: {
        userId: created.id,
        tenantId,
        roleId,
        status: "ACTIVE",
        acceptedAt: new Date(),
      },
    });
  }

  // ── Proprietário ────────────────────────────────────────────────────────
  const ownerUserId = tenant.ownerUserEmail
    ? userIds.get(tenant.ownerUserEmail)
    : undefined;

  const existingOwner = await db.owner.findFirst({
    where: { tenantId, name: tenant.ownerName },
  });
  const owner = existingOwner
    ? await db.owner.update({
        where: { id: existingOwner.id },
        data: { email: tenant.ownerEmail, userId: ownerUserId ?? null },
      })
    : await db.owner.create({
        data: {
          tenantId,
          name: tenant.ownerName,
          email: tenant.ownerEmail,
          type: "INDIVIDUAL",
          userId: ownerUserId ?? null,
        },
      });

  // ── Imóveis, unidades, comodidades e tarifas ────────────────────────────
  const start = addDays(today(), -RATE_WINDOW_PAST_DAYS);
  const end = addDays(today(), RATE_WINDOW_FUTURE_DAYS);
  const units: SeededUnit[] = [];

  for (const property of tenant.properties) {
    const prop = await db.property.upsert({
      where: { tenantId_slug: { tenantId, slug: property.slug } },
      update: {
        name: property.name,
        type: property.type,
        description: property.description,
        status: "ACTIVE",
        ownerId: owner.id,
        city: property.city,
        state: property.state,
        neighborhood: property.neighborhood,
        addressLine1: property.addressLine1,
      },
      create: {
        tenantId,
        ownerId: owner.id,
        slug: property.slug,
        name: property.name,
        type: property.type,
        description: property.description,
        status: "ACTIVE",
        city: property.city,
        state: property.state,
        neighborhood: property.neighborhood,
        addressLine1: property.addressLine1,
      },
    });

    for (const unit of property.units) {
      const created = await db.unit.upsert({
        where: {
          tenantId_propertyId_internalCode: {
            tenantId,
            propertyId: prop.id,
            internalCode: unit.internalCode,
          },
        },
        update: {
          name: unit.name,
          maxGuests: unit.maxGuests,
          bedrooms: unit.bedrooms,
          beds: unit.beds,
          bathrooms: unit.bathrooms,
          sizeM2: unit.sizeM2,
          status: "ACTIVE",
          baseRateCents: unit.baseRateCents,
          cleaningFeeCents: unit.cleaningFeeCents,
          minNights: unit.minNights,
        },
        create: {
          tenantId,
          propertyId: prop.id,
          internalCode: unit.internalCode,
          name: unit.name,
          maxGuests: unit.maxGuests,
          bedrooms: unit.bedrooms,
          beds: unit.beds,
          bathrooms: unit.bathrooms,
          sizeM2: unit.sizeM2,
          status: "ACTIVE",
          baseRateCents: unit.baseRateCents,
          cleaningFeeCents: unit.cleaningFeeCents,
          minNights: unit.minNights,
        },
      });

      for (const slug of unit.amenities) {
        const amenityId = amenityIds.get(slug);
        if (!amenityId) throw new Error(`Comodidade fora do catálogo: ${slug}`);
        await db.unitAmenity.upsert({
          where: { unitId_amenityId: { unitId: created.id, amenityId } },
          update: {},
          create: { tenantId, unitId: created.id, amenityId },
        });
      }

      const ratePlan = await db.ratePlan.upsert({
        where: {
          tenantId_unitId_code: { tenantId, unitId: created.id, code: "PADRAO" },
        },
        update: {
          name: "Tarifa padrão",
          status: "ACTIVE",
          isDefault: true,
          minNights: unit.minNights,
          cancellationPolicy: "MODERATE",
        },
        create: {
          tenantId,
          unitId: created.id,
          code: "PADRAO",
          name: "Tarifa padrão",
          status: "ACTIVE",
          isDefault: true,
          minNights: unit.minNights,
          cancellationPolicy: "MODERATE",
        },
      });

      // Regerar a janela inteira é mais barato (e mais previsível) do que
      // 180 upserts por unidade.
      await db.dailyRate.deleteMany({
        where: {
          tenantId,
          unitId: created.id,
          ratePlanId: ratePlan.id,
          date: { gte: start, lt: end },
        },
      });

      const rates = new Map<string, number>();
      const rows = eachNight(start, end).map((date) => {
        const priceCents = priceForDate(unit.baseRateCents, date);
        rates.set(date.toISOString().slice(0, 10), priceCents);
        return {
          tenantId,
          ratePlanId: ratePlan.id,
          unitId: created.id,
          date,
          priceCents,
          minNights: unit.minNights,
          source: "MANUAL" as const,
        };
      });
      await db.dailyRate.createMany({ data: rows });

      units.push({
        id: created.id,
        propertyId: prop.id,
        internalCode: unit.internalCode,
        ratePlanId: ratePlan.id,
        baseRateCents: unit.baseRateCents,
        cleaningFeeCents: unit.cleaningFeeCents,
        rates,
      });
    }
  }

  await seedReservations(tenant, tenantId, units, userIds);

  await db.auditLog.create({
    data: {
      tenantId,
      actorType: "SYSTEM",
      actorLabel: "prisma/seed.ts",
      action: "tenant.seeded",
      entityType: "Tenant",
      entityId: tenantId,
      after: { slug: tenant.slug, properties: tenant.properties.length },
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Reservas, ocupação, pagamentos e tarefas
// ─────────────────────────────────────────────────────────────────────────

type ReservationSeed = {
  code: string;
  unitCode: string;
  status: "PENDING" | "CONFIRMED" | "CHECKED_IN" | "CHECKED_OUT" | "CANCELLED";
  source: "DIRECT" | "MANUAL" | "WEBSITE" | "CHANNEL";
  /** Deslocamento em dias a partir de hoje (negativo = passado). */
  checkInOffset: number;
  nights: number;
  adults: number;
  children: number;
  guest: { firstName: string; lastName: string; email: string; phone: string };
  /** E-mail do usuário do portal do hóspede, quando houver. */
  guestUserEmail?: string;
  payment?: {
    provider: "STRIPE" | "MANUAL";
    method: "CARD" | "PIX" | "BOLETO" | "CASH" | "BANK_TRANSFER" | "OTHER";
    intent: "DEPOSIT" | "BALANCE" | "FULL";
    /** Fração do total efetivamente paga. */
    share: number;
    providerPaymentId?: string;
  };
};

const RESERVATIONS: Record<string, ReservationSeed[]> = {
  "costa-verde": [
    {
      code: "0001",
      unitCode: "ENS-101",
      status: "CHECKED_OUT",
      source: "WEBSITE",
      checkInOffset: -20,
      nights: 4,
      adults: 4,
      children: 0,
      guest: {
        firstName: "Patrícia",
        lastName: "Almeida",
        email: "patricia.almeida@exemplo.com.br",
        phone: "+55 21 99876-5432",
      },
      payment: { provider: "MANUAL", method: "PIX", intent: "FULL", share: 1 },
    },
    {
      code: "0002",
      unitCode: "VM-CASA",
      status: "CHECKED_IN",
      source: "DIRECT",
      checkInOffset: -2,
      nights: 5,
      adults: 8,
      children: 2,
      guest: {
        firstName: "Roberto",
        lastName: "Carvalho",
        email: "roberto.carvalho@exemplo.com.br",
        phone: "+55 11 98765-4321",
      },
      payment: {
        provider: "STRIPE",
        method: "CARD",
        intent: "DEPOSIT",
        share: 0.5,
        providerPaymentId: "pi_seed_costaverde_0002",
      },
    },
    {
      code: "0003",
      unitCode: "ENS-102",
      status: "PENDING",
      source: "WEBSITE",
      checkInOffset: 3,
      nights: 2,
      adults: 2,
      children: 0,
      guest: {
        firstName: "Igor",
        lastName: "Fontes",
        email: "hospede@exemplo.com.br",
        phone: "+55 21 97777-1234",
      },
      guestUserEmail: "hospede@exemplo.com.br",
    },
    {
      code: "0004",
      unitCode: "ENS-101",
      status: "CONFIRMED",
      source: "DIRECT",
      checkInOffset: 10,
      nights: 5,
      adults: 5,
      children: 1,
      guest: {
        firstName: "Luciana",
        lastName: "Mendes",
        email: "luciana.mendes@exemplo.com.br",
        phone: "+55 31 96543-2109",
      },
      payment: { provider: "MANUAL", method: "PIX", intent: "FULL", share: 1 },
    },
    {
      code: "0005",
      unitCode: "ENS-101",
      status: "CANCELLED",
      source: "WEBSITE",
      checkInOffset: 30,
      nights: 3,
      adults: 2,
      children: 0,
      guest: {
        firstName: "Sérgio",
        lastName: "Ramos",
        email: "sergio.ramos@exemplo.com.br",
        phone: "+55 48 95432-1098",
      },
    },
  ],
  "ilha-azul": [
    {
      code: "0001",
      unitCode: "IG-CHALE",
      status: "CONFIRMED",
      source: "DIRECT",
      checkInOffset: 7,
      nights: 3,
      adults: 2,
      children: 0,
      guest: {
        firstName: "Tereza",
        lastName: "Bastos",
        email: "tereza.bastos@exemplo.com.br",
        phone: "+55 21 94321-0987",
      },
      payment: { provider: "MANUAL", method: "BANK_TRANSFER", intent: "FULL", share: 1 },
    },
  ],
};

async function seedReservations(
  tenant: TenantSeed,
  tenantId: string,
  units: SeededUnit[],
  userIds: Map<string, string>,
): Promise<void> {
  const seeds = RESERVATIONS[tenant.slug] ?? [];
  const unitByCode = new Map(units.map((u) => [u.internalCode, u]));
  const year = today().getUTCFullYear();

  for (const seed of seeds) {
    const unit = unitByCode.get(seed.unitCode);
    if (!unit) throw new Error(`Unidade não semeada: ${seed.unitCode}`);

    const checkIn = addDays(today(), seed.checkInOffset);
    const checkOut = addDays(checkIn, seed.nights);
    const code = `${tenant.reservationPrefix}-${year}-${seed.code}`;

    // Preço recalculado a partir das diárias — nunca um total "de fora"
    // (RN-005). Fora da janela de tarifas, cai na diária base da unidade.
    const nights = eachNight(checkIn, checkOut).map((date) => {
      const key = date.toISOString().slice(0, 10);
      // Fora da janela de tarifas publicadas, cai na curva sobre a diária
      // base. Nunca `?? 0`: uma noite a custo zero passaria despercebida
      // pela CHECK de total não-negativo e zeraria os relatórios.
      const priceCents =
        unit.rates.get(key) ?? priceForDate(unit.baseRateCents, date);
      return { date: key, priceCents };
    });
    const nightlyTotalCents = nights.reduce((sum, n) => sum + n.priceCents, 0);
    const feesTotalCents = unit.cleaningFeeCents;
    const totalCents = nightlyTotalCents + feesTotalCents;
    const paidCents = seed.payment
      ? Math.round(totalCents * seed.payment.share)
      : 0;

    const guest = await db.guest.upsert({
      where: { tenantId_email: { tenantId, email: seed.guest.email } },
      update: {
        firstName: seed.guest.firstName,
        lastName: seed.guest.lastName,
        phone: seed.guest.phone,
        userId: seed.guestUserEmail ? (userIds.get(seed.guestUserEmail) ?? null) : null,
      },
      create: {
        tenantId,
        firstName: seed.guest.firstName,
        lastName: seed.guest.lastName,
        email: seed.guest.email,
        phone: seed.guest.phone,
        country: "BR",
        userId: seed.guestUserEmail ? (userIds.get(seed.guestUserEmail) ?? null) : null,
      },
    });

    const quoteSnapshot = {
      currency: "BRL",
      nights,
      nightlyTotalCents,
      cleaningFeeCents: unit.cleaningFeeCents,
      feesTotalCents,
      totalCents,
      ratePlanId: unit.ratePlanId,
      computedBy: "seed",
    };

    const common = {
      propertyId: unit.propertyId,
      unitId: unit.id,
      primaryGuestId: guest.id,
      ratePlanId: unit.ratePlanId,
      status: seed.status,
      source: seed.source,
      checkIn,
      checkOut,
      nights: nightsBetween(checkIn, checkOut),
      adults: seed.adults,
      children: seed.children,
      nightlyTotalCents,
      feesTotalCents,
      totalCents,
      paidCents,
      quoteSnapshot,
      holdExpiresAt:
        seed.status === "PENDING" ? new Date(Date.now() + 30 * 60_000) : null,
      confirmedAt:
        seed.status === "PENDING" || seed.status === "CANCELLED" ? null : checkIn,
      cancelledAt: seed.status === "CANCELLED" ? addDays(today(), -1) : null,
      cancellationReason:
        seed.status === "CANCELLED" ? "Cancelada pelo hóspede (demo)." : null,
      checkedInAt:
        seed.status === "CHECKED_IN" || seed.status === "CHECKED_OUT" ? checkIn : null,
      checkedOutAt: seed.status === "CHECKED_OUT" ? checkOut : null,
    };

    const reservation = await db.reservation.upsert({
      where: { tenantId_code: { tenantId, code } },
      update: common,
      create: { tenantId, code, ...common },
    });

    await db.reservationGuest.upsert({
      where: {
        reservationId_guestId: { reservationId: reservation.id, guestId: guest.id },
      },
      update: { role: "PRIMARY", isPrimary: true },
      create: {
        tenantId,
        reservationId: reservation.id,
        guestId: guest.id,
        role: "PRIMARY",
        isPrimary: true,
      },
    });

    // Ocupação: reserva cancelada libera o período (releasedAt + isBlocking
    // false), que é o que a constraint de exclusão usa para não conflitar
    // com uma reserva futura nas mesmas datas (ADR-003/ADR-005).
    const released = seed.status === "CANCELLED";
    const blockData = {
      tenantId,
      unitId: unit.id,
      startDate: checkIn,
      endDate: checkOut,
      source: "RESERVATION" as const,
      isBlocking: !released,
      releasedAt: released ? addDays(today(), -1) : null,
      reason: released ? "Reserva cancelada" : null,
    };
    await db.availabilityBlock.upsert({
      where: { reservationId: reservation.id },
      update: blockData,
      create: { ...blockData, reservationId: reservation.id },
    });

    if (seed.payment) {
      const idempotencyKey = `seed:${code}:${seed.payment.intent}`;
      const paymentData = {
        tenantId,
        reservationId: reservation.id,
        provider: seed.payment.provider,
        providerPaymentId: seed.payment.providerPaymentId ?? null,
        method: seed.payment.method,
        intent: seed.payment.intent,
        status: "SUCCEEDED" as const,
        amountCents: paidCents,
        description: `Pagamento da reserva ${code}`,
        paidAt: addDays(today(), Math.min(seed.checkInOffset, 0) - 1),
      };
      await db.payment.upsert({
        where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } },
        update: paymentData,
        create: { ...paymentData, idempotencyKey },
      });
    }

    await seedTasksForReservation(tenantId, reservation.id, unit, seed, checkIn, checkOut, userIds);
  }

  // Bloqueio manual (manutenção) — prova que ocupação não vem só de reserva.
  await db.availabilityBlock.deleteMany({
    where: { tenantId, source: "MAINTENANCE", reason: { startsWith: "Seed:" } },
  });
  const maintenanceUnit = units[units.length - 1];
  if (maintenanceUnit) {
    await db.availabilityBlock.create({
      data: {
        tenantId,
        unitId: maintenanceUnit.id,
        startDate: addDays(today(), 45),
        endDate: addDays(today(), 48),
        source: "MAINTENANCE",
        isBlocking: true,
        reason: "Seed: pintura e revisão hidráulica",
      },
    });
  }
}

type SeededTask = {
  dedupeKey: string;
  type: "CHECK_IN" | "CHECK_OUT" | "CLEANING" | "INSPECTION" | "MAINTENANCE" | "CUSTOM";
  title: string;
  dueAt: Date;
  status: "OPEN" | "IN_PROGRESS" | "BLOCKED" | "DONE" | "CANCELLED";
  assignedToUserId: string | null;
  assignedRoleSlug: string;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
};

async function seedTasksForReservation(
  tenantId: string,
  reservationId: string,
  unit: SeededUnit,
  seed: ReservationSeed,
  checkIn: Date,
  checkOut: Date,
  userIds: Map<string, string>,
): Promise<void> {
  if (seed.status === "CANCELLED") return;

  const cleaner = userIds.get("limpeza@costaverde.com.br") ?? null;
  const maintainer = userIds.get("manutencao@costaverde.com.br") ?? null;

  // Tipo explícito: sem ele o TS infere a união só dos dois primeiros itens
  // e rejeita o `push` da tarefa de manutenção mais abaixo.
  const tasks: SeededTask[] = [
    {
      dedupeKey: `seed:${reservationId}:checkin`,
      type: "CHECK_IN" as const,
      title: `Check-in ${seed.guest.firstName} ${seed.guest.lastName} — ${unit.internalCode}`,
      dueAt: new Date(checkIn.getTime() + 15 * 3_600_000),
      status:
        seed.status === "CHECKED_IN" || seed.status === "CHECKED_OUT"
          ? ("DONE" as const)
          : ("OPEN" as const),
      assignedToUserId: null,
      assignedRoleSlug: "operations_coordinator",
      priority: "NORMAL" as const,
    },
    {
      dedupeKey: `seed:${reservationId}:limpeza`,
      type: "CLEANING" as const,
      title: `Limpeza pós check-out — ${unit.internalCode}`,
      dueAt: new Date(checkOut.getTime() + 11 * 3_600_000),
      status: seed.status === "CHECKED_OUT" ? ("DONE" as const) : ("OPEN" as const),
      assignedToUserId: cleaner,
      assignedRoleSlug: "cleaning_staff",
      priority: "HIGH" as const,
    },
  ];

  if (seed.status === "CHECKED_IN") {
    tasks.push({
      dedupeKey: `seed:${reservationId}:manutencao`,
      type: "MAINTENANCE" as const,
      title: `Chuveiro da suíte 2 sem pressão — ${unit.internalCode}`,
      dueAt: new Date(Date.now() + 6 * 3_600_000),
      status: "IN_PROGRESS" as const,
      assignedToUserId: maintainer,
      assignedRoleSlug: "maintenance_staff",
      priority: "URGENT" as const,
    });
  }

  for (const task of tasks) {
    const { dedupeKey, ...rest } = task;
    const data = {
      ...rest,
      unitId: unit.id,
      propertyId: unit.propertyId,
      reservationId,
      createdBySystem: true,
      completedAt: rest.status === "DONE" ? rest.dueAt : null,
    };
    await db.task.upsert({
      where: { tenantId_dedupeKey: { tenantId, dedupeKey } },
      update: data,
      create: { tenantId, dedupeKey, ...data },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("→ Permissões...");
  const permissionIds = await seedPermissions();
  console.log(`  ${permissionIds.size} permissões no catálogo.`);

  console.log("→ Papéis-template de sistema...");
  await seedRoleTemplates(permissionIds);
  console.log(`  ${ROLE_SLUGS.length} papéis.`);

  console.log("→ Catálogo global de comodidades...");
  const amenityIds = await seedGlobalAmenities();
  console.log(`  ${amenityIds.size} comodidades.`);

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  const superadmin = await db.user.upsert({
    where: { email: "superadmin@otatitan.app" },
    update: { isSuperadmin: true },
    create: {
      email: "superadmin@otatitan.app",
      name: "Superadministrador",
      passwordHash,
      isSuperadmin: true,
      emailVerified: new Date(),
    },
  });
  console.log(`→ Superadmin de plataforma: ${superadmin.email}`);

  for (const tenant of TENANTS) {
    console.log(`→ Tenant "${tenant.name}" (${tenant.slug})...`);
    await seedTenant(tenant, amenityIds, passwordHash);
  }

  // ── Resumo ──────────────────────────────────────────────────────────────
  console.log("\nAcessos de desenvolvimento (senha única):");
  console.log(`  senha: ${DEMO_PASSWORD}\n`);
  console.log("  superadmin@otatitan.app          superadmin de plataforma");
  for (const tenant of TENANTS) {
    console.log(`\n  [${tenant.name}]`);
    for (const user of tenant.users) {
      console.log(`  ${user.email.padEnd(33)}${ROLE_LABELS[user.role]}`);
    }
  }

  const totals = await Promise.all([
    db.property.count(),
    db.unit.count(),
    db.dailyRate.count(),
    db.reservation.count(),
    db.task.count(),
  ]);
  const [properties, units, dailyRates, reservations, tasks] = totals;
  const revenue = await db.reservation.aggregate({
    _sum: { totalCents: true },
    where: { status: { in: ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"] } },
  });

  console.log(
    `\nTotais: ${properties} imóveis · ${units} unidades · ${dailyRates} diárias · ` +
      `${reservations} reservas · ${tasks} tarefas · ` +
      `${money(revenue._sum.totalCents ?? 0)} em reservas ativas.`,
  );
}

main()
  .then(() => db.$disconnect())
  .catch(async (error) => {
    console.error("\nSeed falhou:", error);
    await db.$disconnect();
    process.exit(1);
  });
