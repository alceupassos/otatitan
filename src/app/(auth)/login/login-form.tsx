"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { AlertCircle } from "lucide-react";
import { loginAction, type AuthFormState } from "@/lib/auth/actions";
import { SIGNIN_ERRORS } from "@/lib/auth/errors";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";

/**
 * Mensagens por código de erro. Credencial inválida, e-mail inexistente e
 * usuário sem senha compartilham a MESMA mensagem de propósito — separá-las
 * transformaria o formulário num verificador de contas cadastradas.
 */
const MESSAGES: Record<string, string> = {
  [SIGNIN_ERRORS.invalidCredentials]: "E-mail ou senha incorretos.",
  [SIGNIN_ERRORS.mfaInvalid]: "Código de verificação inválido ou expirado.",
  [SIGNIN_ERRORS.locked]:
    "Conta temporariamente bloqueada por excesso de tentativas. Tente novamente em 15 minutos.",
  [SIGNIN_ERRORS.rateLimited]:
    "Tentativas demais em pouco tempo. Aguarde alguns minutos.",
  [SIGNIN_ERRORS.noMembership]:
    "Sua conta não está vinculada a nenhuma empresa. Fale com o administrador.",
  erro_interno: "Não foi possível entrar agora. Tente novamente.",
};

export function LoginForm({ callbackUrl }: { callbackUrl?: string }) {
  const [state, formAction, pending] = useActionState<
    AuthFormState | undefined,
    FormData
  >(loginAction, undefined);

  const needsMfa = state?.error === SIGNIN_ERRORS.mfaRequired;
  const mfaFailed = state?.error === SIGNIN_ERRORS.mfaInvalid;

  // Uma vez pedido o segundo fator, o campo continua visível mesmo que o
  // erro seguinte seja outro — reesconder apagaria o código já digitado.
  // Ajuste durante o render (e não em efeito): reagimos à mudança de
  // `state.error`, que é estado do React, não de sistema externo.
  const [showMfa, setShowMfa] = useState(false);
  const [seenError, setSeenError] = useState(state?.error);
  if (state?.error !== seenError) {
    setSeenError(state?.error);
    if (needsMfa || mfaFailed) setShowMfa(true);
  }

  const message = state?.error && !needsMfa ? MESSAGES[state.error] : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Entrar</CardTitle>
        <CardDescription>
          {showMfa
            ? "Informe o código do seu aplicativo autenticador."
            : "Acesse com seu e-mail e senha."}
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form action={formAction} className="space-y-4">
          {callbackUrl && (
            <input type="hidden" name="callbackUrl" value={callbackUrl} />
          )}

          {message && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          )}

          {needsMfa && (
            <Alert>
              <AlertCircle />
              <AlertDescription>
                Esta conta usa verificação em duas etapas.
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              autoFocus={!showMfa}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Senha</Label>
              <Link
                href="/esqueci-senha"
                className="text-xs text-muted-foreground underline-offset-4 hover:underline"
              >
                Esqueci minha senha
              </Link>
            </div>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>

          {showMfa && (
            <div className="space-y-2">
              <Label htmlFor="totp">Código de verificação</Label>
              <Input
                id="totp"
                name="totp"
                autoFocus
                inputMode="text"
                autoComplete="one-time-code"
                placeholder="000000"
                aria-describedby="totp-ajuda"
              />
              <p id="totp-ajuda" className="text-xs text-muted-foreground">
                6 dígitos do aplicativo, ou um código de recuperação.
              </p>
            </div>
          )}

          <Button type="submit" className="w-full" disabled={pending}>
            {pending && <Spinner />}
            Entrar
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
