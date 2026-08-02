/**
 * Catálogo de permissões — fonte única de verdade, espelhada em três
 * lugares: os tipos daqui, o seed do banco (prisma/seed.ts) e a tabela em
 * docs/07-matriz-permissoes.md.
 *
 * Formato do código: `modulo.acao`.
 */

export const MODULES = [
  "properties",
  "units",
  "media",
  "owners",
  "guests",
  "reservations",
  "availability",
  "rates",
  "payments",
  "refunds",
  "tasks",
  "reports",
  "users",
  "roles",
  "settings",
  "audit",
] as const;

export const ACTIONS = [
  "view",
  "create",
  "edit",
  "delete",
  "export",
  "approve",
  "admin",
] as const;

export type Module = (typeof MODULES)[number];
export type Action = (typeof ACTIONS)[number];
export type PermissionCode = `${Module}.${Action}`;

/**
 * Nem todo módulo suporta toda ação — gerar o produto cartesiano cheio
 * criaria permissões sem sentido (ex: `audit.create`) que poluiriam a UI
 * de papéis customizados e a matriz de docs/07.
 */
const MODULE_ACTIONS: Record<Module, readonly Action[]> = {
  properties: ["view", "create", "edit", "delete", "export"],
  units: ["view", "create", "edit", "delete"],
  media: ["view", "create", "edit", "delete"],
  owners: ["view", "create", "edit", "delete"],
  guests: ["view", "create", "edit", "delete", "export"],
  reservations: ["view", "create", "edit", "delete", "export"],
  availability: ["view", "create", "edit", "delete"],
  rates: ["view", "create", "edit", "delete"],
  payments: ["view", "create", "export", "approve"],
  refunds: ["view", "create", "approve"],
  tasks: ["view", "create", "edit", "delete"],
  reports: ["view", "export"],
  users: ["view", "create", "edit", "delete", "admin"],
  roles: ["view", "admin"],
  settings: ["view", "admin"],
  audit: ["view", "export"],
};

function buildCatalog(): PermissionCode[] {
  const codes: PermissionCode[] = [];
  for (const mod of MODULES) {
    for (const action of MODULE_ACTIONS[mod]) {
      codes.push(`${mod}.${action}` as PermissionCode);
    }
  }
  return codes;
}

export const PERMISSION_CODES: readonly PermissionCode[] = buildCatalog();

const PERMISSION_SET = new Set<string>(PERMISSION_CODES);

export function isPermissionCode(value: string): value is PermissionCode {
  return PERMISSION_SET.has(value);
}

export function parsePermission(code: PermissionCode): {
  module: Module;
  action: Action;
} {
  const [module, action] = code.split(".") as [Module, Action];
  return { module, action };
}

const MODULE_LABELS: Record<Module, string> = {
  properties: "Imóveis",
  units: "Unidades",
  media: "Mídia",
  owners: "Proprietários",
  guests: "Hóspedes",
  reservations: "Reservas",
  availability: "Disponibilidade",
  rates: "Tarifas",
  payments: "Pagamentos",
  refunds: "Reembolsos",
  tasks: "Tarefas",
  reports: "Relatórios",
  users: "Usuários",
  roles: "Papéis",
  settings: "Configurações",
  audit: "Auditoria",
};

const ACTION_LABELS: Record<Action, string> = {
  view: "visualizar",
  create: "criar",
  edit: "editar",
  delete: "excluir",
  export: "exportar",
  approve: "aprovar",
  admin: "administrar",
};

/** Descrição em pt-BR, usada no seed e na UI de papéis customizados. */
export function describePermission(code: PermissionCode): string {
  const { module, action } = parsePermission(code);
  return `${ACTION_LABELS[action]} ${MODULE_LABELS[module]}`;
}
