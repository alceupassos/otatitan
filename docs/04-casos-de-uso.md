# 04 — Casos de Uso (fluxo vertical)

Formato: ator, pré-condições, fluxo principal, alternativos/exceções,
pós-condições, permissão exigida.

## UC-010 — Cadastrar propriedade
- **Ator**: Company Admin, Gestor de Reservas.
- **Pré-condições**: usuário autenticado com tenant ativo.
- **Fluxo principal**: (1) usuário abre `/imoveis/novo`; (2) preenche
  dados básicos, endereço, comodidades, fotos, tarifas e regras em um
  assistente de 6 passos; (3) sistema salva rascunho a cada passo; (4) ao
  concluir, propriedade fica `ACTIVE`.
- **Alternativo**: usuário sai no meio → rascunho persiste, pode retomar.
- **Pós-condições**: `Property` criada, `AuditLog property.created`.
- **Permissão**: `properties.create`.

## UC-011 — Cadastrar unidade
Análogo a UC-010, dentro de uma propriedade. **Permissão**: `units.create`.

## UC-020 — Criar plano de tarifa
- **Fluxo**: usuário define plano (nome, moeda, política de cancelamento,
  estadia mín/máx); primeiro plano de uma unidade é automaticamente padrão
  e ativo. **Permissão**: `rates.create`.

## UC-021 — Definir tarifas diárias
- **Fluxo**: usuário seleciona intervalo de datas + preço (+ opções:
  fechado, fechado para chegada/partida, estadia mínima); sistema expande
  e faz upsert em lote (máx. 730 dias por chamada). **Permissão**:
  `rates.edit`.

## UC-030 — Consultar disponibilidade
- **Ator**: hóspede (site público) ou atendente (em nome do hóspede).
- **Fluxo**: informa datas + número de hóspedes; sistema cruza
  `AvailabilityBlock` (reservas + bloqueios) com cobertura de tarifa e
  regras de estadia; retorna unidades disponíveis com cotação. **Exceção**:
  noite sem tarifa cadastrada → unidade marcada indisponível com motivo.
  **Permissão**: `availability.view`.

## UC-040 — Criar reserva
- **Pré-condições**: unidade disponível para as datas solicitadas.
- **Fluxo principal**: (1) sistema trava a unidade via advisory lock; (2)
  recalcula cotação no servidor; (3) confere conflito; (4) cria
  `Reservation PENDING` + `ReservationGuest` + `AvailabilityBlock`; (5) se
  a inserção do bloqueio violar a constraint de exclusão, toda a
  transação é desfeita.
- **Alternativo**: preço mudou desde a última cotação → `409
  PRICE_CHANGED` com nova cotação, usuário confirma de novo.
- **Exceção**: unidade já ocupada nas datas → `409 UNIT_UNAVAILABLE`.
- **Pós-condições**: reserva com `holdExpiresAt` = agora + 30 min;
  `AuditLog reservation.created`.
- **Permissão**: `reservations.create`.

## UC-041 — Bloquear calendário manualmente
- **Fluxo**: usuário seleciona unidade + intervalo + motivo (manutenção,
  uso do proprietário, outro); mesmo caminho transacional do UC-040.
  **Exceção**: remover um bloqueio cuja origem é uma reserva é recusado —
  precisa cancelar a reserva. **Permissão**: `availability.create`.

## UC-050 — Registrar pagamento (Stripe, teste)
- **Fluxo principal**: (1) usuário clica "Cobrar" na reserva; (2) sistema
  cria `Payment PENDING` e uma Stripe Checkout Session; (3) hóspede paga
  no Stripe (modo teste); (4) webhook `checkout.session.completed` chega,
  assinatura verificada, evento gravado em `WebhookEvent` (idempotente);
  (5) `Payment.SUCCEEDED`, se cobrir o total → `Reservation.CONFIRMED`.
- **Exceção**: webhook duplicado (retry) → identificado por
  `(provider, eventId)` único, ignorado silenciosamente com 200.
- **Permissão**: `payments.create`.

## UC-060 — Gerar tarefa de check-in
- **Fluxo**: disparado pela confirmação da reserva (UC-050); sistema cria
  `Task CHECK_IN` (e `CHECK_OUT`/`CLEANING`) com `dueAt` no horário de
  check-in da propriedade, no fuso local; idempotente via `dedupeKey`.
- **Permissão**: gerado pelo sistema (`createdBySystem: true`), visível
  para quem tem `tasks.view`.
