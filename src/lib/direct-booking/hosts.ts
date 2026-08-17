/**
 * Hosts do canal direto (madre914.com.br) vs painel (otatitan.*).
 *
 * A hipótese confirmada na investigação: o site ao vivo NÃO era este
 * repositório (health e Permissions-Policy diferentes). A partir desta
 * entrega, o mesmo app atende os dois nomes — o proxy decide o que é
 * público pela Host.
 */

const DEFAULT_HOSTS = ["www.madre914.com.br", "madre914.com.br"];

export function directBookingHosts(): string[] {
  const fromEnv = process.env.DIRECT_BOOKING_HOSTS?.trim();
  const lista = fromEnv
    ? fromEnv.split(",").map((h) => h.trim()).filter(Boolean)
    : DEFAULT_HOSTS;
  return lista.map(normalizarHost);
}

export function normalizarHost(host: string | null | undefined): string {
  return (host ?? "").split(":")[0]!.trim().toLowerCase();
}

export function isDirectBookingHost(host: string | null | undefined): boolean {
  const h = normalizarHost(host);
  if (!h) return false;
  return directBookingHosts().includes(h);
}

/** Prefixos públicos só no host do canal direto (além de PUBLIC_PREFIXES). */
export const DIRECT_HOST_PUBLIC_PREFIXES = ["/", "/politicas"] as const;
