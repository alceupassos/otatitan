"use client";

import Link from "next/link";
import { useActionState } from "react";
import { CheckCircle2 } from "lucide-react";
import { requestPasswordResetAction, type AuthFormState } from "@/lib/auth/actions";
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

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState<
    AuthFormState | undefined,
    FormData
  >(requestPasswordResetAction, undefined);

  // A confirmação é a mesma exista o e-mail ou não — a action nunca diz
  // qual foi o caso, e a tela não pode desmentir isso.
  if (state?.done) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Verifique seu e-mail</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <CheckCircle2 />
            <AlertDescription>
              Se houver uma conta com esse e-mail, enviamos um link para
              redefinir a senha. O link vale por 30 minutos.
            </AlertDescription>
          </Alert>
          <Button asChild variant="outline" className="w-full">
            <Link href="/login">Voltar para o login</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Esqueci minha senha</CardTitle>
        <CardDescription>
          Informe seu e-mail e enviaremos um link para criar uma nova senha.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              autoFocus
            />
          </div>

          <Button type="submit" className="w-full" disabled={pending}>
            {pending && <Spinner />}
            Enviar link
          </Button>

          <Button asChild variant="ghost" className="w-full">
            <Link href="/login">Voltar</Link>
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
