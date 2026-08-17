# 13 — Deploy em Produção

## Destino

- **Domínio**: `otatitan.giannasiadvogados.com.br` (DNS já apontado, via
  Cloudflare).
- **Servidor**: `vmi3463690`, Ubuntu (kernel 6.8), Docker 29 + Compose v5.
  Acesso SSH com credenciais no `.env` (`SSH`, `PWD_SSH`), que está no
  `.gitignore`. **Nunca** copiar essas credenciais para código,
  documentação versionada ou logs.
- **Diretório**: `/opt/otatitan`.

## O que já existia no servidor (e condicionou o desenho)

- **nginx no host ocupa 80/443** — por isso não há Caddy aqui. O Otatitan
  entra como mais um site do nginx existente, no mesmo padrão dos outros
  (`titan.`, `malupop.`, `pitfall.`).
- **TLS já resolvido**: certificado **Cloudflare Origin curinga** para
  `*.giannasiadvogados.com.br` em `/etc/ssl/cloudflare/`, válido até 2041.
  Cobre `otatitan.` sem emitir nada novo — não há Let's Encrypt nem
  certbot no servidor, e não precisa haver.
- **Stack vizinho `titan-stay`** roda Postgres 17, Redis e PgBouncer, tudo
  publicado apenas em `127.0.0.1`. O Otatitan **não** compartilha esse
  banco: o schema usa `uuidv7()`, que só existe no **Postgres 18**.

## Arquitetura do deploy

```
Internet → Cloudflare → nginx (host, 443, cert Origin)
                          └─ proxy_pass → 127.0.0.1:3040
                                            └─ container `app` (Next standalone)
                                                 ├─ container `db`    (Postgres 18, sem porta no host)
                                                 └─ container `redis` (sem porta no host)
```

Só a aplicação publica porta, e mesmo assim apenas em loopback. Banco e
Redis não são alcançáveis de fora do compose.

## Primeira instalação

1. **Enviar o código** (não há remote git configurado; o envio é por
   `tar` + `scp`, ver `scripts/push-to-server.ps1`).

2. **Criar o `.env.production`** em `/opt/otatitan`, a partir de
   `.env.production.example`, com segredos **novos** — nunca os valores de
   desenvolvimento:

   ```sh
   openssl rand -base64 32   # AUTH_SECRET, ENCRYPTION_KEY, senhas do banco
   chmod 600 .env.production
   ```

3. **Habilitar o site no nginx**:

   ```sh
   cp infra/nginx/otatitan.giannasiadvogados.com.br.conf \
      /etc/nginx/sites-available/otatitan.giannasiadvogados.com.br
   ln -sf /etc/nginx/sites-available/otatitan.giannasiadvogados.com.br \
          /etc/nginx/sites-enabled/
   nginx -t && systemctl reload nginx
   ```

4. **Subir**: `./scripts/deploy.sh`.

## Atualizações

`./scripts/deploy.sh` é idempotente: reconstrói as imagens, aplica
migrations pendentes (como `otatitan_owner`), re-roda o seed do catálogo
(que é idempotente) e reinicia a aplicação, esperando o health check antes
de se declarar concluído.

## Detalhes que importam

- **O seed de produção não cria dados de demonstração.** Os tenants
  "Costa Verde" e "Ilha Azul" só nascem com `SEED_DEMO=true`, que o
  compose de produção nunca define. O que roda lá é o catálogo global
  (permissões, papéis-template, comodidades), que é pré-requisito do RBAC.
- **Migrations nunca rodam pela role de runtime.** O serviço `migrate` usa
  `otatitan_owner` e sai; o `app` depende de `service_completed_successfully`.
- **`TRUSTED_PROXY=true`** só é correto porque o nginx do host reescreve
  `X-Forwarded-For`. Sem um proxy confiável na frente, o rate limit por IP
  passaria a aceitar um header forjado pelo cliente.
- **HSTS fica no nginx**, onde o TLS termina. Os demais cabeçalhos de
  segurança (`X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy`) vêm da aplicação, em
  `next.config.ts`. O canal direto precisa de `camera=(self)` para a foto
  do responsável; o painel não usa câmera, mas a política é a mesma no
  app (só este origin).

## Canal direto Madre 914

O site público `www.madre914.com.br` passa a ser o **mesmo app** na porta
3040, distinguido pelo `Host`. O painel continua em
`otatitan.giannasiadvogados.com.br`.

1. Preencher `DIRECT_BOOKING_TENANT_SLUG` (slug da empresa no banco) e
   importar os 4 studios: `scripts/data/madre914.json`.
2. Habilitar o vhost (preencha `ssl_certificate*` com o par **já
   instalado** da zona madre914 — o curinga de giannasiadvogados.com.br
   não cobre este nome; não inventamos IP):

   ```sh
   cp infra/nginx/madre914.com.br.conf \
      /etc/nginx/sites-available/madre914.com.br
   ln -sf /etc/nginx/sites-available/madre914.com.br \
          /etc/nginx/sites-enabled/
   nginx -t && systemctl reload nginx
   ```
3. No Cloudflare da zona madre914, o origin continua sendo este nginx.

O site ao vivo consultado em 2026-08-17 era **outro** app Next.js (`/api/health`
devolvia `db`+`latencyMs`; este repo devolve só `{status}`). Esta entrega
unifica o canal neste repositório.

## Armadilha: a chave do Asaas começa com `$`

`ASAAS_API_KEY` tem a forma `$aact_prod_...`. O `$` inicial é expandido
como variável por **dois** consumidores diferentes, e nos dois casos a
chave vira string vazia **sem nenhum erro**:

- `dotenv-cli` (desenvolvimento) roda `dotenv-expand` *depois* de remover
  as aspas — então aspas simples não protegem;
- `set -a; . .env.production` (scripts de deploy) expande no shell.

A única forma que sobrevive aos dois é **aspas duplas com barra
invertida**:

```sh
ASAAS_API_KEY="\$aact_prod_..."
```

`npm run check:payments` confere isso: se a chave não começar com `$`, ele
acusa expansão de shell em vez de deixar o erro aparecer só na primeira
cobrança. `npm run check:payments` também recusa chave de produção com
`ASAAS_SANDBOX=true` (e o inverso), que é o par capaz de movimentar
dinheiro real por engano.

## Pendências conhecidas

- [ ] **SMTP real.** Sem `SMTP_URL`, o reset de senha falha em silêncio —
      por design, para não revelar quais e-mails existem —, então o link
      simplesmente nunca chega. Enquanto isso, o acesso depende de senha
      definida no seed.
- [ ] **Chaves Stripe de produção.** `PAYMENTS_DEFAULT_PROVIDER=MANUAL`
      até existirem.
- [ ] **Backup do volume `pgdata`.** Não há rotina automática.
- [ ] **MinIO/S3.** O upload de mídia é v2; nenhum bucket foi provisionado.
