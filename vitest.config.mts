import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Resolução nativa dos paths do tsconfig (@/* -> src/*), substitui o
    // plugin vite-tsconfig-paths.
    tsconfigPaths: true,
    alias: {
      // O `server-only` real lança ao ser importado fora de um Server
      // Component — inclusive num teste em Node puro. O stub deixa os
      // módulos de servidor testáveis sem afastar a proteção do build.
      "server-only": fileURLToPath(
        new URL("./tests/helpers/server-only-stub.ts", import.meta.url),
      ),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          testTimeout: 30_000,
          // Os testes de integração compartilham um Postgres real; rodar
          // arquivos em paralelo geraria contenção nas mesmas datas/unidades.
          fileParallelism: false,
        },
      },
    ],
  },
});
