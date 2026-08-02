import bcrypt from "bcryptjs";

export {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_BYTES,
  passwordSchema,
} from "./password-policy";

const BCRYPT_COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

/**
 * Compara senha com hash. Recebe `hash` nulável de propósito: usuário sem
 * senha (criado por convite ou OAuth) deve custar o mesmo tempo de um
 * usuário com senha errada, senão o tempo de resposta vira um oráculo de
 * quais e-mails existem e como foram criados.
 */
export async function verifyPassword(
  plain: string,
  hash: string | null,
): Promise<boolean> {
  if (!hash) {
    await bcrypt.compare(plain, DUMMY_HASH);
    return false;
  }
  return bcrypt.compare(plain, hash);
}

/** Hash descartável de custo 12, só para gastar o mesmo tempo de CPU. */
const DUMMY_HASH = "$2b$12$dQeMy9Z1n0eEmRfKMCLZLu2Q6MFC0.zXt3O0Ck2mHVJm8GHRkbmYy";
