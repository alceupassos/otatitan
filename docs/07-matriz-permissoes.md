# 07 — Matriz de Permissões

Esta tabela é a fonte de verdade para `src/lib/rbac/permissions.ts` e para
o seed de papéis (`prisma/seed.ts`). Ações possíveis por módulo: `view`,
`create`, `edit`, `delete`, `export`, `approve`, `admin`.

Papéis (colunas) e o slug correspondente em `src/lib/rbac/roles.ts` — os
slugs abaixo são os identificadores reais no código e no banco:

| Sigla | Papel | Slug | Escopo |
|---|---|---|---|
| SA | Superadmin da plataforma | — (flag `User.isSuperadmin`) | fora do tenant |
| CA | Administrador da empresa | `company_admin` | todo o tenant |
| GR | Gestor de reservas | `reservations_manager` | todo o tenant |
| AC | Atendente comercial | `sales_agent` | todo o tenant |
| FI | Financeiro | `finance` | todo o tenant |
| CO | Coordenador operacional | `operations_coordinator` | todo o tenant |
| CL | Profissional de limpeza | `cleaning_staff` | só as próprias tarefas |
| MA | Profissional de manutenção | `maintenance_staff` | só as próprias tarefas |
| PR | Proprietário do imóvel | `property_owner` | só os próprios imóveis |
| HO | Hóspede | `guest` | só a própria reserva |

Os papéis marcados com escopo restrito estão em `SELF_SCOPED_ROLES`: para
eles, ter a permissão nunca basta — o serviço ainda filtra pelas próprias
linhas.

| Módulo.Ação | CA | GR | AC | FI | CO | CL | MA | PR | HO |
|---|---|---|---|---|---|---|---|---|---|
| properties.view | ✔ | ✔ | ✔ | ✔ | ✔ | – | – | ✔(própria) | – |
| properties.create/edit | ✔ | ✔ | – | – | – | – | – | – | – |
| properties.delete | ✔ | – | – | – | – | – | – | – | – |
| units.view/create/edit | ✔ | ✔ | – | – | ✔(view) | – | – | ✔(view, própria) | – |
| media.view/create/edit | ✔ | ✔ | – | – | – | – | – | ✔(view) | – |
| guests.view/create/edit | ✔ | ✔ | ✔ | – | – | – | – | – | – |
| reservations.view | ✔ | ✔ | ✔ | ✔ | ✔ | – | – | ✔(própria) | ✔(própria) |
| reservations.create/edit | ✔ | ✔ | ✔ | – | – | – | – | – | – |
| reservations.delete/cancel | ✔ | ✔ | – | – | – | – | – | – | – |
| availability.view | ✔ | ✔ | ✔ | – | ✔ | – | – | ✔(própria) | ✔ |
| availability.create/edit (bloqueio manual) | ✔ | ✔ | – | – | ✔ | – | – | – | – |
| rates.view | ✔ | ✔ | ✔ | ✔ | – | – | – | ✔(própria) | – |
| rates.create/edit | ✔ | ✔ | – | – | – | – | – | – | – |
| payments.view | ✔ | – | – | ✔ | – | – | – | – | ✔(própria) |
| payments.create (cobrar) | ✔ | ✔ | ✔ | ✔ | – | – | – | – | – |
| payments.approve (reembolso) | ✔ | – | – | ✔ | – | – | – | – | – |
| tasks.view | ✔ | ✔ | – | – | ✔ | ✔(próprias) | ✔(próprias) | – | – |
| tasks.create/edit | ✔ | ✔ | – | – | ✔ | ✔(concluir própria) | ✔(concluir própria) | – | – |
| reports.view/export | ✔ | ✔(parcial) | – | ✔ | – | – | – | ✔(própria) | – |
| users.view/create/edit | ✔ | – | – | – | – | – | – | – | – |
| roles.admin | ✔ | – | – | – | – | – | – | – | – |
| settings.admin | ✔ | – | – | – | – | – | – | – | – |
| audit.view | ✔ | – | – | ✔(parcial) | – | – | – | – | – |

Papéis customizados: uma empresa pode criar papéis adicionais
(`Role.tenantId != null`), compostos livremente a partir do catálogo de
permissões acima — desde que a empresa em si detenha essa permissão
(não é possível conceder o que não se tem).

Superadmin (SA): não usa esta tabela — é uma flag (`User.isSuperadmin`)
fora do escopo de tenant, sem acesso automático a dados de tenant; toda
ação dentro de um tenant como superadmin passa por impersonação auditada.
