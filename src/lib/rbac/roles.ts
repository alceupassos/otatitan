import type { PermissionCode } from "./permissions";

/**
 * Papéis de sistema — transcrição direta de docs/07-matriz-permissoes.md.
 * Ao mudar aqui, atualize a tabela naquele documento (e vice-versa): o
 * teste de RBAC lê os dois e falha se divergirem.
 *
 * O superadmin de plataforma NÃO está aqui: é a flag `User.isSuperadmin`,
 * resolvida fora de membership de tenant, e não concede nada dentro de um
 * tenant sem impersonação auditada.
 */
export const ROLE_SLUGS = [
  "company_admin",
  "reservations_manager",
  "sales_agent",
  "finance",
  "operations_coordinator",
  "cleaning_staff",
  "maintenance_staff",
  "property_owner",
  "guest",
] as const;

export type RoleSlug = (typeof ROLE_SLUGS)[number];

export const ROLE_LABELS: Record<RoleSlug, string> = {
  company_admin: "Administrador da empresa",
  reservations_manager: "Gestor de reservas",
  sales_agent: "Atendente comercial",
  finance: "Financeiro",
  operations_coordinator: "Coordenador operacional",
  cleaning_staff: "Profissional de limpeza",
  maintenance_staff: "Profissional de manutenção",
  property_owner: "Proprietário do imóvel",
  guest: "Hóspede",
};

/**
 * Papéis cujo acesso é limitado às PRÓPRIAS linhas, não a todas do tenant.
 * A permissão diz "pode ver reservas"; o escopo diz "só as suas".
 * Aplicado por assertOwnership/scopeFor em guard.ts — permissão sozinha
 * nunca basta para estes papéis.
 */
export const SELF_SCOPED_ROLES = new Set<RoleSlug>([
  "property_owner",
  "guest",
  "cleaning_staff",
  "maintenance_staff",
]);

export const SYSTEM_ROLES: Record<RoleSlug, readonly PermissionCode[]> = {
  company_admin: [
    "properties.view", "properties.create", "properties.edit", "properties.delete", "properties.export",
    "units.view", "units.create", "units.edit", "units.delete",
    "media.view", "media.create", "media.edit", "media.delete",
    "owners.view", "owners.create", "owners.edit", "owners.delete",
    "guests.view", "guests.create", "guests.edit", "guests.delete", "guests.export",
    "reservations.view", "reservations.create", "reservations.edit", "reservations.delete", "reservations.export",
    "availability.view", "availability.create", "availability.edit", "availability.delete",
    "rates.view", "rates.create", "rates.edit", "rates.delete",
    "payments.view", "payments.create", "payments.export", "payments.approve",
    "refunds.view", "refunds.create", "refunds.approve",
    "tasks.view", "tasks.create", "tasks.edit", "tasks.delete",
    "reports.view", "reports.export",
    "users.view", "users.create", "users.edit", "users.delete", "users.admin",
    "roles.view", "roles.admin",
    "settings.view", "settings.admin",
    "audit.view", "audit.export",
  ],

  reservations_manager: [
    "properties.view", "properties.create", "properties.edit",
    "units.view", "units.create", "units.edit",
    "media.view", "media.create", "media.edit",
    "guests.view", "guests.create", "guests.edit",
    "reservations.view", "reservations.create", "reservations.edit", "reservations.delete",
    "availability.view", "availability.create", "availability.edit", "availability.delete",
    "rates.view", "rates.create", "rates.edit",
    "payments.create",
    "tasks.view", "tasks.create", "tasks.edit",
    "reports.view",
  ],

  sales_agent: [
    "properties.view",
    "guests.view", "guests.create", "guests.edit",
    "reservations.view", "reservations.create", "reservations.edit",
    "availability.view",
    "rates.view",
    "payments.create",
  ],

  finance: [
    "properties.view",
    "reservations.view", "reservations.export",
    "rates.view",
    "payments.view", "payments.create", "payments.export", "payments.approve",
    "refunds.view", "refunds.create", "refunds.approve",
    "reports.view", "reports.export",
    "audit.view",
  ],

  operations_coordinator: [
    "properties.view",
    "units.view",
    "reservations.view",
    "availability.view", "availability.create", "availability.edit",
    "tasks.view", "tasks.create", "tasks.edit", "tasks.delete",
  ],

  // Escopo: apenas as próprias tarefas (SELF_SCOPED_ROLES).
  cleaning_staff: ["tasks.view", "tasks.edit"],
  maintenance_staff: ["tasks.view", "tasks.edit"],

  // Escopo: apenas os próprios imóveis (SELF_SCOPED_ROLES).
  property_owner: [
    "properties.view",
    "units.view",
    "media.view",
    "reservations.view",
    "availability.view",
    "rates.view",
    "reports.view", "reports.export",
  ],

  // Escopo: apenas a própria reserva (SELF_SCOPED_ROLES).
  guest: ["reservations.view", "availability.view", "payments.view"],
};

export function permissionsForRole(slug: RoleSlug): readonly PermissionCode[] {
  return SYSTEM_ROLES[slug] ?? [];
}

const ROLE_SLUG_SET = new Set<string>(ROLE_SLUGS);

export function isRoleSlug(value: string): value is RoleSlug {
  return ROLE_SLUG_SET.has(value);
}
