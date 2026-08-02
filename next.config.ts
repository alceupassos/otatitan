import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Sem isto o Next sobe a árvore, acha o package-lock.json vazio em
  // C:\Users\Alceu Passos e elege a pasta home como raiz do workspace —
  // o que bagunça o file tracing do build.
  turbopack: {
    root: path.resolve(import.meta.dirname),
  },
};

export default nextConfig;
