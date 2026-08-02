import { PrismaAdapter } from "@auth/prisma-adapter";
import { CredentialsSignin, type NextAuthConfig } from "next-auth";
// Import obrigatório mesmo sem uso direto: `declare module` só consegue
// aumentar um módulo que já foi resolvido neste arquivo. Sem ele, o
// `declare module "next-auth/jwt"` lá embaixo falha com TS2664 e todo o
// token volta a ser `unknown`.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { JWT } from "next-auth/jwt";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { basePrisma } from "@/lib/db/client";
import { logger } from "@/lib/logging/logger";
import type { RoleSlug } from "@/lib/rbac/roles";
import { SIGNIN_ERRORS, type SignInErrorCode } from "./errors";
import { lockStateOf, registerFailedLogin, registerSuccessfulLogin } from "./lockout";
import { findMembership, listActiveMemberships } from "./memberships";
import { verifySecondFactor } from "./mfa";
import { verifyPassword } from "./password";
import { checkRateLimit, resetRateLimit } from "./rate-limit";

class SignInFailure extends CredentialsSignin {
  constructor(public code: SignInErrorCode) {
    super(code);
  }
}

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  // Sem política de senha aqui: no login validamos contra o hash, não
  // contra a regra. Aplicar a política aqui rejeitaria, com mensagem
  // diferente, a senha antiga de quem cadastrou antes de a regra endurecer.
  password: z.string().min(1),
  /** Código TOTP ou de recuperação, no segundo passo do formulário. */
  totp: z.string().trim().optional(),
  /** IP de origem, injetado pela server action (o authorize não vê a request). */
  ip: z.string().optional(),
});

export const authConfig = {
  adapter: PrismaAdapter(basePrisma),
  // Credentials exige JWT: uma sessão de banco só é criada pelo adapter em
  // fluxos OAuth/e-mail. O adapter fica configurado mesmo assim para que
  // adicionar um provedor social depois não exija migration nem mudança
  // aqui (as tabelas Account/Session/VerificationToken já existem).
  session: {
    strategy: "jwt",
    maxAge: Number(process.env.SESSION_MAX_AGE_SECONDS ?? 28_800),
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  trustHost: true,
  providers: [
    Credentials({
      credentials: {
        email: { label: "E-mail", type: "email" },
        password: { label: "Senha", type: "password" },
        totp: { label: "Código de verificação", type: "text" },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) {
          throw new SignInFailure(SIGNIN_ERRORS.invalidCredentials);
        }
        const { email, password, totp, ip } = parsed.data;

        // Duas janelas: por origem e por conta alvo. A primeira contém
        // varredura de muitas contas a partir de um IP; a segunda, ataque
        // distribuído contra uma conta específica.
        for (const [rule, id] of [
          ["login:ip", ip ?? "desconhecido"],
          ["login:email", email],
        ] as const) {
          const rl = await checkRateLimit(rule, id);
          if (!rl.allow) throw new SignInFailure(SIGNIN_ERRORS.rateLimited);
        }

        const user = await basePrisma.user.findUnique({
          where: { email },
          select: {
            id: true,
            email: true,
            name: true,
            image: true,
            passwordHash: true,
            isSuperadmin: true,
            mfaEnabled: true,
            lockedUntil: true,
            deletedAt: true,
          },
        });

        // Usuário inexistente ainda paga o custo de um bcrypt: sem isso, o
        // tempo de resposta diz quais e-mails existem.
        if (!user || user.deletedAt) {
          await verifyPassword(password, null);
          throw new SignInFailure(SIGNIN_ERRORS.invalidCredentials);
        }

        const lock = lockStateOf(user);
        if (lock.locked) throw new SignInFailure(SIGNIN_ERRORS.locked);

        if (!(await verifyPassword(password, user.passwordHash))) {
          const state = await registerFailedLogin(user.id);
          throw new SignInFailure(
            state.locked ? SIGNIN_ERRORS.locked : SIGNIN_ERRORS.invalidCredentials,
          );
        }

        if (user.mfaEnabled) {
          // Sem sessão parcial: o segundo fator é pedido no mesmo
          // formulário e reenviado junto com a senha (ver ADR-007). Um
          // "meio logado" navegável é superfície de ataque a mais.
          if (!totp) throw new SignInFailure(SIGNIN_ERRORS.mfaRequired);

          const mfaWindow = await checkRateLimit("mfa:user", user.id);
          if (!mfaWindow.allow) throw new SignInFailure(SIGNIN_ERRORS.rateLimited);

          const check = await verifySecondFactor(user.id, totp);
          if (!check.ok) {
            const state = await registerFailedLogin(user.id);
            throw new SignInFailure(
              state.locked ? SIGNIN_ERRORS.locked : SIGNIN_ERRORS.mfaInvalid,
            );
          }
          if (check.usedRecoveryCode) {
            logger.warn(
              { userId: user.id },
              "Login com código de recuperação de MFA",
            );
          }
        }

        // Credencial válida não basta: sem membership ativa não há nada a
        // acessar, e o superadmin de plataforma é a única exceção.
        const memberships = await listActiveMemberships(user.id);
        if (memberships.length === 0 && !user.isSuperadmin) {
          throw new SignInFailure(SIGNIN_ERRORS.noMembership);
        }

        await registerSuccessfulLogin(user.id);
        await Promise.all([
          resetRateLimit("login:email", email),
          resetRateLimit("mfa:user", user.id),
        ]);

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          isSuperadmin: user.isSuperadmin,
        };
      },
    }),
  ],
  callbacks: {
    /**
     * O token carrega o mínimo: identidade, tenant ativo, papel e
     * `permVersion`. A lista de permissões fica FORA — resolvida no
     * servidor por `resolvePermissions` (src/lib/rbac/guard.ts), que lê o
     * banco. Um token com permissões embutidas continuaria valendo depois
     * de o papel mudar, até expirar.
     */
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.userId = user.id as string;
        token.isSuperadmin = Boolean(
          (user as { isSuperadmin?: boolean }).isSuperadmin,
        );

        const memberships = await listActiveMemberships(token.userId);
        token.tenantCount = memberships.length;

        // Um único tenant: entra direto. Vários: o usuário escolhe em
        // /selecionar-empresa, e só então o token ganha tenant.
        const only = memberships.length === 1 ? memberships[0] : undefined;
        token.tenantId = only?.tenantId;
        token.tenantSlug = only?.tenantSlug;
        token.tenantName = only?.tenantName;
        token.roleSlug = only?.roleSlug;
        token.permVersion = only?.permVersion;
        return token;
      }

      // Troca de empresa. A membership é reconferida no banco: aceitar o
      // tenantId que veio do cliente seria trocar de empresa por vontade
      // própria.
      if (trigger === "update" && token.userId) {
        const wanted = (session as { tenantId?: unknown } | undefined)?.tenantId;
        if (typeof wanted === "string") {
          const membership = await findMembership(token.userId, wanted);
          if (membership) {
            token.tenantId = membership.tenantId;
            token.tenantSlug = membership.tenantSlug;
            token.tenantName = membership.tenantName;
            token.roleSlug = membership.roleSlug;
            token.permVersion = membership.permVersion;
          }
        }
      }

      return token;
    },

    async session({ session, token }) {
      session.user.id = token.userId ?? "";
      session.user.isSuperadmin = token.isSuperadmin ?? false;
      session.tenantId = token.tenantId;
      session.tenantSlug = token.tenantSlug;
      session.tenantName = token.tenantName;
      session.roleSlug = token.roleSlug;
      session.permVersion = token.permVersion ?? 0;
      session.tenantCount = token.tenantCount ?? 0;
      return session;
    },
  },
} satisfies NextAuthConfig;

declare module "next-auth" {
  interface Session {
    tenantId?: string;
    tenantSlug?: string;
    tenantName?: string;
    roleSlug?: RoleSlug;
    permVersion: number;
    /** Quantas empresas o usuário pode acessar — decide se há troca de empresa. */
    tenantCount: number;
    user: {
      id: string;
      isSuperadmin: boolean;
      email?: string | null;
      name?: string | null;
      image?: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    isSuperadmin?: boolean;
    tenantId?: string;
    tenantSlug?: string;
    tenantName?: string;
    roleSlug?: RoleSlug;
    permVersion?: number;
    tenantCount?: number;
  }
}
