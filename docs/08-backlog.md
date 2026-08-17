# 08 — Backlog (MVP / v2 / v3)

## Estado atual (atualizar a cada entrega)

**Pronto e verificado**
- Modelo de dados completo (21 entidades) + migrations.
- Isolamento multi-tenant nas 4 camadas, com RLS fail-closed. Guarda de CI
  (`npm run check:tenant-columns`) cobre 19 tabelas.
- Constraint de exclusão GiST anti-overbooking.
- Catálogo de RBAC (59 permissões, 9 papéis) + `resolvePermissions` com
  cache versionado por `Tenant.permVersion`.
- Seed idempotente: catálogo global, 2 tenants demo, 11 usuários, 3
  imóveis, 4 unidades, 6 reservas, pagamentos e tarefas.
- Autenticação: credenciais + bcrypt(12), bloqueio por conta, rate limit
  por IP/e-mail, MFA TOTP com códigos de recuperação, reset de senha por
  e-mail, troca de empresa. Proxy (`src/proxy.ts`) + DAL
  (`requireActorWith`).
- Telas: `/login`, `/esqueci-senha`, `/redefinir-senha`,
  `/selecionar-empresa`, `/dashboard`.
- CRUD de imóveis e unidades (`/imoveis`, `/imoveis/novo`,
  `/imoveis/[id]`, `/imoveis/[id]/unidades/*`) com busca, filtro por
  situação, comodidades, arquivamento e auditoria. Navegação principal
  filtrada por permissão.
- Configuração de pagamento validada (Stripe + Asaas), sem adapter de
  cobrança ainda.

- Calendário de ocupação (`/calendario`): grade unidade × dia, navegação
  por mês, bloqueio manual (manutenção / uso do proprietário / outro) e
  liberação. Reserva e bloqueio no mesmo livro-razão (ADR-005).

- Tarifas (`/tarifas`, `/tarifas/[unitId]`): planos com política de
  cancelamento e regras de estadia, publicação de diárias em lote (com
  filtro por dia da semana), fechamento para venda/chegada/saída, e
  relatório de cobertura que aponta a primeira lacuna sem tarifa.

- Motor de preço no servidor (`src/lib/pricing/quote.ts`): cotação pura,
  noite a noite, com `quoteSnapshot` versionado e `precoConfere` — o total
  vindo do cliente é conferência, nunca fonte (RN-003).
- Busca de disponibilidade (`src/lib/availability/search.ts`): devolve
  vendáveis, recusadas **com o motivo tipado** e ocupadas com origem.
- Fluxo de reserva ponta a ponta: `criarReserva` (hold de 30 min),
  `confirmarReserva`, `cancelarReserva`, check-in/check-out,
  `registrarPagamentoManual` e `confirmarReservaPorPagamento`, com
  máquina de estados em `src/lib/reservations/estados.ts` e auditoria em
  toda transição.
- Telas de reserva: `/reservas` (filtros por status, período, imóvel e
  busca por código/hóspede, ordenação, paginação e contagem regressiva do
  hold), `/reservas/nova` (busca → resultado → hóspede → confirmação, com
  reexibição da cotação quando o preço muda entre a cotação e o clique) e
  `/reservas/[id]` (quebra congelada do `quoteSnapshot`, pagamentos com
  saldo devedor, tarefas e ações limitadas por `podeTransicionar` + RBAC).
- Webhook do Stripe fechando o ciclo: assinatura verificada → `WebhookEvent`
  (unique `(provider, eventId)`) → baixa do `Payment` → incremento de
  `paidCents` → `confirmarReservaPorPagamento` **dentro da mesma
  transação** → `agendarTarefasDaReserva` **depois do commit** (RN-008).
  Reenvio do Stripe não confirma duas vezes nem soma o dinheiro de novo: o
  `updateMany` condicionado ao status é o guarda de idempotência.
- `ROUTE_RULES` e navegação principal incluem `/reservas` (o proxy
  registra o prefixo de leitura; `/reservas/nova` exige
  `reservations.create` na própria página). `tests/unit/auth-routes.test.ts`
  confere a sincronia com `docs/06-mapa-navegacao.md`.

- Cobrança por link ponta a ponta (`src/lib/payments/cobranca.ts`): botão na
  tela da reserva, `Payment` PENDING criado antes da chamada de rede,
  `createCheckout` no provedor e retorno numa página **pública**
  (`/stays/pagamento`) — o link circula até o hóspede, que não tem conta no
  painel. Dedupe por trava de reserva no banco (o Asaas não tem chave de
  idempotência na criação), link com validade amarrada ao hold restante e
  recusa legível quando sobra menos que o mínimo do provedor.
- Adapter do **Asaas** (`src/lib/payments/providers/asaas.ts`), provedor padrão
  do produto: checkout hospedado com PIX e cartão, webhook verificado por token
  em tempo constante, entrega dupla (`PAYMENT_CONFIRMED` + `PAYMENT_RECEIVED`)
  tratada como o caso normal que é.
- Suíte de integração executada com Postgres e Redis de pé: **77 testes**
  passando em 8 arquivos, mais 277 unitários. `next build` limpo.

**Próximo**: validar um pagamento real de valor baixo ponta a ponta (único
passo que os testes não cobrem, porque exige a API de produção), telas de
`/tarefas` e `/configuracoes`.

**Dívidas deste ciclo**
- UC-010 previa um assistente de 6 passos com rascunho por etapa; o que
  existe é um formulário único que salva como `DRAFT`. O rascunho
  funciona, o passo-a-passo não.
- Mídia/fotos de imóvel (`Media`): UI na aba Fotos do imóvel. S3 se
  configurado; senão disco local `uploads/media`. O canal direto Madre 914
  usa `/fotos` estático (fachada e hall do site ao vivo).
- Canal direto público no mesmo app (`madre914.com.br` vs painel):
  cotação no servidor, hold, Asaas, 4 studios reais.
- "Excluir" imóvel/unidade é **arquivar**, nunca apagar: reservas,
  pagamentos e auditoria apontam para eles.
- **Nenhum pagamento real passou pelo fluxo.** O Asaas está em PRODUÇÃO
  (`npm run check:payments` avisa), e nenhum teste toca a API de verdade — de
  propósito, a chave move dinheiro. Falta uma cobrança de valor baixo ponta a
  ponta antes de confiar no fluxo.
- **A URL do checkout mora em `Payment.description`**, porque não há coluna
  para ela e sem persistir o link não há reaproveitamento. Aparece crua no
  extrato da reserva. Uma migration com `checkoutUrl` + `checkoutExpiresAt`
  resolveria isso e a validade derivada de `createdAt`.
- **Reembolsos parciais sucessivos não acumulam.** O valor reembolsado que os
  provedores mandam é acumulado, e sem uma coluna `refundedCents` em `Payment`
  não há como saber quanto já foi descontado. O segundo estorno é sinalizado
  para conferência manual em vez de descontado em silêncio — mas ainda exige
  mudança de schema para fechar.
- **Não há job de reconciliação** para `Payment` PENDING órfão (tentativa cuja
  rede caiu antes de o provedor responder). Não retém data — o hold expira
  normalmente porque `paidCents` não muda —, mas fica no extrato.
- **`DailyRate` não tem `maxNights`, só `minNights`** (`Unit` e `RatePlan`
  têm ambos). Não dá para limitar a estadia máxima por data — só por
  unidade/plano.
- **`taxesTotalCents` e `discountsTotalCents` são sempre 0** em
  `src/lib/pricing/quote.ts`: o schema v1 não tem cadastro de imposto nem de
  cupom. Os campos existem na cotação para não quebrar o `quoteSnapshot`
  quando existirem.
- **`ioredis` entrou como dependência nova neste ciclo.** O `bullmq@6.0.5`
  importa `ioredis/built/utils` de forma estática mesmo declarando o pacote
  como peer *opcional*, então sem ele qualquer `import` de `bullmq` estoura
  antes de rodar código nosso — `npm run worker` simplesmente não subia. A
  dependência é legítima, mas revisar no commit.
- **`npm run worker` não carregava o `.env`.** Era o único script sem
  `dotenv -e .env --`, então `PLATFORM_DATABASE_URL` chegava `undefined` e
  todo job falhava. Passava despercebido porque `redisUrl()` tem *fallback*
  para a porta certa: o Redis conectava e dava a impressão de ambiente
  carregado. Corrigido; verificado subindo o worker com zero falha de job.
- **Sem `<Toaster />` montado.** `src/components/ui/sonner.tsx` existe, mas
  nenhum layout o monta e nenhuma tela usa `toast()`; todo retorno de ação é
  por `Alert` + `useActionState`. Padronizar exige editar o layout raiz.
- **Não há rota `/hospedes`.** O detalhe da reserva mostra contato e documento
  mascarado, mas não linka para uma ficha de hóspede — ela não existe.
- **`criarReserva` não aceita `guestId` existente**, só `hospede`, resolvido
  por e-mail em `encontrarOuCriarHospede`. Escolher no autocomplete um hóspede
  sem e-mail cadastrado cria ficha duplicada (a tela avisa antes de confirmar).
- **`NO_SHOW` é transição válida em `estados.ts` mas não tem action** que a
  aplique — por isso não há botão para ela.
- **Cancelar exige `reservations.delete`** (e não `.edit`, como o mapa de
  casos de uso sugeria). A UI seguiu o domínio.
- **Quebra de preço desenhada duas vezes.** `components/reservas/quebra-cotacao.tsx`
  (sobre o `quoteSnapshot` congelado, pós-venda) e
  `components/reservas/nova/passo-confirmacao.tsx` (sobre a `Cotacao` viva,
  pré-venda) têm o mesmo layout de noites + totais. As FONTES são
  deliberadamente diferentes — recotar uma reserva vendida seria erro —, mas o
  desenho podia ser um componente só recebendo linhas já normalizadas.
  Enquanto forem dois, mudar o layout exige mudar os dois.
- **`formatarDia` não é usada pela tela de nova reserva.**
  `components/reservas/formato.ts` existe justamente para não espalhar a
  conversão de dia de calendário, mas `nova/passo-confirmacao.tsx` e
  `nova/passo-resultado.tsx` repetem `formatarData(parseDateOnly(...))` inline.
  Não há defeito de fuso hoje (é a mesma composição), só duplicação.
- **`ORIGEM_OCUPACAO_LABELS` é `Record<string, string>`**
  (`components/reservas/nova/tipos.ts`), com fallback `?? u.origem` na tela.
  Por não ser tipado pelo enum, uma origem nova entra em produção como texto
  cru em vez de quebrar o build. Candidato a subir para o domínio, ao lado de
  `MOTIVO_LABELS` (`src/lib/availability/schemas.ts`), que hoje cobre só
  MAINTENANCE/OWNER_STAY/MANUAL e não os casos RESERVATION/CHANNEL_SYNC que a
  busca devolve.

## MVP (este ciclo — fundação + fluxo vertical)
Tenant, User, Role, Permission, Membership, Property, Unit, Amenity,
UnitAmenity, Media, Guest, RatePlan, DailyRate, AvailabilityBlock,
Reservation, ReservationGuest, Payment, WebhookEvent, Task, Consent,
AuditLog. Auth (login, reset de senha, MFA opcional), RBAC, isolamento
multi-tenant, adapter de pagamento (Stripe real + Manual), dashboard,
calendário, site público básico + checkout.

## v2 (próximo ciclo)
- Owner, ManagementContract, PricingRule, Quote, Refund, SecurityDeposit
  (tamanho: M cada)
- Invoice, Expense, Payout, OwnerStatement — módulo financeiro completo (L)
- Checklist, MaintenanceTicket, InventoryItem — operação/manutenção (M)
- Message, MessageTemplate, Notification, Document — CRM/comunicação (L,
  depende de provedor de e-mail/WhatsApp oficial)
- Portal do Proprietário e Portal do Hóspede completos (L cada)
- Relatórios e indicadores avançados exportáveis (M)

## v3
- Channel, ChannelListing, SyncJob — channel manager real (L, depende de
  credenciais oficiais de cada canal)
- Automation — automações de mensagens por evento (M)
- Review — avaliações de hóspede (S)
- Webhook (outbound) — webhooks assinados para integrações de terceiros (M)
- Subscription, FeatureFlag — administração do SaaS/cobrança (L)
- WhatsApp/SMS via provedores oficiais (M, depende de credenciais)
- BI/relatórios avançados, comparação entre períodos, metas (L)

Cada item de v2/v3 tem seu lugar reservado em
`10-modelo-dados.md#entidades-futuras` — não são criadas tabelas vazias
agora, só documentação + guarda de CI para quando forem implementadas.
