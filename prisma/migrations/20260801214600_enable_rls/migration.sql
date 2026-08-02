-- Isolamento multi-tenant, camada 2: Postgres Row-Level Security,
-- fail-closed (docs/09-arquitetura.md, ADR-002).
--
-- Sem app.current_tenant_id definido na sessão, current_setting(...,true)
-- retorna NULL, a comparação vira NULL (não TRUE) e a política nega tudo
-- por padrão — zero linhas, nenhuma escrita. FORCE ROW LEVEL SECURITY
-- garante que isso vale mesmo para o dono da tabela (exceto otatitan_owner,
-- que tem BYPASSRLS por rodar migrations e seeds — ver scripts/db-init/01-roles.sh).

-- ── Tabelas tenant-scoped "estritas" (tenantId NOT NULL) ───────────────────
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'Owner', 'Property', 'Unit', 'UnitAmenity', 'Media', 'Guest',
    'RatePlan', 'DailyRate', 'AvailabilityBlock', 'Reservation',
    'ReservationGuest', 'Payment', 'Task', 'Consent', 'Membership'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', 'otatitan', t);
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', 'otatitan', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I.%I FOR ALL TO otatitan_app
         USING ("tenantId" = current_setting(''app.current_tenant_id'', true)::uuid)
         WITH CHECK ("tenantId" = current_setting(''app.current_tenant_id'', true)::uuid)',
      'otatitan', t
    );
    EXECUTE format(
      'CREATE POLICY platform_all ON %I.%I FOR ALL TO otatitan_platform USING (true) WITH CHECK (true)',
      'otatitan', t
    );
  END LOOP;
END $$;

-- ── Amenity / Role: tenantId nulo = catálogo/template global, legível por
--    qualquer tenant, mas só gravável para o próprio tenant ────────────────
ALTER TABLE "otatitan"."Amenity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "otatitan"."Amenity" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "otatitan"."Amenity" FOR ALL TO otatitan_app
  USING ("tenantId" IS NULL OR "tenantId" = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY platform_all ON "otatitan"."Amenity" FOR ALL TO otatitan_platform USING (true) WITH CHECK (true);

ALTER TABLE "otatitan"."Role" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "otatitan"."Role" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "otatitan"."Role" FOR ALL TO otatitan_app
  USING ("tenantId" IS NULL OR "tenantId" = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY platform_all ON "otatitan"."Role" FOR ALL TO otatitan_platform USING (true) WITH CHECK (true);

-- ── AuditLog / WebhookEvent: tenantId nulo = ação de plataforma, NUNCA
--    exposta à role de app mesmo em leitura (comparação estrita) ───────────
ALTER TABLE "otatitan"."AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "otatitan"."AuditLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "otatitan"."AuditLog" FOR ALL TO otatitan_app
  USING ("tenantId" = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY platform_all ON "otatitan"."AuditLog" FOR ALL TO otatitan_platform USING (true) WITH CHECK (true);
-- Append-only: nem a role de app pode alterar ou apagar auditoria (RN-010).
REVOKE UPDATE, DELETE ON "otatitan"."AuditLog" FROM otatitan_app;

ALTER TABLE "otatitan"."WebhookEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "otatitan"."WebhookEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "otatitan"."WebhookEvent" FOR ALL TO otatitan_app
  USING ("tenantId" = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY platform_all ON "otatitan"."WebhookEvent" FOR ALL TO otatitan_platform USING (true) WITH CHECK (true);
-- Webhooks chegam sem tenant resolvido ainda — só o cliente de plataforma
-- (otatitan_platform) grava a linha inicial; o handler resolve o tenant
-- a partir do metadata do provedor e só então usa withTenant(...) para o
-- restante da transação (ver src/lib/payments e src/server/modules/payments).
