import { createClient, type RedisClientType } from "redis";
import { logger } from "@/lib/logging/logger";

declare global {
  var __otatitanRedis: RedisClientType | undefined;
}

let connecting: Promise<RedisClientType> | null = null;

/**
 * Fonte única da URL do Redis — cache, rate limiting e as filas BullMQ
 * (`src/lib/queue/connection.ts`). O worker precisa das próprias conexões
 * (as chamadas bloqueantes do BullMQ não podem dividir socket com o
 * cache), mas o endereço tem que ser um só.
 */
export function redisUrl(): string {
  return process.env.REDIS_URL ?? "redis://localhost:6389";
}

/**
 * Cliente Redis compartilhado. Usado para cache de permissões e rate
 * limiting — nunca como fonte de verdade.
 */
export async function getRedis(): Promise<RedisClientType> {
  if (globalThis.__otatitanRedis?.isReady) return globalThis.__otatitanRedis;
  if (connecting) return connecting;

  connecting = (async () => {
    const client = createClient({ url: redisUrl() }) as RedisClientType;

    client.on("error", (err) => {
      logger.warn({ err: err.message }, "Erro no cliente Redis");
    });

    await client.connect();
    globalThis.__otatitanRedis = client;
    return client;
  })();

  try {
    return await connecting;
  } finally {
    connecting = null;
  }
}

/**
 * Leitura de cache que nunca derruba a requisição: se o Redis estiver
 * fora, retorna null e o chamador vai à fonte de verdade (o banco).
 * Cache indisponível é degradação de performance, não de correção.
 */
export async function cacheGet(key: string): Promise<string | null> {
  try {
    const redis = await getRedis();
    return await redis.get(key);
  } catch (err) {
    logger.warn({ key, err: (err as Error).message }, "Falha ao ler cache");
    return null;
  }
}

export async function cacheSet(key: string, value: string, ttlSeconds: number) {
  try {
    const redis = await getRedis();
    await redis.set(key, value, { EX: ttlSeconds });
  } catch (err) {
    logger.warn({ key, err: (err as Error).message }, "Falha ao gravar cache");
  }
}

export async function cacheDelete(pattern: string) {
  try {
    const redis = await getRedis();
    await redis.del(pattern);
  } catch (err) {
    logger.warn({ pattern, err: (err as Error).message }, "Falha ao limpar cache");
  }
}
