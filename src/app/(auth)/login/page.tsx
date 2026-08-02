import type { Metadata } from "next";
import { LoginForm } from "./login-form";

// O sufixo "— Otatitan" vem do `title.template` do layout raiz.
export const metadata: Metadata = {
  title: "Entrar",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const params = await searchParams;
  return <LoginForm callbackUrl={params.callbackUrl} />;
}
