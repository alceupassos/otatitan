# 00 — Visão de Produto

## O que é o Otatitan

Otatitan é uma plataforma SaaS multiempresa (multi-tenant) para gestão
profissional de imóveis de aluguel por temporada. Cada empresa cliente
(uma administradora de imóveis, uma pousada, um proprietário com várias
unidades) é um **tenant** isolado, com seus próprios usuários, imóveis,
reservas e finanças.

**Produto original.** Otatitan é comparável em abrangência funcional a
Stays.net, Guesty, Hostaway e Lodgify, mas não copia marca, código, textos,
imagens ou layout pixel-a-pixel de nenhuma dessas plataformas. Elas servem
apenas como referência de categoria e cobertura de funcionalidades.

## Segmento-alvo

Administradoras de temporada de pequeno a médio porte (5 a 200 unidades),
com foco inicial em litoral brasileiro (região de Angra dos Reis e
similares). Perfil de uso: equipe operacional pequena, uso intenso de
celular pela equipe de campo (limpeza, manutenção), proprietários que
querem transparência sobre seus imóveis, hóspedes que querem uma
experiência de reserva direta comparável a uma OTA.

## Diferenciais pretendidos

- Calendário central rápido o suficiente para gerenciar dezenas/centenas
  de unidades sem travar.
- Garantia de zero overbooking no nível do banco de dados, não só na
  aplicação — mesmo sob concorrência ou bugs futuros.
- Adapters desacoplados para pagamento, canais de distribuição e
  mensageria — nenhum fornecedor externo é uma dependência arquitetural
  rígida.
- RBAC granular com papéis customizáveis por empresa, não só papéis fixos.
- Portais separados e com escopo de dados correto para equipe,
  proprietários e hóspedes.

## Glossário de domínio

- **Unidade**: a menor unidade reservável (um apartamento, uma casa, um
  quarto). Pertence a uma **propriedade** (o empreendimento/prédio/terreno).
- **Tarifa diária**: preço de uma unidade para uma data específica,
  definido dentro de um **plano de tarifa**.
- **Bloqueio**: período em que uma unidade não pode ser reservada — pode
  ser por reserva, manutenção, uso do proprietário ou bloqueio manual.
- **Hold**: reserva `PENDING` que retém a disponibilidade por um tempo
  limitado (30 min) enquanto aguarda pagamento.
- **Taxa de limpeza**: valor adicional cobrado por estadia, independente
  do número de noites.
- **Repasse**: valor líquido transferido ao proprietário após comissão da
  administradora, taxas e despesas.
- **Canal**: um canal de distribuição externo (Airbnb, Booking.com etc.) —
  neste ciclo, apenas simulado/mockado.
- **Tenant**: uma empresa cliente da plataforma, com isolamento completo de
  dados em relação a outros tenants.
