# 13 — Notas de Deploy em Produção (para quando chegar a hora)

Este documento só é relevante na fase de deploy — não faz parte da
fundação nem do fluxo vertical deste ciclo.

## Destino
- **Domínio**: `otatitan.giannasiadvogados.com.br` (já apontado pelo
  usuário para o servidor de destino).
- **Servidor**: acesso via SSH — credenciais em `.env` (`SSH`, `PWD_SSH`),
  arquivo já no `.gitignore`. **Nunca** copiar essas credenciais para
  código, documentação versionada ou logs.

## Pendências antes de ir ao ar
- [ ] Emitir certificado TLS para `otatitan.giannasiadvogados.com.br`
      (recomendado: Let's Encrypt via Caddy, que renova automaticamente —
      mesmo padrão citado em `09-arquitetura.md` para o VPS do workspace).
- [ ] Configurar proxy reverso (Caddy/Nginx) apontando para o container
      `app` (porta 3040) com terminação TLS + HSTS.
- [ ] Rotacionar `AUTH_SECRET`, `ENCRYPTION_KEY` e chaves Stripe de teste →
      produção para fora do `.env`, no cofre de segredos do host.
- [ ] `prisma migrate deploy` rodando como `otatitan_owner` no banco de
      produção.
- [ ] Confirmar `AUTH_URL`/`APP_URL` apontando para
      `https://otatitan.giannasiadvogados.com.br`.

Isso complementa a nota única de produção em `09-arquitetura.md`
("Produção — nota única, sem over-engineering").
