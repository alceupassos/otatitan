"use server";

import { AuthError, CredentialsSignin } from "next-auth";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { basePrisma } from "@/lib/db/client";
import { logger } from "@/lib/logging/logger";
import { sendPasswordResetEmail } from "@/lib/mail/send";
import { SIGNIN_ERRORS, type SignInErrorCode } from "./errors";
import { generateToken, hashToken } from "./crypto";
import { signIn, signOut, updateSession } from "./index";
import { findMembership } from "./memberships";
import { hashPassword, passwordSchema } from "./password";
import { checkRateLimit } from "./rate-limit";
import { ROLE_HOME } from "./routes";
import { requireUser } from "./session";

export type AuthFormState = {
  error?: SignInErrorCode | "erro_interno" | "token_invalido" | "senha_fraca";
  /** Mensagens de validação de senha, quando houver. */
  issues?: string[];
  /** Sucesso com mensagem neutra (fluxos que não revelam se o e-mail existe). */
  done?: boolean;
};

async function clientIp(): Promise<string> {
  const h = await headers();
  // `x-forwarded-for` só é confiável atrás de um proxy que reescreva o
  // header; por isso TRUSTED_PROXY é opt-in (docs/11-seguranca-lgpd.md).
  if (process.env.TRUSTED_PROXY === "true") {
    const forwarded = h.get("x-forwarded-for");
    if (forwarded) return forwarded.split(",")[0]!.trim();
  }
  return h.get("x-real-ip") ?? "desconhecido";
}

// ── Login ────────────────────────────────────────────────────────────────

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1),
  totp: z.string().trim().optional(),
  callbackUrl: z.string().optional(),
});

export async function loginAction(
  _prev: AuthFormState | undefined,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    totp: formData.get("totp") || undefined,
    callbackUrl: formData.get("callbackUrl") || undefined,
  });

  if (!parsed.success) return { error: SIGNIN_ERRORS.invalidCredentials };

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      totp: parsed.data.totp,
      ip: await clientIp(),
      redirect: false,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      // O Auth.js embrulha o erro do `authorize` em `cause.err`. Só
      // CredentialsSignin expõe `code`; qualquer outro AuthError (config,
      // JWT) não deve virar mensagem específica na tela de login.
      const cause = (error.cause as { err?: unknown } | undefined)?.err;
      const code =
        cause instanceof CredentialsSignin ? (cause.code as SignInErrorCode) : undefined;
      return { error: code ?? SIGNIN_ERRORS.invalidCredentials };
    }
    logger.error({ err: (error as Error).message }, "Falha inesperada no login");
    return { error: "erro_interno" };
  }

  // O redirect fica FORA do try: `redirect()` sinaliza por exceção, e um
  // catch aqui a engoliria, deixando o usuário parado no formulário.
  redirect(sanitizeCallback(parsed.data.callbackUrl) ?? "/dashboard");
}

/**
 * Só aceita caminho relativo do próprio app. Sem isso, `callbackUrl` vira
 * open redirect: `/login?callbackUrl=https://phishing.example` levaria o
 * usuário para fora logo após autenticar.
 */
function sanitizeCallback(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (!url.startsWith("/") || url.startsWith("//")) return undefined;
  return url;
}

export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}

// ── Troca de empresa ─────────────────────────────────────────────────────

export async function selectTenantAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const tenantId = String(formData.get("tenantId") ?? "");

  // Reconferido no banco — o valor vem do cliente.
  const membership = await findMembership(user.userId, tenantId);
  if (!membership) {
    redirect("/selecionar-empresa?erro=sem_acesso");
  }

  await updateSession({ tenantId: membership.tenantId });
  redirect(ROLE_HOME[membership.roleSlug]);
}

// ── Reset de senha ───────────────────────────────────────────────────────

const emailSchema = z.string().trim().toLowerCase().pipe(z.email());

/**
 * Sempre responde `done: true`, exista o e-mail ou não. Uma resposta
 * diferente para e-mail inexistente transformaria esta rota em um
 * verificador de contas cadastradas.
 */
export async function requestPasswordResetAction(
  _prev: AuthFormState | undefined,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return { done: true };

  const email = parsed.data;
  const ip = await clientIp();

  for (const [rule, id] of [
    ["reset:ip", ip],
    ["reset:email", email],
  ] as const) {
    const rl = await checkRateLimit(rule, id);
    if (!rl.allow) return { done: true };
  }

  const user = await basePrisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true, deletedAt: true },
  });

  if (user && !user.deletedAt) {
    const token = generateToken();
    const ttlMinutes = Number(process.env.PASSWORD_RESET_TTL_MINUTES ?? 30);

    // Invalida pedidos anteriores ainda abertos: dois links válidos ao
    // mesmo tempo dobram a janela de um link vazado por e-mail.
    await basePrisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    await basePrisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
        requestedIp: ip,
      },
    });

    await sendPasswordResetEmail({
      to: user.email,
      name: user.name,
      token,
      ttlMinutes,
    });
  }

  return { done: true };
}

const resetSchema = z.object({
  token: z.string().min(10),
  password: passwordSchema,
});

export async function resetPasswordAction(
  _prev: AuthFormState | undefined,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = resetSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .filter((i) => i.path[0] === "password")
      .map((i) => i.message);
    return issues.length > 0
      ? { error: "senha_fraca", issues }
      : { error: "token_invalido" };
  }

  const record = await basePrisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(parsed.data.token) },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });

  if (!record || record.usedAt || record.expiresAt < new Date()) {
    return { error: "token_invalido" };
  }

  const passwordHash = await hashPassword(parsed.data.password);

  await basePrisma.$transaction([
    basePrisma.user.update({
      where: { id: record.userId },
      // Redefinir a senha destrava a conta: quem provou controlar o e-mail
      // não deve ficar preso ao bloqueio causado pelas tentativas erradas.
      data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
    }),
    basePrisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
    // Qualquer outro link pendente morre junto.
    basePrisma.passwordResetToken.updateMany({
      where: { userId: record.userId, usedAt: null },
      data: { usedAt: new Date() },
    }),
  ]);

  logger.info({ userId: record.userId }, "Senha redefinida");
  return { done: true };
}
