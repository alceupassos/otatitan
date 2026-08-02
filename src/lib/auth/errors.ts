/**
 * Códigos de erro de login. Módulo deliberadamente puro (sem Prisma, sem
 * Redis, sem `server-only`): o formulário de login é um client component e
 * precisa destes códigos para escolher a mensagem. Importar de `config.ts`
 * arrastaria a configuração inteira do Auth.js — e o cliente do banco —
 * para o bundle do navegador.
 *
 * Os valores aparecem na URL de erro, então nenhum deles pode distinguir
 * "e-mail não existe" de "senha errada".
 */
export const SIGNIN_ERRORS = {
  invalidCredentials: "credenciais_invalidas",
  mfaRequired: "mfa_obrigatorio",
  mfaInvalid: "mfa_invalido",
  locked: "conta_bloqueada",
  rateLimited: "muitas_tentativas",
  noMembership: "sem_acesso",
} as const;

export type SignInErrorCode = (typeof SIGNIN_ERRORS)[keyof typeof SIGNIN_ERRORS];
