/**
 * Cria uma empresa (tenant) e vincula um usuário como administrador dela.
 *
 * Existe porque não há UI de administração de plataforma ainda: numa
 * instalação nova, o superadmin entra e não tem empresa nenhuma para
 * acessar. Este é o passo que destrava a primeira.
 *
 * Uso:
 *   npm run tenant:create -- --nome "Minha Administradora" \
 *                            --slug minha-administradora \
 *                            --admin alguem@exemplo.com.br
 *
 * Em produção (no servidor):
 *   docker compose -f docker-compose.prod.yml --env-file .env.production \
 *     run --rm --entrypoint sh migrate -c \
 *     'npx tsx scripts/create-tenant.ts --nome "..." --slug ... --admin ...'
 *
 * Roda como otatitan_owner (única role com BYPASSRLS), porque criar
 * Membership exige escrever numa tabela tenant-scoped antes de existir
 * contexto de tenant — o mesmo motivo pelo qual o seed usa essa role.
 *
 * É idempotente: rodar de novo com os mesmos argumentos não duplica nada.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  ROLE_LABELS,
  ROLE_SLUGS,
  SYSTEM_ROLES,
  type RoleSlug,
} from "../src/lib/rbac/roles";
import { isPermissionCode, type PermissionCode } from "../src/lib/rbac/permissions";

/**
 * Lê `--chave valor`. Junta todos os tokens até o próximo `--`, porque
 * dependendo do shell (e do npm no meio do caminho) as aspas de um nome
 * com espaços se perdem e "Minha Administradora" chega como dois
 * argumentos — pegar só `argv[i+1]` criaria a empresa como "Minha".
 */
function arg(chave: string): string | undefined {
  const i = process.argv.indexOf(`--${chave}`);
  if (i < 0) return undefined;

  const partes: string[] = [];
  for (let j = i + 1; j < process.argv.length; j++) {
    if (process.argv[j]!.startsWith("--")) break;
    partes.push(process.argv[j]!);
  }
  return partes.length > 0 ? partes.join(" ") : undefined;
}

const nome = arg("nome");
const slug = arg("slug");
const adminEmail = arg("admin")?.trim().toLowerCase();
const papel = (arg("papel") ?? "company_admin") as RoleSlug;

if (!nome || !slug || !adminEmail) {
  console.error(
    "Uso: npx tsx scripts/create-tenant.ts --nome <nome> --slug <slug> --admin <email> [--papel company_admin]",
  );
  process.exit(1);
}

if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
  console.error(`Slug inválido: "${slug}". Use minúsculas, números e hífens.`);
  process.exit(1);
}

if (!ROLE_SLUGS.includes(papel)) {
  console.error(`Papel desconhecido: "${papel}". Opções: ${ROLE_SLUGS.join(", ")}`);
  process.exit(1);
}

const connectionString =
  process.env.DATABASE_MIGRATE_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_MIGRATE_URL (ou DATABASE_URL) não definida.");
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const user = await db.user.findUnique({
    where: { email: adminEmail! },
    select: { id: true, name: true, email: true, deletedAt: true },
  });

  if (!user || user.deletedAt) {
    console.error(
      `Usuário não encontrado: ${adminEmail}\n` +
        `Rode o seed primeiro, ou crie o usuário antes de vinculá-lo.`,
    );
    process.exit(1);
  }

  const tenant = await db.tenant.upsert({
    where: { slug: slug! },
    update: { name: nome!, status: "ACTIVE" },
    create: { slug: slug!, name: nome!, status: "ACTIVE" },
  });
  console.log(`Empresa: ${tenant.name} (${tenant.slug})`);

  // Papéis do tenant: cópia dos templates de sistema. Sem isso não há
  // roleId para a membership apontar.
  const permissionIds = new Map<PermissionCode, string>(
    (await db.permission.findMany({ select: { id: true, code: true } }))
      .filter((p) => isPermissionCode(p.code))
      .map((p) => [p.code as PermissionCode, p.id]),
  );

  if (permissionIds.size === 0) {
    console.error(
      "Catálogo de permissões vazio — rode o seed antes (npm run db:seed:catalog).",
    );
    process.exit(1);
  }

  const roleIds = new Map<RoleSlug, string>();
  for (const rs of ROLE_SLUGS) {
    const role = await db.role.upsert({
      where: { tenantId_slug: { tenantId: tenant.id, slug: rs } },
      update: { name: ROLE_LABELS[rs], isSystem: true },
      create: {
        tenantId: tenant.id,
        slug: rs,
        name: ROLE_LABELS[rs],
        isSystem: true,
      },
    });
    roleIds.set(rs, role.id);

    const wanted = SYSTEM_ROLES[rs]
      .map((code) => permissionIds.get(code))
      .filter((id): id is string => Boolean(id));

    const current = await db.rolePermission.findMany({
      where: { roleId: role.id },
      select: { permissionId: true },
    });
    const currentIds = new Set(current.map((rp) => rp.permissionId));
    const toAdd = wanted.filter((id) => !currentIds.has(id));
    if (toAdd.length > 0) {
      await db.rolePermission.createMany({
        data: toAdd.map((permissionId) => ({ roleId: role.id, permissionId })),
        skipDuplicates: true,
      });
    }
  }
  console.log(`  ${ROLE_SLUGS.length} papéis criados/conferidos.`);

  const roleId = roleIds.get(papel)!;
  await db.membership.upsert({
    where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
    update: { roleId, status: "ACTIVE" },
    create: {
      userId: user.id,
      tenantId: tenant.id,
      roleId,
      status: "ACTIVE",
      acceptedAt: new Date(),
    },
  });

  await db.auditLog.create({
    data: {
      tenantId: tenant.id,
      actorType: "SYSTEM",
      actorLabel: "scripts/create-tenant.ts",
      action: "tenant.created",
      entityType: "Tenant",
      entityId: tenant.id,
      after: { slug: tenant.slug, name: tenant.name, admin: adminEmail, papel },
    },
  });

  console.log(`  ${user.email} vinculado como ${ROLE_LABELS[papel]}.`);
  console.log("\nPronto. Saia e entre de novo para o token pegar a empresa.");
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error("\nFalhou:", err);
  await db.$disconnect();
  process.exit(1);
});
