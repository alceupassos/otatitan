/**
 * Remove uma empresa (tenant) e TUDO que pertence a ela, em cascata.
 *
 * Destrutivo e irreversível. Existe para desfazer um tenant criado por
 * engano (slug errado, teste) enquanto não há UI de administração — não
 * para uso rotineiro.
 *
 * Exige confirmação explícita do slug, para que um erro de digitação não
 * apague a empresa errada:
 *
 *   npm run tenant:drop -- --slug teste --confirmar teste
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

function arg(chave: string): string | undefined {
  const i = process.argv.indexOf(`--${chave}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const slug = arg("slug");
const confirmar = arg("confirmar");

if (!slug || !confirmar) {
  console.error(
    "Uso: npx tsx scripts/drop-tenant.ts --slug <slug> --confirmar <slug>",
  );
  process.exit(1);
}

if (slug !== confirmar) {
  console.error(
    `Confirmação não corresponde ("${confirmar}" ≠ "${slug}"). Nada foi apagado.`,
  );
  process.exit(1);
}

const connectionString =
  process.env.DATABASE_MIGRATE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_MIGRATE_URL não definida.");

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const tenant = await db.tenant.findUnique({
    where: { slug: slug! },
    select: { id: true, name: true },
  });

  if (!tenant) {
    console.log(`Empresa "${slug}" não existe — nada a fazer.`);
    await db.$disconnect();
    return;
  }

  // Contagem antes de apagar: o operador merece saber o tamanho do
  // estrago que está autorizando.
  const [imoveis, reservas, usuarios] = await Promise.all([
    db.property.count({ where: { tenantId: tenant.id } }),
    db.reservation.count({ where: { tenantId: tenant.id } }),
    db.membership.count({ where: { tenantId: tenant.id } }),
  ]);
  console.log(
    `Apagando "${tenant.name}": ${imoveis} imóveis, ${reservas} reservas, ${usuarios} vínculos.`,
  );

  await db.tenant.delete({ where: { id: tenant.id } });
  console.log("Removida.");
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error("\nFalhou:", err);
  await db.$disconnect();
  process.exit(1);
});
