# 09 — Arquitetura (ADRs)

## ADR-001 — Prisma 7 em vez de Drizzle
O workspace `angra\` tem dois projetos (`fenix`, `semantix`) usando
Drizzle como convenção de facto. Otatitan usa **Prisma 7** por pedido
explícito do usuário no briefing original. Divergência documentada, não
um erro de leitura do padrão do workspace. Prisma 7 exige driver adapter
(`@prisma/adapter-pg`) e move a config de conexão para `prisma.config.ts`
em vez do datasource do schema.

## ADR-002 — Isolamento multi-tenant em 4 camadas
Nenhum projeto do workspace implementa isolamento multi-tenant real — foi
desenhado do zero. Camadas, da mais forte para a mais fraca:

1. **Forma do schema**: `tenantId` em toda tabela + FKs compostas
   `(tenantId, id)` entre pai e filho. Uma reserva não consegue apontar
   para unidade/imóvel/hóspede de outro tenant nem com tudo o mais
   desligado.
2. **Postgres RLS**, fail-closed, com `FORCE ROW LEVEL SECURITY` e a role
   de runtime (`otatitan_app`) sem `BYPASSRLS`. Esta é a garantia real.
3. **`DEFAULT` de coluna** em `tenantId`, lendo o mesmo GUC de sessão que
   o RLS usa. Um `INSERT` que "esquece" o tenant é carimbado corretamente
   em vez de criar linha órfã — e, de quebra, torna `tenantId` opcional no
   input do Prisma, o que elimina a necessidade de cast em todo `create`.
4. **Prisma Client Extension** com `AsyncLocalStorage`: injeta o filtro
   automaticamente e lança se não houver contexto. É ergonomia + defesa em
   profundidade; um bug aqui faz a query falhar, não vazar.

Nenhuma camada sozinha basta — a combinação é o que garante que um `WHERE`
esquecido não vira vazamento entre empresas. Verificado por
`tests/integration/tenant-isolation.test.ts` (7 asserções), que conecta
como `otatitan_app` de propósito: rodar como superuser bypassaria o RLS e
faria o teste passar em falso.

**Armadilha encontrada na implementação** (vale registrar): `SET LOCAL`
reverte no fim da transação, mas um GUC customizado nunca definido no
nível da sessão volta a `''`, não a `NULL`. Numa conexão de pool
reciclada, `''::uuid` estourava `22P02` em vez de simplesmente não ver
linha nenhuma. Nunca foi vazamento — o `SET LOCAL` reverte de verdade e
não retém o tenant anterior — mas era o modo de falha errado. Corrigido
com `nullif(current_setting(...), '')` nas políticas (migration
`20260801220000_rls_nullif_hardening`).

## ADR-003 — Constraint de exclusão GiST contra overbooking
Alternativas consideradas: transação `SERIALIZABLE` com retry na
aplicação, checagem otimista antes de inserir. Escolhido: **constraint de
exclusão GiST** no Postgres sobre `availability_block` (unit_id +
daterange), reforçada por `pg_advisory_xact_lock` para reduzir retries sob
concorrência alta. Motivo: a garantia fica no banco, independente de bugs
de aplicação, código futuro do channel manager, ou workers — a alternativa
`SERIALIZABLE` depende de todo caminho de código implementar retry
corretamente para sempre.

## ADR-004 — Stripe Checkout Session hospedado (não Elements/PaymentIntent direto)
Escolhido para o primeiro ciclo porque elimina qualquer dado de cartão do
nosso servidor (SAQ-A em vez de SAQ-A-EP no PCI DSS) e é implementável em
menos tempo. O adapter (`PaymentProvider`) abstrai essa escolha — trocar
para Elements/PaymentIntents ou adicionar Mercado Pago/Pagar.me depois não
exige mudança em reservas/tarefas/auditoria.

## ADR-005 — AvailabilityBlock como livro-razão único de ocupação
Reservas e bloqueios manuais (manutenção, uso do proprietário) escrevem na
mesma tabela `AvailabilityBlock`. Isso permite que uma única constraint de
exclusão cubra os dois casos, e que a consulta de disponibilidade seja uma
única query em vez de duas consultas que precisariam ser combinadas com
cuidado.

## ADR-006 — Sem tabelas-esqueleto para entidades futuras
Entidades de v2/v3 (Owner, Invoice, Channel etc.) não viram tabelas vazias
agora — só documentação (`10-modelo-dados.md`) + um script de CI que barra
qualquer tabela nova sem `tenantId`/RLS quando forem implementadas. Tabelas
vazias convidam a drift de schema e formatos meio-certos.

## ADR-007 — Autorização em duas camadas: proxy otimista + guarda no dado
O `src/proxy.ts` (antigo `middleware.ts`; renomeado no Next.js 16) só lê o
JWT do cookie e redireciona. Ele **não** consulta o banco, porque roda em
toda navegação — inclusive em prefetch de `<Link>` — e uma query por
prefetch seria um custo permanente para um ganho de UX.

Consequência aceita: a checagem do proxy usa o mapa estático papel →
permissões (`SYSTEM_ROLES`), não as permissões reais do banco. Um papel
customizado pode passar pelo proxy e ser barrado na página. O contrário —
passar na página sem ter permissão — não acontece, porque a autorização
que vale é `requireActorWith(...)`, executada junto ao dado, lendo o banco
via `resolvePermissions`. O proxy é pré-filtro de UX; a página é o portão.

Pelo mesmo motivo o JWT carrega só `roleSlug` + `permVersion`, nunca a
lista de permissões: um token com permissões embutidas continuaria valendo
depois de o papel mudar, até expirar. `permVersion` é a chave de
invalidação — bumpar `Tenant.permVersion` torna todo cache de permissão
daquele tenant inalcançável de uma vez, sem varrer chaves no Redis.

## ADR-008 — MFA no mesmo formulário, sem sessão parcial
Alternativa comum: autenticar a senha, criar uma sessão "pendente de MFA"
e redirecionar para `/mfa`. Escolhido: **pedir o código no próprio
`/login`** — o servidor responde `mfa_obrigatorio`, o formulário revela o
campo, e senha + código voltam juntos.

Motivo: uma sessão meio autenticada é um estado a mais para proteger em
todo lugar (cada rota precisa saber distinguir "logado" de "logado mas
não verificado"), e é exatamente o estado que costuma ser esquecido em
alguma rota nova. Sem ele, só existem dois estados: sem sessão e com
sessão completa.

## ADR-009 — Login fail-open no rate limit, fail-closed na conta
O rate limit por IP/e-mail vive no Redis e é **fail-open**: com o cache
fora, a tentativa passa. Fechar ali derrubaria o login de todos os
clientes por causa de um componente que não é fonte de verdade.

O que não é fail-open é o bloqueio por conta (`User.failedLoginCount` +
`lockedUntil`), que vive no banco: 5 falhas → 15 minutos. São camadas
deliberadamente distintas — uma por origem, outra por conta —, e é a
segunda que continua de pé quando o Redis cai.

Além disso, todo caminho de falha custa o mesmo tempo: e-mail inexistente
também paga um `bcrypt.compare` contra um hash descartável, senão o tempo
de resposta viraria um oráculo de quais e-mails estão cadastrados. Pela
mesma razão, "e-mail não existe", "senha errada" e "usuário sem senha"
compartilham uma única mensagem, e o pedido de reset de senha sempre
responde sucesso.

## Stack completa
Next.js 16.2.x (App Router) · React 19.2.x · TypeScript · Tailwind CSS v4
· shadcn/ui (`--base radix`) · Prisma 7.x + `@prisma/adapter-pg` ·
PostgreSQL 18 · next-auth v5 beta + `@auth/prisma-adapter` · Redis +
BullMQ 6.x · `@aws-sdk/client-s3` v3 · Zod · Vitest 4.x + Playwright ·
Docker Compose (dev).
