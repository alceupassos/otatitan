import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Resolução nativa dos paths do tsconfig (@/* -> src/*), substitui o
    // plugin vite-tsconfig-paths.
    tsconfigPaths: true,
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
