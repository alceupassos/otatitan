# 12 — Plano de Testes (checklist)

## Constraint anti-overbooking (`tests/integration/availability-constraint.test.ts`) ✅
Ataca a constraint direto no banco, sem passar por serviço — se passa,
nenhum bug de aplicação, retry ou worker consegue sobrepor ocupação.
- [x] Estadias adjacentes `[10,15)` + `[15,20)` → ambas sucedem (RN-001)
- [x] Mesmas datas em outra unidade → permitido
- [x] Sobreposições (à direita, à esquerda, contida, envolvente, idêntica) → todas rejeitadas
- [x] Bloqueio não-bloqueante (`isBlocking=false`) não conflita
- [x] `releasedAt` libera as datas para nova reserva
- [x] Bypass via SQL cru também falha (`23P01`)
- [x] Intervalo invertido/vazio rejeitado

## Concorrência de reserva (`tests/integration/booking-concurrency.test.ts`)
Depende do serviço de reservas (ainda não implementado).
- [ ] 20 chamadas simultâneas, mesma unidade/datas → 1 sucesso, 19 `409`
- [ ] Bloqueio manual vs. reserva simultâneos → exatamente um vence
- [ ] Cancelar e reservar de novo as mesmas datas → sucesso

## Isolamento de tenant (`tests/integration/tenant-isolation.test.ts`) ✅
- [x] Tenant A não lista linhas de B (`findMany`)
- [x] Tenant A não encontra linha de B por id (`findFirst` e `findUnique` → null)
- [x] Tenant A não atualiza/apaga linha de B (0 linhas afetadas)
- [x] `create` com `tenantId` forjado no body é sobrescrito para o tenant do contexto
- [x] Query raw dentro de `withTenant(A)` só retorna linhas de A (prova RLS, não só a extensão)
- [x] Ausência de contexto de tenant lança erro + SQL cru vê zero linhas (fail-closed)
- [x] `DEFAULT` da coluna carimba o tenant mesmo em `INSERT` cru sem `tenantId`
- [ ] HTTP: tenant A pedindo recurso de B → `404` (nunca `403`) — depende das rotas

## RBAC (`tests/integration/rbac.test.ts`)
- [ ] Tabela-orientado sobre `07-matriz-permissoes.md`: todo par (papel, endpoint)
- [ ] `property_owner` só vê seus próprios imóveis (teste de escopo, não só permissão)
- [ ] Papel customizado com só `reservations.view` recebe 403 em create
- [ ] Middleware: JWT de `cleaning_staff` em `/configuracoes` é redirecionado

## Unitários
- [ ] `computeQuote` (soma por noite, taxa de limpeza, estadia mínima, data fechada, tarifa ausente → indisponível)
- [ ] Helpers de datas semiabertas, incluindo DST em `America/Sao_Paulo`
- [ ] `tenantExtension` (reescrita `findUnique`→`findFirst`, injeção em `create`, erro sem contexto)
- [ ] Normalização de webhook Stripe a partir de fixtures gravadas

## E2E (Playwright, `tests/e2e/vertical-flow.spec.ts`)
- [ ] Login → criar propriedade → unidade → plano de tarifa + tarifas em lote
- [ ] Busca de disponibilidade mostra a unidade com o total esperado
- [ ] Criar reserva → `PENDING` com contagem de hold
- [ ] Checkout Stripe modo teste (webhook assinado localmente em CI)
- [ ] Reserva vira `CONFIRMED`, pagamento `SUCCEEDED`
- [ ] Tarefa de check-in aparece com o vencimento correto
- [ ] Calendário mostra a unidade bloqueada
- [ ] Segunda tentativa de reserva nas mesmas datas falha corretamente

## Guarda de CI
- [ ] `scripts/check-tenant-columns.ts`: toda tabela tenant-scoped tem
      `tenantId`, RLS habilitada e forçada; constraint de exclusão existe
