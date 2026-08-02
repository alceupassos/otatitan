import "dotenv/config";
import path from "node:path";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
    seed: "tsx prisma/seed.ts",
  },
  // Migrations/introspection precisam de DDL e devem rodar como dono do schema,
  // que não é o mesmo papel usado pela aplicação em runtime (ver scripts/db-roles.sql).
  datasource: {
    url: process.env.DATABASE_MIGRATE_URL ?? process.env.DATABASE_URL,
  },
});
