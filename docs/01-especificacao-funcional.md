# 01 — Especificação Funcional

Um módulo por seção. `[MVP]` = implementado neste ciclo (fundação + fluxo
vertical). Sem marca = reservado para v2/v3 (ver `08-backlog.md`).

## Onboarding e Configurações `[MVP parcial]`
Cadastro de empresa (nome, CNPJ, endereço), idioma/moeda/fuso (padrão
pt-BR/BRL/America/Sao_Paulo), convite de usuários, papéis. *(Assistente de
onboarding completo e importação inicial ficam para v2.)*

## Propriedades e Unidades `[MVP]`
Cadastro de propriedade (endereço, geolocalização, check-in/check-out,
regras da casa) e unidades (tipologia, capacidade, quartos/camas/banheiros,
comodidades, mídia com upload e capa). Entidades: `Property`, `Unit`,
`Amenity`, `UnitAmenity`, `Media`.

## Calendário Central `[MVP]`
Visualização por unidade × dias, bloqueios manuais e por reserva,
detecção de conflito garantida no banco (constraint de exclusão),
indicadores de check-in/check-out. Entidade: `AvailabilityBlock` (livro-
razão único de ocupação).

## Reservas `[MVP parcial]`
Criação manual/direta, hold com expiração, confirmação, cancelamento,
dados de hóspede, cálculo de valores, notas internas. *(Orçamentos com
expiração formal, caução, parcelamento, cupom, assinatura eletrônica de
contrato ficam para v2.)*

## Channel Manager — não implementado neste ciclo
Sem credenciais oficiais de Airbnb/Booking/Vrbo/etc. O modelo de dados
reserva `Channel`, `ChannelListing`, `SyncJob` para v3; nenhuma integração
real ou simulada é construída agora além de deixar os nomes reservados.

## Tarifas e Precificação `[MVP parcial]`
Tarifa por unidade, tarifas diárias, estadia mínima/máxima, fechamento
para chegada/partida. Entidades: `RatePlan`, `DailyRate`. *(Tarifas
sazonais avançadas, promoções, pacotes, sugestão de preço via IA ficam
para v2 — o campo `DailyRate.source: AI_SUGGESTION` já está reservado.)*

## Motor de Reservas e Site do Hóspede `[MVP parcial]`
Página pública do imóvel, busca de disponibilidade, cotação transparente,
checkout com pagamento Stripe teste, confirmação. *(Busca multi-imóvel
com mapa, avaliações reais, blog/SEO avançado ficam para v2.)*

## CRM e Comunicação — v2
Cadastro unificado de hóspedes já existe (`Guest`) mas caixa de entrada
unificada, automações de mensagem, WhatsApp/SMS oficiais ficam para v2/v3.

## Operação e Tarefas `[MVP parcial]`
Geração automática de tarefa de check-in (e check-out/limpeza) a partir da
confirmação da reserva. Entidade: `Task`. *(Checklist com fotos, app
offline, Kanban ficam para v2.)*

## Manutenção e Inventário — v2

## Financeiro `[MVP parcial]`
Registro de pagamento via Stripe, idempotência de webhook. *(Contas a
pagar/receber, fluxo de caixa, conciliação contábil completa ficam para
v2 — `Invoice`, `Expense` reservados.)*

## Repasse a Proprietários — v2 (`Owner`, `ManagementContract`, `Payout`,
`OwnerStatement` reservados no modelo de dados)

## Portal do Proprietário / Portal do Hóspede — v2
Rotas `(owner-portal)` e `(guest-portal)` existem como placeholder
protegido por papel, sem funcionalidade completa neste ciclo.

## Relatórios e Indicadores — v2 (dashboard interno usa dados reais do
MVP, mas relatórios exportáveis completos ficam para v2)

## Administração do SaaS — v2/v3 (`Subscription`, `FeatureFlag` reservados)
