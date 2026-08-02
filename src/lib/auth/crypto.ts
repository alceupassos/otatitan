import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Cifragem simétrica para segredos em repouso — hoje só o segredo TOTP e
 * os códigos de recuperação (`User.mfaSecretEnc`, `mfaRecoveryCodesEnc`).
 *
 * AES-256-GCM: além de cifrar, autentica. Um `mfaSecretEnc` adulterado no
 * banco falha a verificação da tag em vez de decifrar para lixo silencioso.
 * Formato armazenado: `v1.<iv>.<tag>.<ciphertext>`, tudo em base64url. O
 * prefixo de versão existe para permitir rotação de chave depois sem ter
 * que adivinhar o formato de cada linha.
 */
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // recomendado para GCM
const KEY_BYTES = 32;
const VERSION = "v1";

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "ENCRYPTION_KEY não definida — necessária para cifrar segredos de MFA.",
    );
  }

  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `ENCRYPTION_KEY deve ser 32 bytes em base64 (recebido: ${key.length}). ` +
        `Gere uma com: openssl rand -base64 32`,
    );
  }

  cachedKey = key;
  return key;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptSecret(payload: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split(".");
  if (version !== VERSION || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("Segredo cifrado em formato desconhecido.");
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    getKey(),
    Buffer.from(ivB64, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Hash de token de uso único (reset de senha, código de recuperação).
 *
 * SHA-256 sem salt de propósito, ao contrário de senha: o token é gerado
 * por nós com 32 bytes de entropia, então não há dicionário a atacar, e o
 * hash precisa ser determinístico para servir de chave de busca
 * (`PasswordResetToken.tokenHash` é UNIQUE).
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Comparação em tempo constante entre dois valores já hasheados. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
