import { getRedis } from "@/lib/cache/redis";
import { logger } from "@/lib/logging/logger";

/**
 * Rate limiting por janela deslizante (docs/11-seguranca-lgpd.md).
 *
 * Implementado com sorted set: cada tentativa vira um membro pontuado pelo
 * timestamp, o que dá uma janela realmente deslizante — diferente de
 * contador com TTL, que zera de uma vez e deixa passar uma rajada dupla na
 * virada.
 *
 * **Fail-open por decisão explícita**: com o Redis fora, `allow` é `true`.
 * Fechar aqui derrubaria o login de todo mundo por causa de um cache que
 * nem é fonte de verdade. O que protege a conta individual nesse cenário é
 * a segunda camada, que vive no banco: `User.failedLoginCount` +
 * `lockedUntil` (ver lockout.ts). São camadas distintas de propósito —
 * uma por origem (IP), outra por conta.
 */
export type RateLimitResult = {
  allow: boolean;
  remaining: number;
  /** Segundos até a janela liberar de novo (0 quando ainda há saldo). */
  retryAfterSeconds: number;
};

export type RateLimitRule = {
  limit: number;
  windowSeconds: number;
};

/** Regras por ação sensível. Chave = prefixo usado no Redis. */
export const RATE_LIMITS = {
  "login:ip": { limit: 20, windowSeconds: 300 },
  "login:email": { limit: 8, windowSeconds: 300 },
  "reset:ip": { limit: 10, windowSeconds: 3600 },
  "reset:email": { limit: 5, windowSeconds: 3600 },
  "mfa:user": { limit: 10, windowSeconds: 300 },
  "direct:search:ip": { limit: 60, windowSeconds: 60 },
  "direct:book:ip": { limit: 8, windowSeconds: 300 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitKey = keyof typeof RATE_LIMITS;

const ALLOWED: RateLimitResult = {
  allow: true,
  remaining: Number.POSITIVE_INFINITY,
  retryAfterSeconds: 0,
};

export async function checkRateLimit(
  rule: RateLimitKey,
  identifier: string,
): Promise<RateLimitResult> {
  if (process.env.RATE_LIMIT_ENABLED === "false") return ALLOWED;

  const { limit, windowSeconds } = RATE_LIMITS[rule];
  const key = `rl:${rule}:${identifier}`;
  const now = Date.now();
  const windowStart = now - windowSeconds * 1000;

  try {
    const redis = await getRedis();

    // Pipeline: descarta o que saiu da janela, registra a tentativa atual,
    // conta o que sobrou e renova o TTL — em um único round-trip.
    const [, , count] = (await redis
      .multi()
      .zRemRangeByScore(key, 0, windowStart)
      .zAdd(key, { score: now, value: `${now}:${Math.random()}` })
      .zCard(key)
      .expire(key, windowSeconds)
      .exec()) as unknown as [unknown, unknown, number];

    const used = Number(count);
    if (used <= limit) {
      return { allow: true, remaining: limit - used, retryAfterSeconds: 0 };
    }

    // Excedeu: o retry-after sai do timestamp mais antigo ainda na janela.
    const oldest = await redis.zRangeWithScores(key, 0, 0);
    const oldestScore = oldest[0]?.score ?? now;
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((oldestScore + windowSeconds * 1000 - now) / 1000),
    );

    return { allow: false, remaining: 0, retryAfterSeconds };
  } catch (err) {
    logger.warn(
      { rule, err: (err as Error).message },
      "Rate limit indisponível (Redis) — liberando a tentativa",
    );
    return ALLOWED;
  }
}

/** Zera a janela — chamado após uma tentativa bem-sucedida. */
export async function resetRateLimit(
  rule: RateLimitKey,
  identifier: string,
): Promise<void> {
  try {
    const redis = await getRedis();
    await redis.del(`rl:${rule}:${identifier}`);
  } catch {
    // Sem Redis não há janela para limpar.
  }
}
