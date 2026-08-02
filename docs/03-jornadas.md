# 03 — Jornadas

## Jornada 1 — Fluxo vertical (escopo deste ciclo)

Admin/Gestor de reservas cadastra propriedade → configura tarifa → hóspede
(ou atendente, em nome do hóspede) consulta disponibilidade → cria reserva
→ sistema bloqueia o calendário automaticamente → hóspede paga (Stripe,
modo teste) → sistema gera tarefa de check-in para a operação.

Telas: `/imoveis/novo` (assistente) → `/tarifas/[unitId]` → busca pública
ou `/reservas/nova` → `/reservas/[id]` (status `PENDING` → `CONFIRMED`) →
`/tarefas` (tarefa aparece).

## Jornada 2 — Hóspede consulta e reserva (site público)

Hóspede busca datas/hóspedes → vê resultados com preço transparente → abre
página do imóvel → seleciona datas no calendário de disponibilidade → vê
resumo de preço → preenche dados → paga → recebe confirmação com código.

## Jornada 3 — Proprietário consulta extrato

Proprietário loga no portal → vê dashboard dos imóveis autorizados
(ocupação, receita) → abre extrato do mês → vê repasse líquido e
descontos → baixa PDF. *(v2 — fora do escopo de implementação deste
ciclo, mas o modelo de dados reserva espaço.)*

## Jornada 4 — Camareira executa checklist

Camareira abre app no celular → vê tarefas do dia (limpeza) → abre
checklist da unidade → marca itens, tira foto de evidência → conclui
tarefa → status da unidade libera para check-in. *(v2.)*

## Jornada 5 — Financeiro concilia pagamento

Financeiro abre lista de pagamentos pendentes → confere webhook recebido
do Stripe → concilia com a reserva → em caso de divergência, investiga →
fecha o período. *(Neste ciclo, a conciliação básica via webhook já
funciona; relatórios avançados de conciliação ficam para v2.)*

## Jornada 6 — Admin convida usuário e define papel

Admin abre `/configuracoes/usuarios` → convida por e-mail → define papel
(sistema ou customizado) → usuário aceita convite → define senha → acessa
com as permissões do papel atribuído.
