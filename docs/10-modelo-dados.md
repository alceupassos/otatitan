# 10 — Modelo de Dados

## Implementado neste ciclo (ver `prisma/schema.prisma`)

**Plataforma (não tenant-scoped)**: `Tenant`, `User`, `Account`,
`Session`, `VerificationToken`, `PasswordResetToken`, `Permission`,
`Role` (`tenantId` nulo = template de sistema), `RolePermission`,
`Membership`.

**Tenant-scoped**: `Owner` (mínimo, só como FK de `Property`), `Property`,
`Unit`, `Amenity` (`tenantId` nulo = catálogo global), `UnitAmenity`,
`Media`, `Guest`, `RatePlan`, `DailyRate`, `AvailabilityBlock`,
`Reservation`, `ReservationGuest`, `Payment`, `WebhookEvent`, `Task`,
`Consent`, `AuditLog` (`tenantId` nulo = ação de plataforma).

`AvailabilityBlock` é o livro-razão único de ocupação (reservas E
bloqueios manuais) — ver ADR-005 em `09-arquitetura.md`.

## Entidades futuras (v2/v3 — não implementadas agora)

Convenção obrigatória para qualquer uma destas quando for implementada:
`tenantId` + `@@schema("otatitan")` + toda unique prefixada por
`tenantId` + RLS habilitada e forçada na migration. Verificado
mecanicamente por `scripts/check-tenant-columns.ts`.

| Entidade | Escopo | FK pai | Módulo | Versão |
|---|---|---|---|---|
| `ManagementContract` | tenant | `Owner`, `Property` | Repasse | v2 |
| `PricingRule` | tenant | `Unit`/`RatePlan` | Tarifas | v2 |
| `Quote` | tenant | `Unit` | Reservas | v2 |
| `Refund` | tenant | `Payment` | Financeiro | v2 |
| `SecurityDeposit` | tenant | `Reservation` | Reservas | v2 |
| `Invoice` | tenant | `Reservation`/`Tenant` | Financeiro | v2 |
| `Expense` | tenant | `Property` | Financeiro | v2 |
| `Payout` | tenant | `Owner` | Repasse | v2 |
| `OwnerStatement` | tenant | `Payout` | Repasse | v2 |
| `Checklist` | tenant | `Task` | Operação | v2 |
| `MaintenanceTicket` | tenant | `Unit` | Manutenção | v2 |
| `Message` | tenant | `Guest`/`Reservation` | CRM | v2 |
| `MessageTemplate` | tenant | — | CRM | v2 |
| `Notification` | tenant | `User` | CRM | v2 |
| `Document` | tenant | polimórfico | Onboarding/CRM | v2 |
| `Channel` | tenant | — | Channel Manager | v3 |
| `ChannelListing` | tenant | `Unit`, `Channel` | Channel Manager | v3 |
| `SyncJob` | tenant | `ChannelListing` | Channel Manager | v3 |
| `Automation` | tenant | — | CRM | v3 |
| `InventoryItem` | tenant | `Property` | Manutenção | v3 |
| `Review` | tenant | `Reservation` | CRM | v3 |
| `Webhook` (outbound) | tenant | — | Admin do SaaS | v3 |
| `Subscription` | tenant | `Tenant` | Admin do SaaS | v3 |
| `FeatureFlag` | tenant nulo (global) ou tenant | — | Admin do SaaS | v3 |

Ver também comentário no rodapé de `prisma/schema.prisma` apontando para
esta tabela.
