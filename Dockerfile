# Imagem de produção do Otatitan.
#
# Multi-stage para que a imagem final não carregue nem código-fonte, nem
# toolchain de build, nem node_modules de desenvolvimento. O que vai para
# produção é o bundle `standalone` do Next (ver `output: "standalone"` em
# next.config.ts) mais o Prisma Client gerado.

# ── 1. Dependências ───────────────────────────────────────────────────────
FROM node:24-alpine AS deps
WORKDIR /app

# Só os manifestos: assim esta camada só invalida quando uma dependência
# muda, não a cada alteração de código.
COPY package.json package-lock.json ./
# `npm ci` respeita o lockfile exatamente — nunca resolve versões novas.
RUN npm ci

# ── 2. Build ──────────────────────────────────────────────────────────────
FROM node:24-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# O Prisma Client é gerado em src/generated (ver schema.prisma), que está
# no .gitignore — precisa ser gerado aqui dentro, antes do build.
RUN npx prisma generate

# O build do Next não abre conexão com o banco (não há geração estática
# que consulte dados), mas a validação de env do Prisma exige a variável
# presente. Este valor é descartado: o runtime recebe a URL real.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── 3. Runtime ────────────────────────────────────────────────────────────
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3040
ENV HOSTNAME=0.0.0.0

# Nunca rodar como root: um RCE na aplicação não deve virar root no
# container.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 --ingroup nodejs nextjs

# `standalone` já traz o server.js e só as dependências realmente
# alcançadas pelo file tracing.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3040

# O healthcheck bate em /api/health, que confere o banco de verdade
# (src/app/api/health/route.ts) — processo de pé com Postgres fora não
# conta como saudável.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3040/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
