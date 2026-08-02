import { Secret, TOTP } from "otpauth";
import { basePrisma } from "@/lib/db/client";
import {
  decryptSecret,
  encryptSecret,
  generateToken,
  hashToken,
  safeEqual,
} from "./crypto";

/**
 * Segundo fator TOTP, opcional por usuário (docs/11-seguranca-lgpd.md).
 *
 * O segredo nunca fica em claro no banco: `User.mfaSecretEnc` guarda o
 * segredo cifrado com AES-256-GCM. Os 10 códigos de recuperação são
 * hasheados (SHA-256), como senha de uso único — o texto em claro é
 * mostrado uma única vez, na hora do cadastro.
 */
const DIGITS = 6;
const PERIOD = 30;
const ALGORITHM = "SHA1"; // o que Google Authenticator/Authy suportam
export const RECOVERY_CODE_COUNT = 10;

/**
 * Aceita o código do passo anterior e do próximo (janela = 1), porque
 * relógio de celular derrapa alguns segundos. Janela maior do que isso
 * amplia demais a superfície de força bruta.
 */
const VALIDATION_WINDOW = 1;

function totpFor(secretBase32: string, label: string): TOTP {
  return new TOTP({
    issuer: process.env.MFA_ISSUER ?? "Otatitan",
    label,
    algorithm: ALGORITHM,
    digits: DIGITS,
    period: PERIOD,
    secret: Secret.fromBase32(secretBase32),
  });
}

export type MfaEnrollment = {
  secretBase32: string;
  /** URI `otpauth://` para o QR code. */
  otpauthUri: string;
  /** Códigos em claro — exibidos uma única vez ao usuário. */
  recoveryCodes: string[];
};

/**
 * Gera segredo e códigos de recuperação, mas NÃO ativa o MFA: a ativação
 * só acontece em `confirmMfaEnrollment`, depois que o usuário provar que
 * conseguiu ler o QR code. Ativar antes trancaria fora da conta quem
 * fechasse a tela no meio do cadastro.
 */
export function startMfaEnrollment(email: string): MfaEnrollment {
  const secret = new Secret({ size: 20 });
  const totp = totpFor(secret.base32, email);

  return {
    secretBase32: secret.base32,
    otpauthUri: totp.toString(),
    recoveryCodes: Array.from({ length: RECOVERY_CODE_COUNT }, () =>
      formatRecoveryCode(generateToken(6)),
    ),
  };
}

/** `XXXX-XXXX-XXXX`, em maiúsculas, fácil de ditar por telefone. */
function formatRecoveryCode(raw: string): string {
  const clean = raw.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 12);
  return clean.match(/.{1,4}/g)!.join("-");
}

export function verifyTotp(
  secretBase32: string,
  token: string,
  email: string,
): boolean {
  const delta = totpFor(secretBase32, email).validate({
    token: token.replace(/\s/g, ""),
    window: VALIDATION_WINDOW,
  });
  return delta !== null;
}

/** Ativa o MFA após o usuário confirmar um código válido do app. */
export async function confirmMfaEnrollment(
  userId: string,
  email: string,
  enrollment: MfaEnrollment,
  token: string,
): Promise<boolean> {
  if (!verifyTotp(enrollment.secretBase32, token, email)) return false;

  await basePrisma.user.update({
    where: { id: userId },
    data: {
      mfaEnabled: true,
      mfaSecretEnc: encryptSecret(enrollment.secretBase32),
      mfaRecoveryCodesEnc: encryptSecret(
        JSON.stringify(enrollment.recoveryCodes.map(hashToken)),
      ),
      mfaEnrolledAt: new Date(),
    },
  });
  return true;
}

export type MfaCheck = { ok: boolean; usedRecoveryCode: boolean };

/**
 * Valida o segundo fator no login: primeiro como TOTP, depois como código
 * de recuperação. Um código de recuperação é consumido no uso — a lista
 * cifrada é regravada sem ele.
 */
export async function verifySecondFactor(
  userId: string,
  code: string,
): Promise<MfaCheck> {
  const user = await basePrisma.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      mfaEnabled: true,
      mfaSecretEnc: true,
      mfaRecoveryCodesEnc: true,
    },
  });

  if (!user?.mfaEnabled || !user.mfaSecretEnc) {
    return { ok: false, usedRecoveryCode: false };
  }

  const secret = decryptSecret(user.mfaSecretEnc);
  if (verifyTotp(secret, code, user.email)) {
    return { ok: true, usedRecoveryCode: false };
  }

  if (!user.mfaRecoveryCodesEnc) return { ok: false, usedRecoveryCode: false };

  const hashes = JSON.parse(decryptSecret(user.mfaRecoveryCodesEnc)) as string[];
  const candidate = hashToken(code.trim().toUpperCase());
  const match = hashes.find((h) => safeEqual(h, candidate));
  if (!match) return { ok: false, usedRecoveryCode: false };

  await basePrisma.user.update({
    where: { id: userId },
    data: {
      mfaRecoveryCodesEnc: encryptSecret(
        JSON.stringify(hashes.filter((h) => h !== match)),
      ),
    },
  });

  return { ok: true, usedRecoveryCode: true };
}

export async function disableMfa(userId: string): Promise<void> {
  await basePrisma.user.update({
    where: { id: userId },
    data: {
      mfaEnabled: false,
      mfaSecretEnc: null,
      mfaRecoveryCodesEnc: null,
      mfaEnrolledAt: null,
    },
  });
}
