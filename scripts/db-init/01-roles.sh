#!/bin/sh
# Cria as 3 roles do Otatitan no bootstrap do container de Postgres.
#
# Substitui o antigo scripts/db-roles.sql: as senhas agora vêm do ambiente,
# porque em produção elas não podem estar num arquivo versionado. Os
# defaults reproduzem exatamente os valores de desenvolvimento, para que um
# volume novo em dev continue funcionando sem configurar nada.
#
# Roda uma única vez, quando o diretório de dados está vazio
# (/docker-entrypoint-initdb.d). Alterar este arquivo NÃO afeta um banco já
# inicializado — nesse caso, rode o SQL manualmente.
set -eu

OWNER_PASSWORD="${OTATITAN_OWNER_PASSWORD:-otatitan_owner_dev}"
APP_PASSWORD="${OTATITAN_APP_PASSWORD:-otatitan_app_dev}"
PLATFORM_PASSWORD="${OTATITAN_PLATFORM_PASSWORD:-otatitan_platform_dev}"

# --set + :'var' faz o psql fazer o quoting do literal — nunca interpolar
# senha direto no texto do SQL.
psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set owner_password="$OWNER_PASSWORD" \
  --set app_password="$APP_PASSWORD" \
  --set platform_password="$PLATFORM_PASSWORD" <<'EOSQL'
-- otatitan_owner:    dono do schema, roda migrations (DDL), bypassa RLS.
-- otatitan_app:      role de runtime da aplicação. Sem BYPASSRLS, não é dona das tabelas.
-- otatitan_platform: usada só pelo cliente de plataforma/superadmin, sempre auditada.
--
-- CREATEDB é necessário só em dev, para o "shadow database" que o Prisma
-- Migrate usa para detectar drift (ver https://pris.ly/d/migrate-shadow).
-- BYPASSRLS é necessário porque as tabelas usam FORCE ROW LEVEL SECURITY
-- (que normalmente restringiria até o dono da tabela) e o seed precisa
-- gravar dados de catálogo/tenant sem contexto de tenant definido.
-- Nunca conceder nenhum dos dois à otatitan_app (role de runtime).
CREATE ROLE otatitan_owner LOGIN PASSWORD :'owner_password' CREATEDB BYPASSRLS;
CREATE ROLE otatitan_app LOGIN PASSWORD :'app_password' NOBYPASSRLS;
CREATE ROLE otatitan_platform LOGIN PASSWORD :'platform_password' NOBYPASSRLS;

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
EOSQL
