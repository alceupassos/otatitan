import { randomInt } from "node:crypto";
import type { TenantTx } from "@/lib/db/with-tenant";
import { CodigoNaoGerado } from "./errors";

/**
 * Código humano da reserva — o que o hóspede lê ao telefone e o operador
 * digita na busca.
 *
 * Requisitos que moldaram o formato:
 * - Curto o bastante para ser ditado sem soletrar duas vezes.
 * - Sem par ambíguo: `0`/`O` e `1`/`I`/`L` ficam TODOS de fora, os cinco.
 *   Excluir só um lado de cada par não resolve nada — quem lê "O" num
 *   código continua sem saber se digita a letra ou o zero.
 * - Aleatório, não sequencial: `RES-000123` conta quantas reservas a
 *   empresa fez para qualquer um que receba um e-mail de confirmação.
 *
 * Unicidade real é da unique `(tenantId, code)` no banco. O sorteio só
 * torna a colisão improvável; quem a impede é a constraint, e a colisão é
 * tratada com outra tentativa, nunca com erro na cara do usuário.
 */

/** 31 símbolos: dígitos 2–9 e letras sem `O`, `I` e `L`. */
export const ALFABETO_CODIGO = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** 31^8 ≈ 8,5×10^11 combinações — colisão é evento de sorteio, não de rotina. */
export const TAMANHO_CODIGO = 8;

/** Tentativas de sorteio antes de desistir. */
export const MAX_TENTATIVAS_CODIGO = 5;

/**
 * Sorteia um código.
 *
 * `randomInt` (CSPRNG, com rejeição de amostra) em vez de `Math.random()`:
 * um código adivinhável é um link de confirmação adivinhável.
 */
export function gerarCodigo(): string {
  let codigo = "";
  for (let i = 0; i < TAMANHO_CODIGO; i++) {
    codigo += ALFABETO_CODIGO[randomInt(ALFABETO_CODIGO.length)];
  }
  return codigo;
}

/**
 * Forma canônica do que o usuário digitou na busca.
 *
 * Tira hífen, espaço e ponto (o operador copia o código do e-mail já
 * formatado) e sobe para maiúsculas. Não "conserta" caracteres fora do
 * alfabeto: como nenhum dos pares ambíguos está no alfabeto, um `0`
 * digitado não é outra grafia de nada — é erro de leitura, e adivinhar por
 * ele traria a reserva errada.
 */
export function normalizarCodigo(bruto: string): string {
  return bruto.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

export function ehCodigoValido(codigo: string): boolean {
  if (codigo.length !== TAMANHO_CODIGO) return false;
  return [...codigo].every((c) => ALFABETO_CODIGO.includes(c));
}

/**
 * Exibição: `A7K2-9QF3`. O hífen é só apresentação — no banco o código é
 * gravado sem separador, para que buscar "A7K29QF3" e "a7k2-9qf3" encontre
 * a mesma reserva depois de `normalizarCodigo`.
 */
export function formatarCodigo(codigo: string): string {
  const meio = Math.ceil(codigo.length / 2);
  return `${codigo.slice(0, meio)}-${codigo.slice(meio)}`;
}

/**
 * Sorteia um código que ainda não existe no tenant.
 *
 * A consulta é uma checagem otimista sobre um índice único, dentro da
 * mesma transação da criação: ela evita a rodada de rollback no caso
 * banal, mas quem garante a unicidade é a constraint. Duas transações
 * concorrentes podem passar por aqui com o mesmo código; a segunda leva
 * P2002 no INSERT e o chamador (`criarReserva`) refaz a transação.
 */
export async function gerarCodigoUnico(
  tx: TenantTx,
  tentativas = MAX_TENTATIVAS_CODIGO,
): Promise<string> {
  for (let i = 0; i < tentativas; i++) {
    const codigo = gerarCodigo();
    const existente = await tx.reservation.findFirst({
      where: { code: codigo },
      select: { id: true },
    });
    if (!existente) return codigo;
  }
  throw new CodigoNaoGerado(tentativas);
}
