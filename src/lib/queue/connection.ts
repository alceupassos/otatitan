import type { ConnectionOptions } from "bullmq";
import { redisUrl } from "@/lib/cache/redis";

/**
 * Conexão do BullMQ com o Redis.
 *
 * A URL vem de `redisUrl()` — mesma fonte do cache — mas a conexão é
 * outra, de propósito: o Worker mantém chamadas bloqueantes
 * (BRPOPLPUSH) abertas o tempo todo, e um socket preso nisso não pode ser
 * o mesmo que atende leitura de cache. Por isso cada `Queue`/`Worker`
 * recebe estas opções e abre a própria conexão, em vez de reaproveitar o
 * singleton de `getRedis()`.
 *
 * ATENÇÃO — `bullmq@6.0.5` importa `ioredis/built/utils` de forma
 * estática (tanto no build cjs quanto no esm), então o pacote `ioredis`
 * precisa estar instalado mesmo sendo declarado como peer *opcional*.
 * Sem ele, qualquer import de `bullmq` estoura MODULE_NOT_FOUND antes de
 * qualquer código nosso rodar.
 */
export const conexaoFilas: ConnectionOptions = { url: redisUrl() };

/** Namespace das chaves no Redis — as filas convivem com o cache. */
export const PREFIXO_FILAS = "otatitan";

/**
 * Jobs concluídos/falhos são lixo depois de um tempo — o Redis aqui é
 * fila, não histórico. O que precisa sobreviver vira `AuditLog`.
 */
export const RETENCAO_PADRAO = {
  removeOnComplete: { age: 3_600, count: 500 },
  removeOnFail: { age: 86_400 },
} as const;
