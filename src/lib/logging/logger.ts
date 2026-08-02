import pino from "pino";

/**
 * Caminhos redigidos nos logs (docs/11-seguranca-lgpd.md).
 *
 * Vale mais listar demais do que de menos: um caminho que não existe no
 * objeto logado é ignorado sem custo, enquanto um PII vazado em log é
 * incidente de LGPD. Cobre tanto o objeto na raiz quanto aninhado em
 * `*.body`, `*.data` e `*.guest`, que são as formas comuns aqui.
 */
const SENSITIVE_KEYS = [
  "password",
  "passwordHash",
  "senha",
  "token",
  "accessToken",
  "refreshToken",
  "authorization",
  "cookie",
  "secret",
  "apiKey",
  "mfaSecretEnc",
  "mfaRecoveryCodesEnc",
  "tokenHash",
  "documentNumberEnc",
  "documentNumber",
  "cpf",
  "taxId",
  "taxIdEnc",
  "email",
  "phone",
  "cardNumber",
  "cvv",
];

const PREFIXES = ["", "body.", "data.", "guest.", "user.", "req.headers."];

const redactPaths = PREFIXES.flatMap((prefix) =>
  SENSITIVE_KEYS.map((key) => `${prefix}${key}`),
);

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: redactPaths,
    censor: "[REDIGIDO]",
  },
  transport:
    process.env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:HH:MM:ss" } }
      : undefined,
});

export type Logger = typeof logger;
