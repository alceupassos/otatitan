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

**Próximo**: CRUD de imóveis/unidades, calendário de disponibilidade,
motor de preço no servidor e fluxo de reserva com pagamento.

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
