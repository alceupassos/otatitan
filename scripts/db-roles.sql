-- Roles de banco do Otatitan — privilégio mínimo por design.
-- otatitan_owner:    dono do schema, roda migrations (DDL), bypassa RLS por ownership.
-- otatitan_app:      role de runtime da aplicação. Sem BYPASSRLS, não é dono das tabelas.
-- otatitan_platform: usada só pelo cliente de plataforma/superadmin, sempre auditada.

-- CREATEDB é necessário só em dev, para o "shadow database" que o Prisma
-- Migrate usa para detectar drift (ver https://pris.ly/d/migrate-shadow).
-- BYPASSRLS é necessário porque as tabelas usam FORCE ROW LEVEL SECURITY
-- (que normalmente restringiria até o dono da tabela) e o seed precisa
-- gravar dados de catálogo/tenant sem contexto de tenant definido.
-- Nunca conceder nenhum dos dois à otatitan_app (role de runtime).
CREATE ROLE otatitan_owner LOGIN PASSWORD 'otatitan_owner_dev' CREATEDB BYPASSRLS;
CREATE ROLE otatitan_app LOGIN PASSWORD 'otatitan_app_dev' NOBYPASSRLS;
CREATE ROLE otatitan_platform LOGIN PASSWORD 'otatitan_platform_dev' NOBYPASSRLS;

CREATE SCHEMA IF NOT EXISTS otatitan AUTHORIZATION otatitan_owner;

ALTER ROLE otatitan_owner SET search_path = otatitan, public;
ALTER ROLE otatitan_app SET search_path = otatitan, public;
ALTER ROLE otatitan_platform SET search_path = otatitan, public;

GRANT USAGE ON SCHEMA otatitan TO otatitan_app, otatitan_platform;
GRANT CONNECT ON DATABASE otatitan TO otatitan_app, otatitan_platform;

-- Privilégios em tabelas futuras criadas pelo owner (migrations rodam como otatitan_owner).
ALTER DEFAULT PRIVILEGES FOR ROLE otatitan_owner IN SCHEMA otatitan
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO otatitan_app;
ALTER DEFAULT PRIVILEGES FOR ROLE otatitan_owner IN SCHEMA otatitan
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO otatitan_platform;
ALTER DEFAULT PRIVILEGES FOR ROLE otatitan_owner IN SCHEMA otatitan
  GRANT USAGE, SELECT ON SEQUENCES TO otatitan_app, otatitan_platform;
