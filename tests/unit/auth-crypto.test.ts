import { beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";

/**
 * A chave é definida antes de importar o módulo porque `getKey()` só lê o
 * ambiente na primeira chamada — e o `.env` de dev tem uma chave que não é
 * base64 de 32 bytes de propósito (é um placeholder mandando trocar).
 */
beforeAll(() => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

const crypto = await import("@/lib/auth/crypto");

describe("cifragem de segredos (AES-256-GCM)", () => {
  it("decifra de volta ao texto original", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    expect(crypto.decryptSecret(crypto.encryptSecret(secret))).toBe(secret);
  });

  it("gera saída diferente a cada chamada (IV aleatório)", () => {
    const a = crypto.encryptSecret("mesmo-segredo");
    const b = crypto.encryptSecret("mesmo-segredo");
    expect(a).not.toBe(b);
    expect(crypto.decryptSecret(a)).toBe(crypto.decryptSecret(b));
  });

  it("recusa payload adulterado — a tag GCM autentica", () => {
    const payload = crypto.encryptSecret("segredo-mfa");
    const [v, iv, tag, data] = payload.split(".");
    // Vira um bit do ciphertext.
    const corrupted = Buffer.from(data!, "base64url");
    corrupted[0] ^= 0x01;
    const tampered = [v, iv, tag, corrupted.toString("base64url")].join(".");

    expect(() => crypto.decryptSecret(tampered)).toThrow();
  });

  it("recusa formato de versão desconhecida", () => {
    expect(() => crypto.decryptSecret("v9.a.b.c")).toThrow(
      /formato desconhecido/i,
    );
  });

  it("preserva acentuação (UTF-8)", () => {
    const texto = "acentuação, ç e emoji 🔐";
    expect(crypto.decryptSecret(crypto.encryptSecret(texto))).toBe(texto);
  });
});

describe("hash de token", () => {
  it("é determinístico — serve de chave de busca", () => {
    expect(crypto.hashToken("abc")).toBe(crypto.hashToken("abc"));
  });

  it("muda completamente com a entrada", () => {
    expect(crypto.hashToken("abc")).not.toBe(crypto.hashToken("abd"));
  });

  it("gera tokens únicos e com entropia suficiente", () => {
    const tokens = Array.from({ length: 200 }, () => crypto.generateToken());
    expect(new Set(tokens).size).toBe(tokens.length);
    // 32 bytes em base64url ≈ 43 caracteres.
    expect(tokens[0]!.length).toBeGreaterThanOrEqual(43);
  });
});

describe("comparação em tempo constante", () => {
  it("compara iguais e diferentes sem lançar em tamanhos distintos", () => {
    expect(crypto.safeEqual("abc", "abc")).toBe(true);
    expect(crypto.safeEqual("abc", "abd")).toBe(false);
    expect(crypto.safeEqual("abc", "abcdef")).toBe(false);
  });
});
