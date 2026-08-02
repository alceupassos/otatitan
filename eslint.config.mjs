import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Cliente do Prisma gerado — recriado por `npm run db:generate`.
    "src/generated/**",
  ]),
  {
    // Código vindo do registry do shadcn (`npx shadcn@latest add`) e
    // regerado a cada atualização de componente. Não editamos à mão (ver
    // CLAUDE.md), então não faz sentido falhar o CI por causa dele.
    // Regra em questão: react-hooks/set-state-in-effect, que o upstream
    // ainda dispara em carousel/use-mobile.
    files: ["src/components/ui/**", "src/hooks/use-mobile.ts"],
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);

export default eslintConfig;
