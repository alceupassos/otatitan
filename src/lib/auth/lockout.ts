import { basePrisma } from "@/lib/db/client";

/**
 * Bloqueio de conta após falhas consecutivas (docs/11-seguranca-lgpd.md):
 * 5 falhas → 15 minutos travado.
 *
 * Segunda camada, independente do rate limit por IP: aquele mora no Redis
 * e é fail-open; este mora no banco e é a garantia que sobrevive ao cache
 * cair. Um atacante distribuído contorna o limite por IP, mas ainda esbarra
 * neste, que é por conta.
 *
 * `User` não é tenant-scoped (um humano pode ter membership em vários
 * tenants), então usa `basePrisma` direto, sem withTenant.
 */
export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;

export type LockState = {
  locked: boolean;
  /** Segundos restantes de bloqueio (0 se não está bloqueado). */
  retryAfterSeconds: number;
};

export function lockStateOf(user: {
  lockedUntil: Date | null;
}): LockState {
  if (!user.lockedUntil) return { locked: false, retryAfterSeconds: 0 };

  const remainingMs = user.lockedUntil.getTime() - Date.now();
  if (remainingMs <= 0) return { locked: false, retryAfterSeconds: 0 };

  return {
    locked: true,
    retryAfterSeconds: Math.ceil(remainingMs / 1000),
  };
}

/**
 * Registra uma falha e trava a conta ao atingir o limite. Retorna o estado
 * resultante para que o chamador possa avisar quanto tempo falta.
 */
export async function registerFailedLogin(userId: string): Promise<LockState> {
  const user = await basePrisma.user.update({
    where: { id: userId },
    data: { failedLoginCount: { increment: 1 } },
    select: { failedLoginCount: true },
  });

  if (user.failedLoginCount < MAX_FAILED_LOGINS) {
    return { locked: false, retryAfterSeconds: 0 };
  }

  const lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60_000);
  await basePrisma.user.update({
    where: { id: userId },
    // Zera o contador junto com a trava: senão, passados os 15 minutos, a
    // próxima falha isolada travaria a conta de novo na hora.
    data: { lockedUntil, failedLoginCount: 0 },
  });

  return { locked: true, retryAfterSeconds: LOCKOUT_MINUTES * 60 };
}

export async function registerSuccessfulLogin(userId: string): Promise<void> {
  await basePrisma.user.update({
    where: { id: userId },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
}
