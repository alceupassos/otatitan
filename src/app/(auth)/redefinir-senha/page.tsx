import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "./reset-form";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Redefinir senha",
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  // Sem validar o token no servidor aqui de propósito: uma tela que
  // dissesse "token inválido" antes do envio permitiria testar tokens em
  // lote via GET. A validação acontece no POST, junto com a troca.
  if (!token) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Link inválido</CardTitle>
          <CardDescription>
            Este link de redefinição está incompleto ou expirou.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link href="/esqueci-senha">Pedir um novo link</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return <ResetPasswordForm token={token} />;
}
