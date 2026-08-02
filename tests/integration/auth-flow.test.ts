import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { basePrisma } from "@/lib/db/client";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  LOCKOUT_MINUTES,
  MAX_FAILED_LOGINS,
  lockStateOf,
  registerFailedLogin,
  registerSuccessfulLogin,
} from "@/lib/auth/lockout";
import { listActiveMemberships } from "@/lib/auth/memberships";
import {
  confirmMfaEnrollment,
  disableMfa,
  startMfaEnrollment,
  verifySecondFactor,
  verifyTotp,
} from "@/lib/auth/mfa";
import { hashToken } from "@/lib/auth/crypto";
import { withTenant } from "@/lib/db/with-tenant";
import { createTestTenant, cleanupTenants } from "../helpers/db";

/**
 * Fluxo de autenticação contra o banco real. Cobre o que o teste unitário
 * não alcança: bloqueio por conta, MFA com consumo de código de
 * recuperação, e a resolução de memberships (que roda pelo cliente de
 * plataforma, por rodar antes de existir tenant ativo).
 */
const SENHA = "Angra-Temporada-2026";

describe("fluxo de autenticação", () => {
  let tenantA: { id: string };
  let tenantB: { id: string };
  let userId: string;
  const email = `teste-${randomUUID().slice(0, 8)}@otatitan.test`;

  beforeAll(async () => {
    tenantA = await createTestTenant("auth-a");
    tenantB = await createTestTenant("auth-b");

    const user = await basePrisma.user.create({
      data: {
        email,
        name: "Usuária de Teste",
        passwordHash: await hashPassword(SENHA),
        emailVerified: new Date(),
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    // Apagar o usuário leva as memberships junto (FK ON DELETE CASCADE) —
    // um deleteMany aqui esbarraria no RLS, por falta de contexto.
    await basePrisma.user.delete({ where: { id: userId } });
    await cleanupTenants([tenantA.id, tenantB.id]);
    await basePrisma.$disconnect();
  });

  describe("senha", () => {
    it("aceita a senha correta e recusa a errada", async () => {
      const user = await basePrisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { passwordHash: true },
      });
      expect(await verifyPassword(SENHA, user.passwordHash)).toBe(true);
      expect(await verifyPassword("outra-coisa-qualquer", user.passwordHash)).toBe(
        false,
      );
    });

    it("usuário sem senha recusa qualquer entrada, sem lançar", async () => {
      expect(await verifyPassword(SENHA, null)).toBe(false);
    });
  });

  describe("bloqueio por conta", () => {
    it(`trava após ${MAX_FAILED_LOGINS} falhas e destrava com sucesso`, async () => {
      let state = { locked: false, retryAfterSeconds: 0 };
      for (let i = 0; i < MAX_FAILED_LOGINS; i++) {
        state = await registerFailedLogin(userId);
      }

      expect(state.locked).toBe(true);
      expect(state.retryAfterSeconds).toBe(LOCKOUT_MINUTES * 60);

      const locked = await basePrisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { lockedUntil: true, failedLoginCount: true },
      });
      expect(lockStateOf(locked).locked).toBe(true);
      // O contador zera junto com a trava: senão, a primeira falha depois
      // dos 15 minutos travaria a conta de novo na hora.
      expect(locked.failedLoginCount).toBe(0);

      await registerSuccessfulLogin(userId);
      const after = await basePrisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { lockedUntil: true, failedLoginCount: true, lastLoginAt: true },
      });
      expect(lockStateOf(after).locked).toBe(false);
      expect(after.failedLoginCount).toBe(0);
      expect(after.lastLoginAt).not.toBeNull();
    });

    it("trava expirada não bloqueia mais", () => {
      expect(
        lockStateOf({ lockedUntil: new Date(Date.now() - 1000) }).locked,
      ).toBe(false);
    });
  });

  describe("MFA (TOTP)", () => {
    it("só ativa depois de o usuário confirmar um código válido", async () => {
      const enrollment = startMfaEnrollment(email);
      expect(enrollment.otpauthUri).toContain("otpauth://totp/");
      expect(enrollment.recoveryCodes).toHaveLength(10);

      // Código errado não ativa nada.
      expect(
        await confirmMfaEnrollment(userId, email, enrollment, "000000"),
      ).toBe(false);
      const notEnabled = await basePrisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { mfaEnabled: true, mfaSecretEnc: true },
      });
      expect(notEnabled.mfaEnabled).toBe(false);
      expect(notEnabled.mfaSecretEnc).toBeNull();
    });

    it("ativa, valida TOTP e guarda o segredo cifrado", async () => {
      const enrollment = startMfaEnrollment(email);
      const { TOTP, Secret } = await import("otpauth");
      const code = new TOTP({
        issuer: process.env.MFA_ISSUER ?? "Otatitan",
        label: email,
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        secret: Secret.fromBase32(enrollment.secretBase32),
      }).generate();

      expect(verifyTotp(enrollment.secretBase32, code, email)).toBe(true);
      expect(await confirmMfaEnrollment(userId, email, enrollment, code)).toBe(
        true,
      );

      const stored = await basePrisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { mfaEnabled: true, mfaSecretEnc: true },
      });
      expect(stored.mfaEnabled).toBe(true);
      // O segredo nunca fica em claro no banco.
      expect(stored.mfaSecretEnc).not.toContain(enrollment.secretBase32);
      expect(stored.mfaSecretEnc).toMatch(/^v1\./);

      expect(await verifySecondFactor(userId, code)).toEqual({
        ok: true,
        usedRecoveryCode: false,
      });
      expect((await verifySecondFactor(userId, "123456")).ok).toBe(false);
    });

    it("consome o código de recuperação — não serve duas vezes", async () => {
      const enrollment = startMfaEnrollment(email);
      const { TOTP, Secret } = await import("otpauth");
      const code = new TOTP({
        issuer: process.env.MFA_ISSUER ?? "Otatitan",
        label: email,
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        secret: Secret.fromBase32(enrollment.secretBase32),
      }).generate();
      await confirmMfaEnrollment(userId, email, enrollment, code);

      const recovery = enrollment.recoveryCodes[0]!;

      // Guardado como hash, nunca em claro.
      const row = await basePrisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { mfaRecoveryCodesEnc: true },
      });
      expect(row.mfaRecoveryCodesEnc).not.toContain(recovery);
      expect(hashToken(recovery)).toBeTruthy();

      const first = await verifySecondFactor(userId, recovery);
      expect(first).toEqual({ ok: true, usedRecoveryCode: true });

      const second = await verifySecondFactor(userId, recovery);
      expect(second.ok).toBe(false);
    });

    it("desativar limpa segredo e códigos", async () => {
      await disableMfa(userId);
      const row = await basePrisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          mfaEnabled: true,
          mfaSecretEnc: true,
          mfaRecoveryCodesEnc: true,
        },
      });
      expect(row.mfaEnabled).toBe(false);
      expect(row.mfaSecretEnc).toBeNull();
      expect(row.mfaRecoveryCodesEnc).toBeNull();
      expect((await verifySecondFactor(userId, "qualquer")).ok).toBe(false);
    });
  });

  describe("memberships", () => {
    it("lista só as ativas, e enxerga vários tenants do mesmo usuário", async () => {
      const roleA = await basePrisma.role.findFirstOrThrow({
        where: { tenantId: null, slug: "company_admin" },
      });

      // Membership é tenant-scoped: criar pelo cliente de aplicação exige
      // contexto de tenant. Sem `withTenant`, o RLS nega o INSERT (42501)
      // — que é exatamente o comportamento desejado.
      await withTenant({ tenantId: tenantA.id }, (tx) =>
        tx.membership.create({
          data: { userId, roleId: roleA.id, status: "ACTIVE" },
        }),
      );
      await withTenant({ tenantId: tenantB.id }, (tx) =>
        tx.membership.create({
          data: { userId, roleId: roleA.id, status: "INVITED" },
        }),
      );

      const active = await listActiveMemberships(userId);
      const ids = active.map((m) => m.tenantId);

      expect(ids).toContain(tenantA.id);
      // Convite pendente não dá acesso.
      expect(ids).not.toContain(tenantB.id);
      expect(active[0]!.roleSlug).toBe("company_admin");
      expect(active[0]!.permVersion).toBeGreaterThanOrEqual(1);
    });

    it("usuário sem membership devolve lista vazia", async () => {
      const orphan = await basePrisma.user.create({
        data: { email: `orfa-${randomUUID().slice(0, 8)}@otatitan.test`, name: "Órfã" },
      });
      expect(await listActiveMemberships(orphan.id)).toEqual([]);
      await basePrisma.user.delete({ where: { id: orphan.id } });
    });
  });
});
