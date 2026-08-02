import { describe, expect, it } from "vitest";
import {
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
  passwordSchema,
} from "@/lib/auth/password-policy";

const ok = (senha: string) => passwordSchema.safeParse(senha).success;

describe("política de senha", () => {
  it("aceita senha longa com variedade suficiente", () => {
    expect(ok("Tempo!Rada2026")).toBe(true);
    expect(ok("angra-DOS-reis-77")).toBe(true);
  });

  it("rejeita abaixo do mínimo, mesmo com variedade", () => {
    expect(ok("Ab1!xyz")).toBe(false);
    expect("Senha@2026".length).toBeLessThan(PASSWORD_MIN_LENGTH);
    expect(ok("Senha@2026")).toBe(false);
  });

  it("rejeita quando faltam classes de caractere", () => {
    // Longa, mas só minúsculas.
    expect(ok("abcdefghijklmnop")).toBe(false);
    // Duas classes só.
    expect(ok("abcdefghijkl1234")).toBe(false);
    // Três classes: passa.
    expect(ok("Abcdefghijkl1234")).toBe(true);
  });

  it("rejeita acima do limite de bytes do bcrypt", () => {
    const longa = `Aa1!${"x".repeat(PASSWORD_MAX_BYTES)}`;
    expect(ok(longa)).toBe(false);
  });

  it("conta bytes, não caracteres — acento ocupa 2 bytes em UTF-8", () => {
    // 40 "ç" = 80 bytes, acima do teto, apesar de só 44 caracteres.
    const acentuada = `Aa1!${"ç".repeat(40)}`;
    expect(acentuada.length).toBeLessThan(PASSWORD_MAX_BYTES);
    expect(ok(acentuada)).toBe(false);
  });

  it("devolve mensagens em pt-BR", () => {
    const result = passwordSchema.safeParse("curta");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]!.message).toMatch(/senha/i);
    }
  });
});
