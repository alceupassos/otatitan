# Otatitan — Descrição Executiva

**Plataforma SaaS multiempresa para gestão profissional de aluguel por temporada.**
Documento de leitura rápida, atualizado em 14/08/2026. Números e estados aqui
foram verificados no repositório, não estimados.

---

## O que é

Cada empresa cliente — uma administradora de imóveis, uma pousada, um
proprietário com várias unidades — é um **tenant** isolado, com seus próprios
usuários, imóveis, reservas e finanças. Um único sistema atende todas, sem que
nenhuma enxergue os dados da outra.

**Segmento-alvo:** administradoras de pequeno a médio porte (5 a 200 unidades),
com foco inicial no litoral brasileiro. Equipe operacional enxuta, uso intenso
de celular no campo (limpeza e manutenção), proprietários que querem
transparência e hóspedes que esperam uma experiência de reserva direta
comparável à de uma OTA.

Produto original. Comparável em abrangência a Stays.net, Guesty, Hostaway e
Lodgify, sem copiar marca, código ou layout de nenhuma delas.

---

## O problema que resolve

A operação de temporada costuma viver espalhada entre planilha, WhatsApp e o
painel de cada canal de venda. Três custos se repetem nesse arranjo:

1. **Overbooking** — a mesma unidade vendida duas vezes. Custa dinheiro,
   reacomodação e reputação.
2. **Preço errado** — diária desatualizada, mínimo de noites ignorado, taxa de
   limpeza esquecida. Cada erro sai do lucro.
3. **Falta de rastro** — ninguém sabe quem alterou o quê, e o acerto com o
   proprietário vira discussão.

O Otatitan trata os três como problemas de engenharia, não de disciplina da
equipe.

---

## Como se diferencia

O que segue são garantias estruturais — o sistema não depende de ninguém
lembrar de fazer a coisa certa.

| Garantia | Como é obtida |
|---|---|
| **Zero overbooking** | Constraint de exclusão GiST no PostgreSQL. A trava está no banco, não na aplicação: nem um bug futuro, nem o worker, nem uma integração de canal conseguem furá-la. |
| **Isolamento entre empresas** | Quatro camadas independentes: chaves estrangeiras compostas `(tenantId, id)`, Row Level Security *fail-closed*, `DEFAULT` de coluna que carimba o tenant da sessão e uma extensão do Prisma com `AsyncLocalStorage`. Um `WHERE` esquecido faz a consulta falhar, não vazar. |
| **Preço sempre recalculado no servidor** | O total que o cliente envia nunca é aceito. Se divergir do recálculo, a venda para e a cotação nova é reapresentada para reconfirmação explícita. |
| **Nenhum dado de cartão no nosso banco** | Checkout hospedado pelo provedor. Guardamos identificadores, bandeira e 4 últimos dígitos — nada mais (PCI DSS SAQ-A). |
| **Auditoria append-only** | Toda ação crítica grava `AuditLog`, inclusive as originadas por webhook e por job automático. |
| **Noite sem tarifa não é noite grátis** | Ausência de diária publicada torna a unidade indisponível para a data, com o motivo dito ao operador — nunca vendida por omissão. |

---

## Estado atual

### Pronto e verificado

| Módulo | O que entrega |
|---|---|
| **Modelo de dados** | 27 entidades, 8 migrations, isolamento multi-tenant nas 4 camadas |
| **Autenticação** | Credenciais + bcrypt(12), bloqueio por conta, rate limit por IP/e-mail, MFA TOTP com códigos de recuperação, reset por e-mail, troca de empresa |
| **Permissões (RBAC)** | 59 permissões, 9 papéis, cache invalidado por versão do tenant |
| **Imóveis e unidades** | CRUD completo com busca, filtros, comodidades, arquivamento e auditoria |
| **Calendário de ocupação** | Grade unidade × dia, bloqueio manual (manutenção, uso do proprietário) e liberação |
| **Tarifas** | Planos com política de cancelamento e regras de estadia, publicação de diárias em lote, fechamento para venda/chegada/saída, relatório de cobertura que aponta a primeira lacuna |
| **Motor de cotação** | Cálculo puro e determinista; recusa tipada com o motivo e a data que a causou |
| **Fluxo de reserva** | Criar (com hold de 30 min), confirmar, cancelar, check-in/check-out, pagamento manual — com máquina de estados explícita |
| **Pagamentos** | Adapter com Asaas (padrão), Stripe e manual; webhooks verificados e idempotentes |
| **Processos em segundo plano** | Expiração automática de holds vencidos; tarefas de check-in, check-out e limpeza criadas uma única vez por reserva |
| **Telas de reserva** | Lista com filtros e contagem regressiva do hold; detalhe com a cotação congelada da venda; fluxo de nova reserva em quatro etapas |
| **Cobrança por link** | Botão na tela da reserva; abre o checkout hospedado pelo saldo devedor apurado no servidor, reaproveita link vivo em vez de abrir um segundo, e o link morre junto com o hold |
| **Retorno do pagamento** | Página pública para onde o pagador volta — não exige login, não consulta dados e não afirma confirmação que ainda depende do webhook |

**Verificação:** 277 testes unitários e 77 de integração passando, `tsc --noEmit`,
`eslint` e `next build` limpos, guarda de isolamento cobrindo 19 tabelas.

### Auditoria adversarial

O ciclo passou por uma revisão em quatro frentes — dinheiro, concorrência,
isolamento e falha silenciosa — com os cenários reproduzidos contra o banco.
Treze defeitos foram confirmados e corrigidos, entre eles:

- **Pagamento recebido depois de a cobrança expirar era descartado em
  silêncio.** Um PIX pago com o QR vencido chegava após o `CHECKOUT_EXPIRED`; o
  sistema registrava a reserva como não paga, o hold expirava e a data era
  revendida — com o dinheiro na conta. Hoje a baixa é aceita e sinalizada para
  conferência.
- **O link do checkout sobrevivia ao hold**, podendo cobrar por uma data já
  devolvida ao calendário. A validade passou a ser derivada do hold restante, e
  com pouco prazo a abertura é recusada em vez de gerar um link desonesto.
- **Duplo clique abria dois checkouts** para a mesma reserva. Resolvido com
  trava por reserva no banco, já que o Asaas não oferece idempotência na criação.
- **Papel rebaixado mantinha o escopo antigo** até a sessão expirar, porque a
  autorização lia o papel do token. Agora é reconferido no servidor.
- **A detecção de chave duplicada nunca funcionava** no Prisma 7 com driver
  adapter, deixando erro cru vazar para a tela.
- **Caução quitava a estadia**: um depósito de segurança entrava no valor pago e
  confirmava a reserva sem ninguém ter pago a diária.

### Pendente

| Item | Situação |
|---|---|
| Fotos de imóvel | Modelo pronto, sem interface — depende de S3/MinIO provisionado |
| Assistente de cadastro em 6 passos | Hoje é formulário único que salva como rascunho |
| Reembolso parcial acumulado | Falta uma coluna `refundedCents`; hoje o segundo estorno é sinalizado para conferência manual em vez de descontado |
| Validação com dinheiro real | Nenhum pagamento de verdade passou pelo fluxo ainda |
| Portais de proprietário e hóspede | Previstos para o próximo ciclo |

---

## Pagamentos — configuração atual

**Provedor ativo: Asaas, em PRODUÇÃO.** Cobranças movimentam dinheiro real.

- **Formas aceitas:** PIX e cartão de crédito, com o hóspede escolhendo na tela
  do Asaas.
- **Boleto fica de fora, por decisão de produto:** compensa em 1 a 3 dias úteis
  e não caberia no hold de 30 minutos — a reserva expiraria antes de o dinheiro
  entrar. Há um teste automatizado travando essa lista, para que ninguém reabra
  boleto sem perceber a consequência.
- **A cobrança expira junto com o hold.** Um link que sobrevivesse ao hold
  cobraria por uma reserva já liberada para outro hóspede.
- **Webhook verificado por token compartilhado.** O Asaas não assina o corpo
  como o Stripe; a verificação é por segredo no cabeçalho, comparado em tempo
  constante.
- **Entrega dupla é a regra, não a exceção:** o Asaas envia `PAYMENT_CONFIRMED`
  e `PAYMENT_RECEIVED` para toda cobrança. A baixa usa atualização condicional,
  então o valor nunca é somado duas vezes.
- **Stripe permanece no código**, inativo, para os webhooks de cobranças
  anteriores.

O endpoint `https://otatitan.giannasiadvogados.com.br/api/webhooks/asaas` já está
cadastrado no painel do Asaas. **Antes de confiar no fluxo com dinheiro real**,
falta uma cobrança de valor baixo ponta a ponta em produção: abrir o link, pagar
e conferir que a reserva confirma sozinha pelo webhook.

---

## Números

| | |
|---|---|
| Entidades no banco | 27 |
| Migrations | 8 |
| Permissões / papéis | 59 / 9 |
| Telas | 17 |
| Endpoints de API | 4 |
| Arquivos TypeScript (sem código gerado) | 180 |
| Testes unitários | 277, todos passando |
| Testes de integração | 76, todos passando |

---

## Stack e operação

**Next.js 16** (App Router) · **React 19** · **TypeScript** · **Tailwind CSS v4**
· **shadcn/ui** · **Prisma 7** · **PostgreSQL 18** · **next-auth v5** ·
**Redis + BullMQ** · **S3/MinIO** · **Zod** · **Vitest + Playwright**

Porta de desenvolvimento: **3040**.
Produção: VPS `169.58.71.28`, domínio `otatitan.giannasiadvogados.com.br`.

```
docker compose up -d db redis minio mailpit   # infraestrutura local
npm run dev                                   # aplicação
npm run worker                                # fila de jobs (processo à parte)
npm run db:migrate                            # migrations
npm run test                                  # unitários (sem banco)
npm run test:integration                      # isolamento, concorrência, RBAC
npm run check:payments                        # confere as chaves antes de cobrar
```

---

## Próximos passos

**Curto prazo** — validar um pagamento real de valor baixo ponta a ponta: abrir o
link pelo botão da reserva, pagar por PIX e conferir que a reserva confirma
sozinha pelo webhook. É o único passo que nenhum teste automatizado cobre, porque
exige a API de produção.

**Ciclo seguinte (v2)** — módulo financeiro completo (faturas, despesas,
repasses, extrato do proprietário), operação e manutenção (checklists, chamados,
inventário), CRM e comunicação, portais de proprietário e de hóspede.

**Depois (v3)** — channel manager real com Airbnb e Booking.com, automações de
mensagem por evento, avaliações, webhooks de saída e administração do próprio
SaaS.

---

*Detalhamento funcional, regras de negócio numeradas, decisões de arquitetura e
plano de testes estão em `docs/` (arquivos 00 a 13).*
