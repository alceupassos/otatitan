import { z } from "zod";

/**
 * Política de senha (docs/11-seguranca-lgpd.md): mínimo 12 caracteres.
 *
 * Módulo puro, sem bcrypt: o formulário de redefinição é um client
 * component e precisa do mínimo e das mensagens. Deixar isso junto do
 * hashing arrastaria bcrypt para o bundle do navegador.
 *
 * Comprimento é o requisito duro; as classes de caractere entram como
 * exigência de variedade (3 de 4) em vez de "obrigatório um de cada" —
 * regras rígidas demais empurram o usuário para "Senha@2026", que é pior
 * do que uma frase longa. O teto de 72 bytes não é escolha nossa: é o
 * limite do bcrypt, que trunca silenciosamente acima disso.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_BYTES = 72;

function countClasses(value: string): number {
  return [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) =>
    re.test(value),
  ).length;
}

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, {
    error: `A senha precisa ter ao menos ${PASSWORD_MIN_LENGTH} caracteres.`,
  })
  .refine(
    (v) => new TextEncoder().encode(v).length <= PASSWORD_MAX_BYTES,
    { error: "A senha é longa demais (máximo de 72 bytes)." },
  )
  .refine((v) => countClasses(v) >= 3, {
    error:
      "Use ao menos três tipos de caractere: minúsculas, maiúsculas, números ou símbolos.",
  });
