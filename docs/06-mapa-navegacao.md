# 06 — Mapa de Navegação

Fonte de verdade para `ROUTE_RULES` em `src/lib/auth/routes.ts`, consumido
por `src/proxy.ts`. (No Next.js 16 o antigo `middleware.ts` chama-se
`proxy.ts` — mesma função, nome novo.) O teste
`tests/unit/auth-routes.test.ts` lê este arquivo e falha se divergirem.

| Rota | Grupo | Permissão mínima |
|---|---|---|
| `/login`, `/esqueci-senha`, `/redefinir-senha` | `(auth)` | pública |
| `/selecionar-empresa` | `(auth)` | autenticado, sem tenant ativo |
| `/dashboard` | `(dashboard)` | qualquer membership ativa |
| `/imoveis`, `/imoveis/novo`, `/imoveis/[id]` | `(dashboard)` | `properties.view` (novo/editar: `.create`/`.edit`) |
| `/tarifas/[unitId]` | `(dashboard)` | `rates.view` (editar: `.edit`) |
| `/calendario` | `(dashboard)` | `availability.view` |
| `/reservas`, `/reservas/nova`, `/reservas/[id]` | `(dashboard)` | `reservations.view` (nova: `.create`) |
| `/reports/channels` | `(dashboard)` | `reports.view` |
| `/tarefas` | `(dashboard)` | `tasks.view` |
| `/configuracoes` | `(dashboard)` | `settings.view` |
| `/configuracoes/usuarios`, `/configuracoes/papeis` | `(dashboard)` | `users.admin` / `roles.admin` |
| `/portal-proprietario/*` | `(owner-portal)` | papel `property_owner` |
| `/portal-hospede/*` | `(guest-portal)` | papel `guest` ou sessão de reserva |
| `/stays/madre-914` | `(direct)` | pública — preview do canal direto (qualquer host) |
| `/stays/pagamento` | `(public)` | pública — retorno do checkout hospedado |
| `/politicas/*` | `(direct)` | pública — políticas do canal direto Madre 914 |
| `/` no host `madre914.com.br` | `(direct)` | pública — mesmo conteúdo de `/stays/madre-914` |
| `/` no host do painel | — | redireciona para `/login` ou `/dashboard` |
| `/api/auth/*`, `/api/webhooks/*`, `/api/health` | — | fora do gate de auth/CSRF do proxy |
| `/api/*` (resto) | — | sessão válida + `requirePermission` por rota |

A rota **mais específica vence**: `/configuracoes/usuarios` exige
`users.admin`, não o `settings.view` do prefixo pai.

**As permissões de escrita entre parênteses não são regra de proxy.** Para
`/imoveis/novo` (`properties.create`), `/tarifas/[unitId]` em edição
(`rates.edit`) e `/reservas/nova` (`reservations.create`), `ROUTE_RULES`
registra apenas o prefixo de leitura; a permissão de escrita é exigida na
própria página com `requireActorWith(...)` — em `/reservas/nova`,
`requireActorWith("reservations.create")`. É deliberado: o proxy só lê o
cookie e não consulta o banco, então um prefixo mais específico ali só
adiantaria um redirecionamento *otimista*, antes da checagem que de fato
autoriza (ADR-007).

Não logado em rota protegida → redireciona para `/login?callbackUrl=...`
(só caminho relativo do próprio app é aceito, para não virar open
redirect). Logado sem tenant ativo → `/selecionar-empresa`. Papel sem a
permissão mínima da rota → redireciona para a home do seu próprio papel
(`ROLE_HOME`), nunca para uma página de 403.

**Não há rota `/mfa`.** O segundo fator é pedido no próprio `/login`: o
formulário revela o campo de código quando o servidor responde
`mfa_obrigatorio`, e a senha é reenviada junto. Uma sessão "meio
autenticada" navegável seria superfície de ataque a mais (ADR-007).

O proxy faz apenas a checagem **otimista** — lê o token do cookie, sem
tocar no banco, porque roda em toda navegação inclusive prefetch. A
autorização que vale é `requireActorWith(...)` na página ou na server
action, junto ao dado.
