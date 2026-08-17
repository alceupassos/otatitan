import type { Metadata } from "next";
import { MadreHome, madreMetadata } from "@/components/direct-booking/madre-home";

export async function generateMetadata(): Promise<Metadata> {
  return madreMetadata();
}

/**
 * Preview do canal direto em qualquer host (`/stays/madre-914`), inclusive
 * no painel. Rota estática de propósito: `/stays/pagamento` (retorno do
 * checkout) continua no grupo `(public)` e não pode ser engolida por um
 * `[slug]`. No host madre914.com.br a home `/` é a mesma página.
 */
export default function StayPublicaPage() {
  return <MadreHome homePath="/stays/madre-914" />;
}
