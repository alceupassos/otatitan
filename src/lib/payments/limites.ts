/**
 * Limites que o domínio e os adapters de pagamento precisam compartilhar.
 *
 * Módulo separado (e sem nenhuma dependência) de propósito: `provider.ts`
 * importa os adapters e os adapters importam tipos de `provider.ts`. Pôr uma
 * CONSTANTE nesse par fecharia um ciclo de valor entre os dois módulos, e o
 * lado que fosse avaliado primeiro leria a constante ainda na zona morta.
 */

/**
 * Menor validade que um checkout hospedado aceita, em minutos.
 *
 * É o piso do `minutesToExpire` do Asaas, o provedor ativo do produto. Ele
 * importa ao domínio, não só ao adapter: quando resta menos hold que isto,
 * `abrirCobranca` se RECUSA a abrir a cobrança, porque o link
 * necessariamente viveria mais que a reserva — e cobrar por uma data que o
 * worker vai liberar é o defeito, não a resposta do provedor (RN-002/RN-004).
 */
export const MIN_MINUTOS_DE_CHECKOUT = 10;
