-- Endurecimento das políticas de RLS: tratar string vazia como "sem tenant".
--
-- Motivo (descoberto pelo teste de isolamento, asserção (f)):
-- `SET LOCAL` reverte no fim da transação, mas um GUC customizado que nunca
-- foi definido no nível da sessão NÃO volta a ser NULL — volta a ser ''.
-- Numa conexão de pool que já serviu um withTenant(...), uma query fora de
-- contexto de tenant recebia ''::uuid e estourava 22P02 em vez de
-- simplesmente não ver linha nenhuma.
--
-- Importante: isso nunca foi um vazamento — o SET LOCAL reverte de verdade
-- e nunca retém o tenant anterior. Era um modo de falha errado (erro de
-- banco em vez de zero linhas). nullif(...) restaura o fail-closed limpo.

DO $$
DECLARE
  t text;
  strict_tables text[] := ARRAY[
    'Owner', 'Property', 'Unit', 'UnitAmenity', 'Media', 'Guest',
    'RatePlan', 'DailyRate', 'AvailabilityBlock', 'Reservation',
    'ReservationGuest', 'Payment', 'Task', 'Consent', 'Membership',
    'AuditLog', 'WebhookEvent'
  ];
  nullable_tables text[] := ARRAY['Amenity', 'Role'];
BEGIN
  FOREACH t IN ARRAY strict_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I.%I', 'otatitan', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I.%I FOR ALL TO otatitan_app
         USING ("tenantId" = nullif(current_setting(''app.current_tenant_id'', true), '''')::uuid)
         WITH CHECK ("tenantId" = nullif(current_setting(''app.current_tenant_id'', true), '''')::uuid)',
      'otatitan', t
    );
  END LOOP;

  FOREACH t IN ARRAY nullable_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I.%I', 'otatitan', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I.%I FOR ALL TO otatitan_app
         USING ("tenantId" IS NULL OR "tenantId" = nullif(current_setting(''app.current_tenant_id'', true), '''')::uuid)
         WITH CHECK ("tenantId" = nullif(current_setting(''app.current_tenant_id'', true), '''')::uuid)',
      'otatitan', t
    );
  END LOOP;
END $$;
