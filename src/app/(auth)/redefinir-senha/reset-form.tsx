"use client";

import Link from "next/link";
import { useActionState } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { resetPasswordAction, type AuthFormState } from "@/lib/auth/actions";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password-policy";
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

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState<
    AuthFormState | undefined,
    FormData
  >(resetPasswordAction, undefined);

  if (state?.done) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Senha alterada</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <CheckCircle2 />
            <AlertDescription>
              Sua senha foi redefinida. Já pode entrar com ela.
            </AlertDescription>
          </Alert>
          <Button asChild className="w-full">
            <Link href="/login">Ir para o login</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const invalidToken = state?.error === "token_invalido";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Criar nova senha</CardTitle>
        <CardDescription>
          Use ao menos {PASSWORD_MIN_LENGTH} caracteres, misturando pelo menos
          três tipos: minúsculas, maiúsculas, números ou símbolos.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="token" value={token} />

          {invalidToken && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>
                Este link expirou ou já foi usado.{" "}
                <Link href="/esqueci-senha" className="underline">
                  Peça um novo
                </Link>
                .
              </AlertDescription>
            </Alert>
          )}

          {state?.issues && state.issues.length > 0 && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>
                <ul className="list-inside list-disc">
                  {state.issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="password">Nova senha</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              required
              autoFocus
            />
          </div>

          <Button type="submit" className="w-full" disabled={pending}>
            {pending && <Spinner />}
            Salvar nova senha
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
