@AGENTS.md

# Otatitan

Plataforma SaaS multiempresa (multi-tenant) de gestão profissional de
imóveis de aluguel por temporada — produto original, sem relação com
Stays.net/Guesty/Hostaway/Lodgify além da categoria de mercado. Nome
provisório: **Otatitan**.

## Regra de idioma

**Responda sempre em português (pt-BR) neste projeto.** Código, nomes de
variáveis e commits podem ser em inglês (convenção usual), mas toda
comunicação com o usuário, comentários de domínio e documentação em
`docs/` são em português.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4
(`@theme` em `src/app/globals.css`, sem `tailwind.config.js`) · shadcn/ui
(`--base radix`) · Prisma 7 (`@prisma/adapter-pg`, config em
`prisma.config.ts`, não no datasource) · PostgreSQL 18 · next-auth v5 beta
+ `@auth/prisma-adapter` · Redis + BullMQ · `@aws-sdk/client-s3` v3 ·
Stripe · Zod · Vitest + Playwright.

Porta de desenvolvimento: **3040** (evita conflito com `fenix`:3020 e
outros projetos do workspace `angra\`).

## Comandos

```
npm run dev            # app em http://localhost:3040
npm run worker          # processo de fila BullMQ (separado)
npm run db:migrate      # prisma migrate dev
npm run db:seed         # popula permissões, papéis, tenant demo
npm run test            # unitários (vitest, sem banco)
npm run test:integration # isolamento de tenant, concorrência, RBAC (precisa de Postgres)
npm run test:e2e        # Playwright, fluxo vertical completo
```

Subir a infra local: `docker compose up -d db redis minio mailpit`.

## Não-negociáveis (ver `docs/05-regras-de-negocio.md`)

- **Isolamento multi-tenant em 4 camadas**: FKs compostas `(tenantId, id)`
  + Postgres RLS fail-closed + `DEFAULT` de coluna que carimba o tenant da
  sessão + Prisma Client Extension com `AsyncLocalStorage`. Nunca acessar
  dados de tenant fora de `withTenant(...)` (`src/lib/db/with-tenant.ts`).
  Coberto por `tests/integration/tenant-isolation.test.ts`.
- **Zero overbooking**: garantido por uma constraint de exclusão GiST no
  Postgres sobre `availability_block` — não confiar só em checagem de
  aplicação.
- **Nunca armazenar dado de cartão** (PAN/CVV/validade). Pagamentos via
  adapter (`src/lib/payments/provider.ts`), Stripe Checkout hospedado.
- **Dinheiro sempre em centavos** (`Int`) + coluna de moeda. Nunca `Float`.
- **Datas de estadia são semiabertas** `[check_in, check_out)` — same-day
  turnover é permitido e não é conflito.
- **Preço sempre recalculado no servidor** — nunca aceitar o total vindo do
  cliente.
- Toda ação crítica gera `AuditLog` (append-only).

## Documentação canônica

Ver `docs/` (numerados `00`–`12`) para especificação funcional, personas,
jornadas, casos de uso, regras de negócio, mapa de navegação, matriz de
permissões (fonte de `src/lib/rbac/permissions.ts`), backlog, arquitetura,
modelo de dados, segurança/LGPD e plano de testes. `DESIGN.md` documenta o
sistema de design (paleta, tipografia, componentes, gráficos, animação).
