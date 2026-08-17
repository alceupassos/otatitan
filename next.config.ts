import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Sem isto o Next sobe a árvore, acha o package-lock.json vazio em
  // C:\Users\Alceu Passos e elege a pasta home como raiz do workspace —
  // o que bagunça o file tracing do build.
  turbopack: {
    root: path.resolve(import.meta.dirname),
  },

  // Empacota só o necessário em .next/standalone (server + deps usados),
  // o que permite a imagem final de produção não ter node_modules inteiro
  // nem o código-fonte. Ver Dockerfile.
  output: "standalone",

  // O proxy reverso (Caddy) termina o TLS; estes cabeçalhos são a parte
  // que precisa vir da aplicação. HSTS fica no Caddy, junto do TLS.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(), geolocation=(), payment=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
