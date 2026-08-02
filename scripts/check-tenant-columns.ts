/**
 * Guarda de CI: impede que uma tabela nova entre no schema sem as
 * proteções de isolamento multi-tenant (docs/09-arquitetura.md, ADR-002 e
 * ADR-006). Roda com `npm run check:tenant-columns`.
 *
 * Verifica, para toda tabela do schema `otatitan` que tenha coluna
 * `tenantId`:
 *   1. RLS habilitada E forçada (ENABLE + FORCE ROW LEVEL SECURITY);
 *   2. política `tenant_isolation` presente para a role de aplicação;
 *   3. a tabela está declarada em src/lib/db/extensions.ts — sem isso a
 *      extensão do Prisma não a filtra e o desenvolvedor só descobriria
 *      em produção;
 *   4. colunas `tenantId` NOT NULL têm DEFAULT lendo o GUC da sessão.
 * E, independente disso, que a constraint anti-overbooking continua viva.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

const SCHEMA = "otatitan";
const APP_ROLE = "otatitan_app";
const EXCLUSION_CONSTRAINT = "availability_block_no_overlap";

type Finding = { table: string; problem: string };

function modelsDeclaredInExtension(): Set<string> {
  const file = path.join(
    process.cwd(),
    "src",
    "lib",
    "db",
    "extensions.ts",
  );
  const source = readFileSync(file, "utf8");
  const declared = new Set<string>();
  for (const block of ["STRICT_TENANT_MODELS", "NULLABLE_READTHROUGH_MODELS"]) {
    const match = source.match(new RegExp(`${block}[^[]*\\[([^\\]]*)\\]`, "s"));
    if (!match) {
      throw new Error(
        `Não encontrei ${block} em src/lib/db/extensions.ts — o guarda de CI precisa ser atualizado.`,
      );
    }
    for (const raw of match[1].split(",")) {
      const name = raw.trim().replace(/^["']|["']$/g, "");
      if (name) declared.add(name);
    }
  }
  return declared;
}

async function main() {
  const connectionString =
    process.env.DATABASE_MIGRATE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_MIGRATE_URL/DATABASE_URL não definida.");
  }

  const client = new Client({ connectionString });
  await client.connect();
  const findings: Finding[] = [];

  try {
    const { rows: tables } = await client.query<{
      table_name: string;
      is_nullable: string;
      has_default: boolean;
      rls_enabled: boolean;
      rls_forced: boolean;
    }>(
      `SELECT c.relname            AS table_name,
              a.attnotnull = false AS is_nullable_bool,
              (a.atthasdef)        AS has_default,
              c.relrowsecurity     AS rls_enabled,
              c.relforcerowsecurity AS rls_forced,
              CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_attribute a ON a.attrelid = c.oid
        WHERE n.nspname = $1
          AND c.relkind = 'r'
          AND a.attname = 'tenantId'
          AND a.attisdropped = false
        ORDER BY c.relname`,
      [SCHEMA],
    );

    if (tables.length === 0) {
      throw new Error(
        `Nenhuma tabela com coluna tenantId encontrada em ${SCHEMA} — banco vazio ou migrations não aplicadas?`,
      );
    }

    const { rows: policies } = await client.query<{
      tablename: string;
      roles: string[];
    }>(
      `SELECT tablename, roles FROM pg_policies
        WHERE schemaname = $1 AND policyname = 'tenant_isolation'`,
      [SCHEMA],
    );
    const policyByTable = new Map(policies.map((p) => [p.tablename, p.roles]));
    const declared = modelsDeclaredInExtension();

    for (const t of tables) {
      if (!t.rls_enabled) {
        findings.push({ table: t.table_name, problem: "RLS não habilitada" });
      }
      if (!t.rls_forced) {
        findings.push({
          table: t.table_name,
          problem: "falta FORCE ROW LEVEL SECURITY",
        });
      }

      const roles = policyByTable.get(t.table_name);
      if (!roles) {
        findings.push({
          table: t.table_name,
          problem: "sem política tenant_isolation",
        });
      } else if (!roles.includes(APP_ROLE)) {
        findings.push({
          table: t.table_name,
          problem: `política tenant_isolation não cobre a role ${APP_ROLE}`,
        });
      }

      if (!declared.has(t.table_name)) {
        findings.push({
          table: t.table_name,
          problem:
            "não declarada em src/lib/db/extensions.ts (a extensão do Prisma não vai filtrar esta tabela)",
        });
      }

      if (t.is_nullable === "NO" && !t.has_default) {
        findings.push({
          table: t.table_name,
          problem:
            "tenantId NOT NULL sem DEFAULT do GUC de sessão (INSERT cru poderia falhar em vez de ser carimbado)",
        });
      }
    }

    const { rows: constraint } = await client.query(
      `SELECT 1 FROM pg_constraint WHERE conname = $1`,
      [EXCLUSION_CONSTRAINT],
    );
    if (constraint.length === 0) {
      findings.push({
        table: "AvailabilityBlock",
        problem: `constraint de exclusão "${EXCLUSION_CONSTRAINT}" sumiu — a garantia de zero overbooking está desligada`,
      });
    }

    if (findings.length > 0) {
      console.error("\n❌ Guarda de isolamento multi-tenant falhou:\n");
      for (const f of findings) {
        console.error(`  • ${f.table}: ${f.problem}`);
      }
      console.error(
        "\nVer docs/09-arquitetura.md (ADR-002) para a convenção obrigatória.\n",
      );
      process.exitCode = 1;
      return;
    }

    console.log(
      `✅ ${tables.length} tabelas tenant-scoped verificadas: RLS habilitada e forçada, ` +
        `política presente, declaradas na extensão, DEFAULT de tenantId no lugar, ` +
        `e a constraint anti-overbooking está ativa.`,
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
