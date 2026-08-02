# 11 — Segurança e LGPD

Mapa ameaça → controle. Ver não-negociáveis também em `CLAUDE.md`.

| Ameaça | Controle |
|---|---|
| Vazamento entre empresas (tenants) | `tenantId` em toda tabela + RLS fail-closed + Prisma Client Extension (3 camadas, ver ADR-002) |
| Senha vazada/fraca | `bcryptjs` custo 12, política mínima de 12 caracteres, bloqueio após 5 falhas (15 min) |
| Sequestro de sessão | JWT httpOnly, `SameSite=Lax`, `secure` em produção, `__Host-` prefix em produção, expiração 8h |
| Acesso indevido sem 2º fator | MFA TOTP opcional (`otpauth`), segredo cifrado AES-256-GCM, 10 códigos de recuperação hasheados |
| Força bruta em login/reset | Rate limiting via Redis (sliding window) por IP e por e-mail |
| CSRF | `SameSite=Lax` + checagem de `Origin` em mutações |
| XSS | Sem `dangerouslySetInnerHTML`; Content-Security-Policy |
| SSRF | Allowlist de destinos para qualquer fetch de saída (ex.: scan de upload, webhooks futuros) |
| SQL injection | Só parâmetros via Prisma; uso de `$queryRaw`/`$executeRawUnsafe` restrito a `lib/db/**` e revisado |
| Privilégio excessivo no banco | 3 roles de Postgres (`otatitan_owner`/`_app`/`_platform`), a role de app nunca é dona das tabelas nem tem `BYPASSRLS` |
| Adulteração de auditoria | `AuditLog` append-only — `REVOKE UPDATE, DELETE` da role de aplicação |
| Dado de cartão armazenado | Nunca — pagamentos tokenizados via Stripe Checkout (ADR-004) |
| Replay de webhook | Assinatura verificada (`stripe.webhooks.constructEvent`) + `WebhookEvent` com `(provider, eventId)` único |
| Vazamento de mídia privada | URLs pré-assinadas com TTL ≤ 5 min, nunca acesso público direto ao bucket |
| Upload malicioso | `scanStatus: PENDING` até verificação; presign de leitura bloqueado enquanto não `CLEAN` |
| PII em logs | `pino` com `redact` nos caminhos de e-mail, telefone, documento, segredo |
| Falta de base legal (LGPD) | `Consent` por finalidade (termos, privacidade, marketing), com versão do documento e timestamp |
| Direito do titular (LGPD) | Rota de exportação/exclusão de dados por sujeito (hóspede/usuário) — v2, modelo já reserva `Consent`/`AuditLog` para essa trilha |
| Documento de identidade de hóspede exposto | `documentNumberEnc` cifrado; só `documentLast4` em claro para busca/exibição |

## Papéis de banco (recapitulando)
- `otatitan_owner`: dono do schema, roda migrations, não usado pela app em
  runtime.
- `otatitan_app`: role de runtime, sem `BYPASSRLS`, sujeita a RLS em toda
  tabela tenant-scoped.
- `otatitan_platform`: usada só pelo cliente de plataforma/superadmin,
  toda query é auditada.
