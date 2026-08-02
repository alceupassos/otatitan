import "server-only";
import { createTransport, type Transporter } from "nodemailer";
import { logger } from "@/lib/logging/logger";

/**
 * Envio de e-mail transacional. Em dev aponta para o Mailpit do
 * docker-compose (SMTP_URL=smtp://localhost:1025), que captura tudo sem
 * mandar nada para fora.
 *
 * Falha de envio nunca derruba a operação que a originou: um erro de SMTP
 * no reset de senha não pode virar erro 500 no formulário, porque isso
 * revelaria que o e-mail existe (o caminho "e-mail inexistente" não envia
 * nada e sempre responde com sucesso).
 */
let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;
  transporter = createTransport(process.env.SMTP_URL ?? "smtp://localhost:1025");
  return transporter;
}

type SendInput = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

async function send({ to, subject, text, html }: SendInput): Promise<void> {
  try {
    await getTransporter().sendMail({
      from: process.env.MAIL_FROM ?? "Otatitan <nao-responda@otatitan.local>",
      to,
      subject,
      text,
      html,
    });
  } catch (err) {
    // Sem `to` no log: o logger já redige `email`, mas o destinatário aqui
    // é justamente o dado que não deve vazar em trilha de erro.
    logger.error({ subject, err: (err as Error).message }, "Falha ao enviar e-mail");
  }
}

function appUrl(path: string): string {
  const base = process.env.APP_URL ?? "http://localhost:3040";
  return new URL(path, base).toString();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendPasswordResetEmail(input: {
  to: string;
  name: string;
  token: string;
  ttlMinutes: number;
}): Promise<void> {
  // O token vai na URL, não no corpo: assim ele não sobra no histórico de
  // cópia/colagem do usuário nem em prints do e-mail.
  const link = appUrl(
    `/redefinir-senha?token=${encodeURIComponent(input.token)}`,
  );
  const nome = escapeHtml(input.name);

  await send({
    to: input.to,
    subject: "Redefinição de senha — Otatitan",
    text: [
      `Olá, ${input.name}.`,
      "",
      "Recebemos um pedido para redefinir a senha da sua conta no Otatitan.",
      `Abra o link abaixo (válido por ${input.ttlMinutes} minutos):`,
      "",
      link,
      "",
      "Se não foi você quem pediu, ignore este e-mail — sua senha continua a mesma.",
    ].join("\n"),
    html: `
      <p>Olá, ${nome}.</p>
      <p>Recebemos um pedido para redefinir a senha da sua conta no Otatitan.</p>
      <p><a href="${link}">Redefinir minha senha</a></p>
      <p>O link vale por ${input.ttlMinutes} minutos.</p>
      <p>Se não foi você quem pediu, ignore este e-mail — sua senha continua a mesma.</p>
    `,
  });
}
