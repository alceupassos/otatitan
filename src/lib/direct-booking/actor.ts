import type { ActorContext } from "@/lib/rbac/guard";

/**
 * Ator sintético do canal direto.
 *
 * Não é um User: `createdById` nas reservas públicas fica com este UUID
 * estável (sem FK para User) e a auditoria usa `actorLabel`. A autorização
 * RBAC é pulada no ponto de entrada (`autorizar: false`) — o gate é o
 * próprio endpoint público, amarrado ao tenant/imóvel configurados.
 *
 * `sales_agent` não é papel de escopo restrito, então `scopeFor` não
 * recorta a carteira; o recorte é o `propertyId` do canal.
 */
export const CANAL_DIRETO_ACTOR_ID = "00000000-0000-4000-8000-000000000914";

export function atorCanalDireto(tenantId: string): ActorContext {
  return {
    userId: CANAL_DIRETO_ACTOR_ID,
    tenantId,
    roleSlug: "sales_agent",
    permVersion: 0,
  };
}
