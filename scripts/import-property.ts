/**
 * Importa um imóvel e suas unidades a partir de um arquivo JSON.
 *
 *   npm run property:import -- --arquivo scripts/data/madre914.json --tenant titan-prime
 *
 * Em produção (no servidor):
 *   docker compose -f docker-compose.prod.yml --env-file .env.production \
 *     run --rm --entrypoint sh migrate -c \
 *     'npx tsx scripts/import-property.ts --arquivo scripts/data/madre914.json --tenant titan-prime'
 *
 * A operação real do Madre 914 são 4 studios (312, 409, 506, 609), listados
 * um a um em `unidades`. `gerarUnidades` continua existindo para outros
 * prédios, mas NÃO deve ser usado aqui — o arquivo antigo gerava 40
 * rascunhos fictícios. Com `arquivarUnidadesAusentes: true`, reimportar
 * arquiva unidades do imóvel cujo `internalCode` não está no arquivo
 * (os 36 DRAFT de uma importação velha saem do calendário).
 *
 * Roda como otatitan_owner (única role com BYPASSRLS), pelo mesmo motivo
 * do seed: escreve em tabela tenant-scoped resolvendo o tenant por slug,
 * antes de existir contexto de sessão.
 *
 * É idempotente: reexecutar com o mesmo arquivo atualiza em vez de
 * duplicar (chaveado por `slug` do imóvel e `internalCode` da unidade).
 */
import { readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { propertySchema, slugify, unitSchema } from "../src/lib/properties/schemas";

function arg(chave: string): string | undefined {
  const i = process.argv.indexOf(`--${chave}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const arquivo = arg("arquivo");
const tenantSlug = arg("tenant");

if (!arquivo || !tenantSlug) {
  console.error(
    "Uso: npx tsx scripts/import-property.ts --arquivo <caminho.json> --tenant <slug>",
  );
  process.exit(1);
}

const connectionString =
  process.env.DATABASE_MIGRATE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_MIGRATE_URL não definida.");

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/**
 * Formato do arquivo. As unidades podem vir listadas uma a uma
 * (`unidades`) ou geradas por andar (`gerarUnidades`) — um prédio de 40
 * apartamentos numerados não deveria exigir 40 blocos de JSON iguais.
 */
type Arquivo = {
  imovel: Record<string, string>;
  /** Slugs de comodidade aplicados a todas as unidades geradas. */
  comodidades?: string[];
  unidades?: Record<string, string>[];
  /**
   * Se true, unidades do imóvel cujo `internalCode` não está neste arquivo
   * são arquivadas. Serve para corrigir uma importação antiga (ex.: 40
   * rascunhos) sem apagar histórico de reserva.
   */
  arquivarUnidadesAusentes?: boolean;
  gerarUnidades?: {
    andares: number[];
    porAndar: number;
    /** `M914-` + andar + número, ex.: M914-0203. */
    prefixoCodigo: string;
    nomeTemplate: string;
    padrao: Record<string, string>;
  };
};

function unidadesGeradas(g: NonNullable<Arquivo["gerarUnidades"]>) {
  const out: Record<string, string>[] = [];
  for (const andar of g.andares) {
    for (let n = 1; n <= g.porAndar; n++) {
      const numero = `${andar}${String(n).padStart(2, "0")}`;
      out.push({
        ...g.padrao,
        internalCode: `${g.prefixoCodigo}${numero}`,
        name: g.nomeTemplate.replace("{numero}", numero),
        floor: String(andar),
      });
    }
  }
  return out;
}

async function main() {
  const conteudo = JSON.parse(readFileSync(arquivo!, "utf8")) as Arquivo;

  const tenant = await db.tenant.findUnique({ where: { slug: tenantSlug! } });
  if (!tenant) {
    console.error(`Empresa não encontrada: ${tenantSlug}`);
    process.exit(1);
  }
  console.log(`Empresa: ${tenant.name}`);

  // Valida com o MESMO schema da UI: um importador com validação própria
  // acaba aceitando o que o formulário recusa, e o banco fica com dados
  // que a tela não consegue editar.
  const imovel = propertySchema.safeParse(conteudo.imovel);
  if (!imovel.success) {
    console.error("Imóvel inválido:");
    for (const i of imovel.error.issues) {
      console.error(`  ${i.path.join(".")}: ${i.message}`);
    }
    process.exit(1);
  }

  const slug = slugify(imovel.data.name);
  const property = await db.property.upsert({
    where: { tenantId_slug: { tenantId: tenant.id, slug } },
    update: imovel.data,
    create: { tenantId: tenant.id, slug, ...imovel.data },
  });
  console.log(`Imóvel: ${property.name} (${property.slug}) — ${property.status}`);

  // Comodidades por slug: o arquivo cita "wifi", não um uuid.
  const amenityIds: string[] = [];
  if (conteudo.comodidades?.length) {
    const encontradas = await db.amenity.findMany({
      where: { slug: { in: conteudo.comodidades }, tenantId: null },
      select: { id: true, slug: true },
    });
    const faltando = conteudo.comodidades.filter(
      (s) => !encontradas.some((a) => a.slug === s),
    );
    if (faltando.length > 0) {
      console.warn(`  aviso: comodidades fora do catálogo: ${faltando.join(", ")}`);
    }
    amenityIds.push(...encontradas.map((a) => a.id));
  }

  const brutas = conteudo.unidades ?? (conteudo.gerarUnidades ? unidadesGeradas(conteudo.gerarUnidades) : []);
  if (brutas.length === 0) {
    console.log("Nenhuma unidade no arquivo.");
    await db.$disconnect();
    return;
  }

  let criadas = 0;
  let atualizadas = 0;

  for (const bruta of brutas) {
    const { floor, ...paraValidar } = bruta;
    const parsed = unitSchema.safeParse({ ...paraValidar, amenityIds: [] });
    if (!parsed.success) {
      console.error(`Unidade ${bruta.internalCode} inválida:`);
      for (const i of parsed.error.issues) {
        console.error(`  ${i.path.join(".")}: ${i.message}`);
      }
      process.exit(1);
    }

    // Payload montado campo a campo em vez de espalhar `parsed.data`: o
    // schema devolve `amenityIds`, que não é coluna de Unit (as
    // comodidades vêm do nível do arquivo, por slug, e são gravadas
    // depois). Espalhar levaria esse campo para o Prisma e falharia.
    const v = parsed.data;
    const dados = {
      name: v.name,
      internalCode: v.internalCode,
      status: v.status,
      maxGuests: v.maxGuests,
      bedrooms: v.bedrooms,
      beds: v.beds,
      bathrooms: v.bathrooms,
      sizeM2: v.sizeM2,
      baseRateCents: v.baseRateCents,
      cleaningFeeCents: v.cleaningFeeCents,
      minNights: v.minNights,
      maxNights: v.maxNights,
    };

    const existente = await db.unit.findFirst({
      where: {
        tenantId: tenant.id,
        propertyId: property.id,
        internalCode: dados.internalCode,
      },
      select: { id: true },
    });

    const unit = existente
      ? await db.unit.update({
          where: { id: existente.id },
          data: { ...dados, floor: floor ?? null },
        })
      : await db.unit.create({
          data: {
            tenantId: tenant.id,
            propertyId: property.id,
            floor: floor ?? null,
            ...dados,
          },
        });

    if (existente) atualizadas++;
    else criadas++;

    if (amenityIds.length > 0) {
      // Substitui o conjunto: reimportar não deve acumular vínculo antigo.
      await db.unitAmenity.deleteMany({ where: { unitId: unit.id } });
      await db.unitAmenity.createMany({
        data: amenityIds.map((amenityId) => ({
          tenantId: tenant.id,
          unitId: unit.id,
          amenityId,
        })),
        skipDuplicates: true,
      });
    }
  }

  let arquivadas = 0;
  if (conteudo.arquivarUnidadesAusentes) {
    const codigos = new Set(brutas.map((u) => u.internalCode));
    const extras = await db.unit.findMany({
      where: {
        tenantId: tenant.id,
        propertyId: property.id,
        status: { not: "ARCHIVED" },
      },
      select: { id: true, internalCode: true },
    });
    for (const extra of extras) {
      if (codigos.has(extra.internalCode)) continue;
      await db.unit.update({
        where: { id: extra.id },
        data: { status: "ARCHIVED", archivedAt: new Date() },
      });
      arquivadas++;
      console.log(`  arquivada (ausente do arquivo): ${extra.internalCode}`);
    }
  }

  await db.auditLog.create({
    data: {
      tenantId: tenant.id,
      actorType: "SYSTEM",
      actorLabel: "scripts/import-property.ts",
      action: "property.imported",
      entityType: "Property",
      entityId: property.id,
      after: {
        slug: property.slug,
        unidadesCriadas: criadas,
        unidadesAtualizadas: atualizadas,
        unidadesArquivadas: arquivadas,
        arquivo,
      },
    },
  });

  console.log(
    `Unidades: ${criadas} criada(s), ${atualizadas} atualizada(s)` +
      (arquivadas > 0 ? `, ${arquivadas} arquivada(s)` : "") +
      `, ${amenityIds.length} comodidade(s) por unidade.`,
  );
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error("\nFalhou:", err);
  await db.$disconnect();
  process.exit(1);
});
