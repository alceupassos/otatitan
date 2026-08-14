#!/usr/bin/env bash
# Deploy do Otatitan no servidor. Roda NO SERVIDOR, a partir de /opt/otatitan.
#
#   ssh root@<host> 'cd /opt/otatitan && ./scripts/deploy.sh'
#
# Pré-requisitos (feitos uma vez, ver docs/13-deploy-producao.md):
#   - /opt/otatitan/.env.production preenchido, modo 600;
#   - nginx com o site de otatitan.giannasiadvogados.com.br habilitado.
#
# O compose já ordena as etapas: `migrate` roda como otatitan_owner e o
# `app` só sobe depois que ele termina com sucesso.
set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.production"
HEALTH_URL="http://127.0.0.1:3040/api/health"

if [ ! -f .env.production ]; then
  echo "ERRO: .env.production não existe. Copie .env.production.example e preencha." >&2
  exit 1
fi

# Um .env.production legível por todos anula o motivo de ele existir.
PERMS="$(stat -c '%a' .env.production)"
if [ "$PERMS" != "600" ]; then
  echo "AVISO: .env.production está com modo $PERMS; corrigindo para 600."
  chmod 600 .env.production
fi

echo "→ Construindo imagens..."
$COMPOSE build

echo "→ Aplicando migrations e seed do catálogo..."
$COMPOSE run --rm migrate

echo "→ Subindo a aplicação e o worker..."
# O `worker` entra aqui junto: sem ele, hold vencido nunca devolve a data ao
# calendário (RN-004) e reserva confirmada não gera tarefa (RN-008). São
# falhas silenciosas — a aplicação responde normalmente e nada indica que a
# fila não está sendo consumida.
$COMPOSE up -d db redis app worker

echo "→ Aguardando health check..."
# 60 tentativas × 2s = 2 min. O start_period do container já cobre o boot;
# esta espera é para o deploy só se declarar concluído quando de fato está.
for i in $(seq 1 60); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    echo "✅ Aplicação saudável em $HEALTH_URL"
    $COMPOSE ps

    # O provedor de pagamento é conferido DEPOIS de subir, e o resultado é
    # informativo: um erro de chave não deve derrubar um deploy que já está
    # de pé e atendendo. Mas precisa aparecer, senão só se descobre na
    # primeira cobrança de um cliente.
    echo "→ Conferindo a configuração de pagamento..."
    $COMPOSE run --rm --no-deps migrate npx tsx scripts/check-payments.ts || \
      echo "⚠  Configuração de pagamento com problema — ver acima." >&2

    exit 0
  fi
  sleep 2
done

echo "❌ A aplicação não respondeu ao health check em 2 minutos." >&2
echo "--- últimas linhas do log ---" >&2
$COMPOSE logs --tail 60 app >&2
exit 1
