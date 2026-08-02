import { basePrisma } from "@/lib/db/client";

/**
 * Health check para o healthcheck do container e para o proxy reverso.
 *
 * Verifica o banco de verdade (um `SELECT 1`), não só se o processo
 * respondeu: um app de pé que perdeu o Postgres não está saudável, e o
 * orquestrador precisa saber disso para não mandar tráfego.
 *
 * O Redis fica de fora de propósito — cache indisponível degrada
 * performance, não corretude (ver src/lib/cache/redis.ts), então não deve
 * tirar a instância de rotação.
 *
 * Rota pública (docs/06-mapa-navegacao.md), por isso não devolve nada
 * além de estado: nem versão, nem detalhe de erro, que seriam
 * reconhecimento gratuito para quem estiver varrendo.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await basePrisma.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok" });
  } catch {
    return Response.json({ status: "degraded" }, { status: 503 });
  }
}
