import { createHash, timingSafeEqual } from "node:crypto";
import { MINUTOS_DE_HOLD } from "@/lib/reservations/estados";
import type { AsaasConfig } from "../config";
import { MIN_MINUTOS_DE_CHECKOUT } from "../limites";
import {
  CheckoutError,
  PaymentError,
  WebhookNotConfiguredError,
  WebhookSignatureError,
} from "../errors";
import type {
  CheckoutRequest,
  CheckoutResult,
  NormalizedWebhookEvent,
  PaymentProviderAdapter,
  WebhookEffect,
} from "../provider";

/**
 * Adapter do Asaas usando a API de Checkout HOSPEDADO (ADR-004).
 *
 * O hóspede é redirecionado para o domínio do Asaas e escolhe LÁ entre pix e
 * cartão. Nenhum campo de cartão existe no nosso HTML e nenhum PAN/CVV/
 * validade chega ao nosso servidor (RN-009). O que volta e pode ser guardado
 * é identificador de checkout/cobrança e, quando o Asaas devolve, bandeira e
 * os 4 últimos dígitos.
 *
 * Duas diferenças estruturais em relação ao adapter do Stripe, que explicam
 * por que este arquivo não é uma cópia daquele:
 *
 * 1. **Dinheiro em reais decimais.** A API do Asaas recebe e devolve
 *    `value: 1234.55`, não centavos. Toda a conversão vive em
 *    `centavosParaReais` / `reaisParaCentavos`, e nenhuma delas passa por
 *    multiplicação/divisão em ponto flutuante (RN-006).
 * 2. **Webhook sem assinatura HMAC.** O Asaas autentica o webhook com um
 *    token compartilhado no cabeçalho — ver `parseWebhook`.
 */

/** A conta Asaas opera em real; não há checkout em outra moeda. */
const MOEDA = "BRL";

/**
 * Formas de cobrança oferecidas ao hóspede — decisão de produto, não
 * detalhe técnico.
 *
 * BOLETO está deliberadamente FORA: ele compensa em 1 a 3 dias úteis e o
 * hold da reserva dura 30 minutos (RN-004). A reserva expiraria — e a data
 * seria revendida — antes de o dinheiro entrar, e o hóspede teria pago por
 * uma unidade que já não é dele.
 *
 * É por isso que a lista é explícita em vez de `UNDEFINED`: `UNDEFINED`
 * significa "todas as formas da conta", e isso inclui boleto.
 */
export const FORMAS_DE_COBRANCA = ["PIX", "CREDIT_CARD"] as const;

/** Cobrança avulsa (nem assinatura, nem parcelamento). */
const TIPOS_DE_COBRANCA = ["DETACHED"] as const;

/** Limites do `minutesToExpire` do Asaas. */
const MIN_MINUTOS_EXPIRACAO = MIN_MINUTOS_DE_CHECKOUT;
const MAX_MINUTOS_EXPIRACAO = 1440;

/**
 * Validade padrão, usada só quando a cobrança não traz prazo (reserva já
 * confirmada, que não tem mais hold a respeitar).
 */
const MINUTOS_DE_EXPIRACAO = Math.min(
  Math.max(MINUTOS_DE_HOLD, MIN_MINUTOS_EXPIRACAO),
  MAX_MINUTOS_EXPIRACAO,
);

/**
 * Quantos minutos de vida o checkout recebe.
 *
 * O prazo vem de quem abre a cobrança (`CheckoutRequest.expiresAt`), não de
 * uma constante: o `minutesToExpire` é contado a partir da criação do
 * CHECKOUT, então uma constante de 30 minutos aplicada a um hold que já
 * consumiu 26 produzia um link vivo por 26 minutos ALÉM da reserva — tempo
 * suficiente para o worker liberar a data, a unidade ser revendida e o
 * primeiro hóspede pagar assim mesmo (RN-002/RN-004).
 *
 * O `Math.min/max` continua sendo a fronteira do provedor: o Asaas recusa
 * menos de 10 minutos. Quem garante que esse piso não vira link mais longo
 * que o hold é `abrirCobranca`, que se recusa a abrir cobrança quando resta
 * menos que `MIN_MINUTOS_DE_CHECKOUT`.
 */
export function minutosParaExpirar(
  expiresAt: Date | null | undefined,
  agora: Date = new Date(),
): number {
  if (!expiresAt) return MINUTOS_DE_EXPIRACAO;
  // Arredonda para baixo: sobrar segundos a menos encurta o link; a mais,
  // deixaria o link viver depois do hold.
  const minutos = Math.floor((expiresAt.getTime() - agora.getTime()) / 60_000);
  return Math.min(
    Math.max(minutos, MIN_MINUTOS_EXPIRACAO),
    MAX_MINUTOS_EXPIRACAO,
  );
}

/** Limites de texto do item de checkout no Asaas. */
const MAX_NOME_ITEM = 30;
const MAX_DESCRICAO_ITEM = 150;

/**
 * Formato do `externalReference`.
 *
 * O Asaas não tem um campo de metadata livre como o `metadata` do Stripe:
 * há um único campo de texto por checkout (máx. 200 caracteres). Como o
 * webhook chega sem sessão, sem cookie e sem tenant, é ele o ÚNICO caminho
 * de volta — por isso os ids viajam serializados aqui:
 *
 *   otatitan:v1:<tenantId>:<paymentId>:<reservationId>
 *
 * Os três são UUID, que não contém `:`, então a separação é inequívoca. O
 * `v1` existe para que uma mudança de formato não faça a versão nova
 * interpretar errado um evento antigo — ele simplesmente não casa, e o
 * evento vira "alheio" em vez de apontar para o pagamento errado.
 * Comprimento total: 122 caracteres, dentro do limite.
 */
const PREFIXO_REFERENCIA = "otatitan:v1";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const REFERENCIA_RE = new RegExp(
  `^otatitan:v1:(${UUID}):(${UUID})(?::(${UUID}))?$`,
  "i",
);
const UUID_RE = new RegExp(`^${UUID}$`, "i");

/** Fuso do Asaas. O Brasil não tem mais horário de verão, então é constante. */
const FUSO_ASAAS = "-03:00";

/**
 * `fetch` recortado ao que este adapter usa — injetável para teste, e evita
 * depender do tipo global do DOM.
 */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<Response>;

type Json = Record<string, unknown>;

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor !== "" ? valor : null;
}

function objeto(valor: unknown): Json | null {
  return valor && typeof valor === "object" && !Array.isArray(valor)
    ? (valor as Json)
    : null;
}

function mensagem(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Dinheiro (RN-006)
// ---------------------------------------------------------------------------

/**
 * Centavos inteiros → reais decimais, como o Asaas espera (`8115` → `81.15`).
 *
 * A conversão é montada como STRING a partir de aritmética inteira, e só
 * então virada em número. `centavos / 100` também costuma acertar, mas
 * depende de o motor escolher a representação decimal mais curta — apostar
 * nisso para dinheiro é o tipo de detalhe que só falha em produção, num
 * valor específico, e vira divergência com o proprietário.
 */
export function centavosParaReais(centavos: number): number {
  if (!Number.isSafeInteger(centavos)) {
    throw new CheckoutError(
      `Valor precisa ser um inteiro de centavos; recebido: ${centavos}.`,
    );
  }
  const sinal = centavos < 0 ? "-" : "";
  const abs = Math.abs(centavos);
  const resto = abs % 100;
  // `(abs - resto)` é múltiplo exato de 100, então esta divisão é exata.
  const inteiros = (abs - resto) / 100;
  return Number(`${sinal}${inteiros}.${String(resto).padStart(2, "0")}`);
}

/**
 * Reais decimais do Asaas → centavos inteiros (`81.15` → `8115`).
 *
 * Feita sobre a representação decimal, nunca com `valor * 100`: em ponto
 * flutuante `1.005 * 100` dá `100.49999999999999`, e arredondar isso devolve
 * um centavo a menos (o mesmo motivo documentado em `src/lib/money.ts`).
 *
 * Devolve `null` — em vez de lançar — quando o campo não veio ou não é
 * numérico: no webhook, valor ausente é caso normal (nem todo evento traz
 * dinheiro) e não pode derrubar o recebimento.
 */
export function reaisParaCentavos(valor: unknown): number | null {
  if (typeof valor !== "number" && typeof valor !== "string") return null;
  if (typeof valor === "number" && !Number.isFinite(valor)) return null;

  const bruto = String(valor).trim();
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(bruto);
  if (!m) return null;

  const [, sinal, inteiro, fracao = ""] = m;
  // Duas primeiras casas são os centavos; da terceira em diante decide o
  // arredondamento (meio para cima), tudo em aritmética inteira.
  const centavosStr = fracao.padEnd(2, "0").slice(0, 2);
  const sobra = fracao.slice(2);
  const arredonda = sobra !== "" && Number(sobra[0]) >= 5 ? 1 : 0;

  const total = Number(inteiro) * 100 + Number(centavosStr) + arredonda;
  if (!Number.isSafeInteger(total)) return null;

  return sinal === "-" ? -total : total;
}

// ---------------------------------------------------------------------------
// Referência externa (o metadata que o Asaas não tem)
// ---------------------------------------------------------------------------

export function montarExternalReference(ids: {
  tenantId: string;
  paymentId: string;
  reservationId?: string | null;
}): string {
  // Id fora do formato UUID geraria uma referência que `lerExternalReference`
  // não reconhece de volta — ou seja, um pagamento que o webhook nunca
  // encontraria. Melhor falhar antes de abrir a cobrança.
  for (const [campo, valor] of [
    ["tenantId", ids.tenantId],
    ["paymentId", ids.paymentId],
  ] as const) {
    if (!UUID_RE.test(valor)) {
      throw new CheckoutError(
        `${campo} fora do formato UUID ("${valor}") — o webhook do Asaas não ` +
          "teria como reencontrar o pagamento.",
      );
    }
  }

  const partes = [PREFIXO_REFERENCIA, ids.tenantId, ids.paymentId];
  if (ids.reservationId && UUID_RE.test(ids.reservationId)) {
    partes.push(ids.reservationId);
  }
  return partes.join(":");
}

/**
 * Recupera os ids da referência. Tudo `null` quando o formato não casa: é
 * cobrança criada fora da plataforma (direto no painel do Asaas, ou por
 * outra integração na mesma conta), e chutar um tenant seria pior que
 * ignorar o evento.
 */
export function lerExternalReference(valor: unknown): {
  tenantId: string | null;
  paymentId: string | null;
  reservationId: string | null;
} {
  const m = REFERENCIA_RE.exec(texto(valor) ?? "");
  return {
    tenantId: m?.[1] ?? null,
    paymentId: m?.[2] ?? null,
    reservationId: m?.[3] ?? null,
  };
}

// ---------------------------------------------------------------------------
// Datas
// ---------------------------------------------------------------------------

/**
 * Converte data do Asaas em `Date`.
 *
 * O formato usual é `"2024-06-12 16:45:03"` — sem `T` e sem fuso. Passar
 * isso direto para `new Date` faz o horário ser lido no fuso do SERVIDOR:
 * num container em UTC, um pagamento das 23h de São Paulo viraria o dia
 * seguinte no relatório. Por isso o instante é fixado em -03:00 aqui.
 * Strings que já trazem fuso próprio são respeitadas como estão.
 */
export function instanteDoAsaas(valor: unknown): Date | null {
  const bruto = texto(valor)?.trim();
  if (!bruto) return null;

  const temFuso = /(?:Z|[+-]\d{2}:?\d{2})$/.test(bruto);
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2}))?/.exec(bruto);
  if (!m) return null;

  const d = temFuso
    ? new Date(bruto)
    : new Date(`${m[1]}T${m[2] ?? "00:00:00"}${FUSO_ASAAS}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

/**
 * Vocabulário do Asaas → efeito de negócio.
 *
 * Notas que não se leem na tabela:
 * - `PAYMENT_CONFIRMED` (pago, dinheiro ainda não liberado) e
 *   `PAYMENT_RECEIVED` (dinheiro na conta) chegam os DOIS para a mesma
 *   cobrança. Ambos confirmam a reserva; a dupla baixa é barrada na
 *   transição de status do `Payment`, não aqui.
 * - `PAYMENT_REFUND_IN_PROGRESS` fica de fora de propósito: reembolso
 *   pedido ainda não é dinheiro devolvido. Quem devolve é `PAYMENT_REFUNDED`.
 * - `CHECKOUT_PAID` também fica de fora: ele não traz a cobrança, e a
 *   verdade sobre dinheiro está nos eventos `PAYMENT_*`.
 * - `PAYMENT_OVERDUE` é o pix que venceu sem ninguém pagar — cancelamento,
 *   não falha de cobrança (ver EFFECT_TO_PAYMENT_STATUS).
 */
const EFEITO_POR_EVENTO: Readonly<Record<string, WebhookEffect>> = {
  PAYMENT_CONFIRMED: "PAYMENT_SUCCEEDED",
  PAYMENT_RECEIVED: "PAYMENT_SUCCEEDED",

  PAYMENT_REFUNDED: "PAYMENT_REFUNDED",
  PAYMENT_PARTIALLY_REFUNDED: "PAYMENT_PARTIALLY_REFUNDED",

  PAYMENT_OVERDUE: "PAYMENT_EXPIRED",
  PAYMENT_DELETED: "PAYMENT_EXPIRED",
  CHECKOUT_EXPIRED: "PAYMENT_EXPIRED",
  CHECKOUT_CANCELED: "PAYMENT_EXPIRED",

  PAYMENT_CREDIT_CARD_CAPTURE_REFUSED: "PAYMENT_FAILED",
  PAYMENT_REPROVED_BY_RISK_ANALYSIS: "PAYMENT_FAILED",
};

/**
 * Tudo que não está na tabela é registrado e não vira efeito. Adivinhar o
 * significado de um evento desconhecido é como se confirma reserva sem
 * dinheiro.
 */
export function efeitoDoEventoAsaas(tipo: string): WebhookEffect {
  return EFEITO_POR_EVENTO[tipo] ?? "IGNORED";
}

/**
 * O Asaas não manda o motivo da recusa do adquirente no webhook — só o tipo
 * do evento. Guardar uma frase em pt-BR aqui é o que o operador vai ler na
 * tela; inventar um código de recusa que não existe, não.
 */
const MENSAGEM_DE_FALHA: Readonly<Record<string, string>> = {
  PAYMENT_CREDIT_CARD_CAPTURE_REFUSED:
    "Cartão recusado pela operadora. Peça outro cartão ao hóspede ou ofereça pix.",
  PAYMENT_REPROVED_BY_RISK_ANALYSIS:
    "Cobrança reprovada na análise de risco do Asaas.",
};

/**
 * Soma dos reembolsos já CONCLUÍDOS, em centavos.
 *
 * Só `DONE` conta: `PENDING` ainda não devolveu dinheiro e `CANCELLED` nunca
 * vai devolver — somá-los tiraria do `paidCents` da reserva um valor que o
 * hóspede não recebeu de volta.
 */
function centavosReembolsados(pagamento: Json | null): number | null {
  const lista = pagamento?.refunds;
  if (!Array.isArray(lista)) return null;

  let total = 0;
  let achou = false;
  for (const item of lista) {
    const r = objeto(item);
    if (!r || r.status !== "DONE") continue;
    const c = reaisParaCentavos(r.value);
    if (c === null) continue;
    total += c;
    achou = true;
  }
  return achou ? total : null;
}

/**
 * Bandeira e 4 últimos dígitos são o MÁXIMO que pode ser guardado (RN-009).
 *
 * O filtro `\d{4}` não é paranoia gratuita: se um dia o campo vier com mais
 * dígitos, gravá-lo seria persistir PAN. Na dúvida, não guarda nada.
 */
function ultimos4(valor: unknown): string | null {
  const t = texto(valor);
  return t && /^\d{4}$/.test(t) ? t : null;
}

/**
 * Id do evento — chave de idempotência do recebimento.
 *
 * O Asaas manda `id` (`"evt_...&368604920"`) e o repete em cada reentrega,
 * que é exatamente o que a unique `(provider, eventId)` precisa. O fallback
 * abaixo só existe para o dia em que um evento chegar sem ele: um hash de
 * tipo + objeto + data é determinista, então a reentrega desse mesmo evento
 * continua colidindo e não vira segundo efeito. O preço é que dois eventos
 * DIFERENTES do mesmo tipo, sobre o mesmo objeto, no mesmo segundo, seriam
 * confundidos — erro na direção conservadora (deixa de aplicar, nunca aplica
 * duas vezes).
 */
function idDoEvento(raiz: Json, tipo: string, objetoId: string | null): string {
  const id = texto(raiz.id);
  if (id) return id;

  const semente = `${tipo}|${objetoId ?? ""}|${texto(raiz.dateCreated) ?? ""}`;
  const hash = createHash("sha256").update(semente).digest("hex").slice(0, 32);
  return `asaas-sem-id:${hash}`;
}

/** Esqueleto do evento normalizado. */
function base(
  eventId: string,
  tipo: string,
  efeito: WebhookEffect,
  payload: unknown,
): NormalizedWebhookEvent {
  return {
    provider: "ASAAS",
    eventId,
    type: tipo,
    effect: efeito,
    tenantId: null,
    paymentId: null,
    reservationId: null,
    providerSessionId: null,
    providerPaymentId: null,
    amountCents: null,
    currency: null,
    cardBrand: null,
    cardLast4: null,
    receiptUrl: null,
    failureCode: null,
    failureMessage: null,
    paidAt: null,
    payload,
  };
}

/**
 * Normaliza o payload do webhook.
 *
 * Exportada para teste: o mapeamento errado de um único evento é a diferença
 * entre confirmar e não confirmar uma reserva paga.
 */
export function normalizarEventoAsaas(payload: unknown): NormalizedWebhookEvent {
  const raiz = objeto(payload) ?? {};
  const tipo = texto(raiz.event) ?? "";
  const efeito = efeitoDoEventoAsaas(tipo);

  const pagamento = objeto(raiz.payment);
  const checkout = objeto(raiz.checkout);

  const providerPaymentId = texto(pagamento?.id);
  const providerSessionId = texto(checkout?.id);
  const eventId = idDoEvento(raiz, tipo, providerPaymentId ?? providerSessionId);

  // A referência pode chegar pela cobrança ou pelo checkout, dependendo do
  // evento; as duas foram carimbadas por nós na abertura.
  const ids = lerExternalReference(
    pagamento?.externalReference ?? checkout?.externalReference,
  );

  const reembolso =
    efeito === "PAYMENT_REFUNDED" || efeito === "PAYMENT_PARTIALLY_REFUNDED";
  const valorDoPagamento = reaisParaCentavos(pagamento?.value);
  const devolvido = centavosReembolsados(pagamento);

  const cartao = objeto(pagamento?.creditCard);
  const sucesso = efeito === "PAYMENT_SUCCEEDED";

  return {
    ...base(eventId, tipo, efeito, payload),
    tenantId: ids.tenantId,
    paymentId: ids.paymentId,
    // O item do checkout também carrega o id da reserva, mas ele não volta
    // nos eventos de cobrança — a referência do checkout é a fonte estável.
    reservationId: ids.reservationId,
    providerSessionId,
    providerPaymentId,
    /**
     * Em reembolso o valor é o DEVOLVIDO, não o original: é ele que sai do
     * `paidCents` da reserva. `payment.value` continua sendo o valor cheio
     * da cobrança mesmo depois de um reembolso parcial, então só serve de
     * queda para o reembolso TOTAL — no parcial, sem a lista de `refunds`,
     * preferimos `null` a devolver um número que subtrairia demais.
     */
    amountCents: reembolso
      ? (devolvido ?? (efeito === "PAYMENT_REFUNDED" ? valorDoPagamento : null))
      : valorDoPagamento,
    currency: MOEDA,
    cardBrand: texto(cartao?.creditCardBrand),
    cardLast4: ultimos4(cartao?.creditCardNumber),
    receiptUrl: texto(pagamento?.transactionReceiptUrl),
    failureCode: efeito === "PAYMENT_FAILED" ? tipo : null,
    failureMessage:
      efeito === "PAYMENT_FAILED" ? (MENSAGEM_DE_FALHA[tipo] ?? null) : null,
    // `dateCreated` do EVENTO tem hora; `confirmedDate`/`paymentDate` da
    // cobrança são data pura e só entram como queda.
    paidAt: sucesso
      ? (instanteDoAsaas(raiz.dateCreated) ??
        instanteDoAsaas(pagamento?.confirmedDate) ??
        instanteDoAsaas(pagamento?.paymentDate))
      : null,
  };
}

// ---------------------------------------------------------------------------
// Erros da API
// ---------------------------------------------------------------------------

function comoJson(corpo: string): Json | null {
  try {
    return objeto(JSON.parse(corpo));
  } catch {
    return null;
  }
}

/**
 * O Asaas responde erro como `{"errors":[{"code":"...","description":"..."}]}`.
 * A descrição vem em português e é o que o operador precisa ler — repassá-la
 * é melhor que um "HTTP 400" que obriga a abrir o log do servidor.
 */
function descreverErro(corpo: string): string {
  const json = comoJson(corpo);
  const erros = json?.errors;
  if (Array.isArray(erros)) {
    const descricoes = erros
      .map((e) => {
        const o = objeto(e);
        return texto(o?.description) ?? texto(o?.code);
      })
      .filter((d): d is string => d !== null);
    if (descricoes.length > 0) return descricoes.join("; ");
  }
  return texto(corpo.trim().slice(0, 300)) ?? "sem detalhe na resposta";
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export function createAsaasProvider(
  config: AsaasConfig,
  /** Injetável para teste — nenhuma chamada de rede acontece na criação. */
  httpFetch: FetchLike = (url, init) => globalThis.fetch(url, init),
): PaymentProviderAdapter {
  return {
    key: "ASAAS",

    async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
      if (req.currency.toUpperCase() !== MOEDA) {
        // Erro explícito, não conversão: a conta Asaas liquida em real, e
        // mandar o número de outra moeda como se fosse real cobraria o valor
        // errado sem nenhum sinal de que algo deu errado.
        throw new CheckoutError(
          `A conta Asaas opera apenas em ${MOEDA}; a cobrança veio em "${req.currency}".`,
        );
      }

      const externalReference = montarExternalReference({
        tenantId: req.metadata.tenantId,
        paymentId: req.metadata.paymentId,
        reservationId: req.reservationId,
      });

      const corpo = {
        billingTypes: [...FORMAS_DE_COBRANCA],
        chargeTypes: [...TIPOS_DE_COBRANCA],
        minutesToExpire: minutosParaExpirar(req.expiresAt),
        externalReference,
        callback: {
          successUrl: req.successUrl,
          // Expirado cai na mesma tela de cancelado de propósito: para o
          // hóspede o desfecho é o mesmo (a reserva não é mais dele), e a
          // tela de cancelamento já explica como recomeçar.
          cancelUrl: req.cancelUrl,
          expiredUrl: req.cancelUrl,
        },
        items: [
          {
            name: req.description.slice(0, MAX_NOME_ITEM),
            description: req.description.slice(0, MAX_DESCRICAO_ITEM),
            quantity: 1,
            // Reais decimais — a única fronteira em que o dinheiro deixa de
            // ser centavo inteiro (RN-006).
            value: centavosParaReais(req.amountCents),
            externalReference: req.reservationId,
          },
        ],
      };

      let resposta: Response;
      try {
        resposta = await httpFetch(`${config.apiUrl}/checkouts`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            // O Asaas não usa Bearer: a chave vai crua neste cabeçalho.
            access_token: config.apiKey,
          },
          body: JSON.stringify(corpo),
        });
      } catch (err) {
        // Falha de rede vira erro do domínio: quem chamou trata `CheckoutError`,
        // não `TypeError: fetch failed`.
        throw new CheckoutError(
          `Falha de rede ao abrir o checkout no Asaas: ${mensagem(err)}`,
        );
      }

      let bruto: string;
      try {
        bruto = await resposta.text();
      } catch (err) {
        throw new CheckoutError(
          `Não foi possível ler a resposta do Asaas: ${mensagem(err)}`,
        );
      }

      if (!resposta.ok) {
        throw new CheckoutError(
          `O Asaas recusou a abertura do checkout (HTTP ${resposta.status}): ` +
            descreverErro(bruto),
        );
      }

      const dados = comoJson(bruto);
      const id = texto(dados?.id);
      const link = texto(dados?.link);

      // Resposta 2xx sem link não é "meio ok": não há para onde mandar o
      // hóspede, e devolver `redirectUrl: null` faria a tela seguinte
      // silenciosamente não cobrar nada.
      if (!id || !link) {
        throw new CheckoutError(
          "O Asaas respondeu sem id ou sem link do checkout — não há para onde " +
            "redirecionar o hóspede.",
        );
      }

      return { provider: "ASAAS", providerSessionId: id, redirectUrl: link };
    },

    async parseWebhook(
      rawBody: string,
      signatureHeader: string | null,
    ): Promise<NormalizedWebhookEvent> {
      /**
       * ATENÇÃO — a verificação aqui NÃO é assinatura HMAC como a do Stripe,
       * e isso não é omissão.
       *
       * O Asaas não assina o corpo. Ele reenvia, em todo webhook, um token
       * fixo que nós mesmos cadastramos no painel, no cabeçalho
       * `asaas-access-token`. A verificação possível é comparar esse token
       * com o nosso — e é por isso que o corpo cru não precisa ser preservado
       * byte a byte (nada é calculado sobre ele), embora continue sendo o que
       * recebemos.
       *
       * Consequência prática: quem conhece o token pode forjar qualquer
       * evento. O token é segredo de produção, com a mesma gravidade da chave
       * de API.
       */
      if (!config.webhookToken) {
        throw new WebhookNotConfiguredError(
          "ASAAS_WEBHOOK_TOKEN não configurado: sem ele não há verificação " +
            "possível, e webhook não verificado não confirma pagamento (RN-009).",
        );
      }
      if (!signatureHeader) {
        throw new WebhookSignatureError(
          "Requisição sem o cabeçalho `asaas-access-token`.",
        );
      }
      if (!tokensIguais(signatureHeader, config.webhookToken)) {
        throw new WebhookSignatureError(
          "Token do webhook Asaas não confere.",
        );
      }

      let payload: unknown;
      try {
        payload = JSON.parse(rawBody);
      } catch (err) {
        // Token confere, então o remetente é legítimo — o defeito está no
        // corpo. Erro de payload, não de autenticação.
        throw new PaymentError(
          `Corpo do webhook Asaas não é JSON válido: ${mensagem(err)}`,
        );
      }

      return normalizarEventoAsaas(payload);
    },
  };
}

/**
 * Comparação de tokens em tempo constante.
 *
 * `===` em string sai no primeiro byte diferente, e essa diferença de tempo é
 * medível pela rede: dá para descobrir o token caractere a caractere. O
 * digest resolve os dois problemas de uma vez — `timingSafeEqual` exige
 * buffers do MESMO tamanho (com tamanhos diferentes ele LANÇA, e o próprio
 * estouro já vazaria o comprimento do segredo), e o SHA-256 devolve sempre
 * 32 bytes.
 */
function tokensIguais(recebido: string, esperado: string): boolean {
  const a = createHash("sha256").update(recebido, "utf8").digest();
  const b = createHash("sha256").update(esperado, "utf8").digest();
  return timingSafeEqual(a, b);
}
