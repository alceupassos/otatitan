# 05 — Regras de Negócio

Regras numeradas e testáveis. Toda regra aqui deve ter um teste
correspondente (unitário ou de integração) — ver `12-plano-testes.md`.

- **RN-001** — Noites de estadia são um intervalo semiaberto
  `[check_in, check_out)`. Same-day turnover (uma reserva termina no mesmo
  dia em que outra começa na mesma unidade) é permitido e não é conflito.
- **RN-002** — Nenhuma unidade pode ter duas ocupações bloqueantes
  (`is_blocking = true`) com datas sobrepostas. Garantido por constraint de
  exclusão no Postgres (`availability_block_no_overlap`), não apenas por
  checagem de aplicação.
- **RN-003** — O preço final de uma reserva é sempre recalculado no
  servidor a partir das tarifas vigentes. O total exibido ao cliente nunca
  é aceito como verdade — se divergir do recálculo, a API retorna
  `409 PRICE_CHANGED` com a cotação atualizada.
- **RN-004** — Uma reserva em status `PENDING` retém a disponibilidade
  (via `AvailabilityBlock`) até `holdExpiresAt` (30 minutos após a
  criação). Depois disso, um job libera a unidade automaticamente se não
  houver pagamento confirmado.
- **RN-005** — Cancelar uma reserva libera a disponibilidade
  (`releasedAt` no bloqueio) mas preserva o histórico da reserva — nunca é
  excluída (soft state via `status: CANCELLED`).
- **RN-006** — Todo valor monetário é armazenado como inteiro em centavos
  (`Int`) mais um código de moeda ISO 4217 (`currency`). Nunca `Float`.
- **RN-007** — Datas de estadia (`check_in`, `check_out`, datas de
  `DailyRate`, de `AvailabilityBlock`) são `DATE`, no fuso horário da
  propriedade — nunca `timestamptz`. Evita bugs de troca de dia por fuso.
- **RN-008** — A tarefa de check-in (e as tarefas-irmãs de check-out e
  limpeza) é criada uma única vez por reserva confirmada, de forma
  idempotente (`dedupeKey` único), mesmo sob retries de webhook.
- **RN-009** — Nenhum dado de cartão (PAN, CVV, validade) trafega pelo
  nosso servidor ou é armazenado em nosso banco. Pagamentos são tokenizados
  via provedor (Stripe Checkout).
- **RN-010** — Toda ação crítica (criar/editar/cancelar reserva, alterar
  tarifa, pagamento, mudança de papel/permissão) gera uma linha em
  `AuditLog`, append-only.
- **RN-011** — Uma noite sem `DailyRate` cadastrada torna a unidade
  indisponível para aquela data — nunca é tratada como "grátis" ou
  disponível por omissão.
- **RN-012** — `minNights`/`maxNights` efetivos são o mais restritivo entre
  o valor da unidade, do plano de tarifa e da tarifa diária específica.
- **RN-013** — Um usuário só pertence a um tenant através de um registro de
  `Membership` com status `ACTIVE`. Um usuário pode ter memberships em
  vários tenants (ex.: equipe de agência, proprietário com contas em mais
  de uma administradora).
- **RN-014** — O último `company_admin` ativo de um tenant não pode ser
  removido nem rebaixado — sempre deve existir ao menos um admin.
