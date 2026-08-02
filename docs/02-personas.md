# 02 — Personas

Cada persona corresponde 1:1 a um papel do sistema (ver
`07-matriz-permissoes.md`).

| Papel | Objetivo | Dores | Uso | Dispositivo | Não pode ver |
|---|---|---|---|---|---|
| **Superadmin (plataforma)** | Operar o SaaS em si: planos, assinaturas, saúde dos tenants | Precisa agir rápido em incidentes sem violar a privacidade dos clientes | Esporádico, orientado a alerta | Desktop | Nada é bloqueado, mas toda ação é auditada e a impersonação exige justificativa |
| **Admin da empresa** | Configurar a empresa, gerenciar usuários e papéis, ver visão geral do negócio | Onboarding lento, medo de dar permissão demais para a equipe | Diário | Desktop | Dados de outros tenants |
| **Gestor de reservas** | Criar/editar reservas, resolver conflitos de calendário | Overbooking, hóspede com informação desencontrada | Diário, intenso | Desktop | Dados financeiros sensíveis (repasse, custos) |
| **Atendente comercial** | Responder leads, criar orçamentos, fechar reservas diretas | Perder a venda por demora na cotação | Diário | Desktop/tablet | Configurações da empresa, financeiro |
| **Financeiro** | Conciliar pagamentos, fechar repasses, gerar relatórios | Erro de cálculo em repasse, atraso na conciliação | Diário/semanal | Desktop | Dados operacionais de limpeza/manutenção não relevantes |
| **Coordenador operacional** | Distribuir tarefas de limpeza/manutenção/check-in | Tarefa esquecida, unidade não pronta para check-in | Diário, intenso | Desktop/tablet | Financeiro sensível |
| **Profissional de limpeza** | Ver e concluir suas tarefas do dia | App lento, sem sinal no local | Diário, campo | Celular, uso offline-parcial | Tudo exceto suas tarefas |
| **Profissional de manutenção** | Ver chamados, registrar execução e custo | Falta de contexto sobre o problema | Esporádico, campo | Celular | Tudo exceto seus chamados |
| **Proprietário do imóvel** | Acompanhar ocupação, receita, extrato de repasse | Falta de transparência, extrato tarde | Semanal/mensal | Desktop/celular | Dados pessoais de hóspedes além do necessário, dados de outros proprietários |
| **Hóspede** | Reservar, pagar, fazer check-in online, tirar dúvidas | Processo de reserva confuso, instrução de chegada perdida | Por estadia | Celular, web | Dados internos da administradora, de outros hóspedes |
