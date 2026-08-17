"use server";

import { headers } from "next/headers";
import { inicioDoMes, inicioDoMesSeguinte } from "@/lib/dates";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { CanalDiretoNaoConfigurado } from "./tenant";
import { calendarioPublico, buscarDisponibilidadePublica } from "./search";
import { reservarNoCanalDireto } from "./reservar";
import {
  calendarioPublicoSchema,
  consultaPublicaSchema,
  reservaPublicaSchema,
} from "./schemas";
import { PrecoMudou, UnidadeIndisponivel, UnidadeNaoVendavel } from "@/lib/reservations/errors";
import { MADRE914 } from "./config";

async function ipDoPedido(): Promise<string> {
  const h = await headers();
  if (process.env.TRUSTED_PROXY === "true") {
    const forwarded = h.get("x-forwarded-for");
    if (forwarded) return forwarded.split(",")[0]!.trim();
  }
  return h.get("x-real-ip") ?? "desconhecido";
}

function jsonCotacao<T>(valor: T): T {
  return JSON.parse(JSON.stringify(valor)) as T;
}

export async function consultarCalendarioPublicoAction(mesIso: string) {
  const parsed = calendarioPublicoSchema.safeParse({ mes: mesIso });
  if (!parsed.success) {
    return { ok: false as const, erro: "Mês inválido." };
  }
  const inicio = inicioDoMes(parsed.data.mes);
  const ate = inicioDoMesSeguinte(inicioDoMesSeguinte(inicio));
  try {
    const dias = await calendarioPublico(inicio, ate);
    return { ok: true as const, dias };
  } catch (err) {
    if (err instanceof CanalDiretoNaoConfigurado) {
      return { ok: false as const, erro: "config" as const };
    }
    throw err;
  }
}

export async function consultarDisponibilidadePublicaAction(entrada: unknown) {
  const ip = await ipDoPedido();
  const rl = await checkRateLimit("direct:search:ip", ip);
  if (!rl.allow) {
    return { ok: false as const, erro: "Muitas consultas. Espere um instante." };
  }

  const parsed = consultaPublicaSchema.safeParse(entrada);
  if (!parsed.success) {
    return {
      ok: false as const,
      erro: parsed.error.issues[0]?.message ?? "Dados inválidos.",
    };
  }
  const { checkIn, checkOut, adults, children, pets, parking } = parsed.data;
  const nights = Math.round((checkOut.getTime() - checkIn.getTime()) / 86_400_000);
  if (nights < MADRE914.minNights) {
    return {
      ok: false as const,
      erro: `Estadia mínima de ${MADRE914.minNights} noites.`,
    };
  }
  if (nights > MADRE914.maxNights) {
    return {
      ok: false as const,
      erro: `Estadia máxima de ${MADRE914.maxNights} noites.`,
    };
  }

  try {
    const resultado = await buscarDisponibilidadePublica({
      checkIn,
      checkOut,
      hospedes: adults + children,
      pets,
      parking,
    });
    return { ok: true as const, resultado: jsonCotacao(resultado) };
  } catch (err) {
    if (err instanceof CanalDiretoNaoConfigurado) {
      return { ok: false as const, erro: "config" as const };
    }
    throw err;
  }
}

export async function reservarPublicoAction(entrada: unknown) {
  const ip = await ipDoPedido();
  const rl = await checkRateLimit("direct:book:ip", ip);
  if (!rl.allow) {
    return { ok: false as const, erro: "Muitas tentativas. Espere um pouco." };
  }

  const parsed = reservaPublicaSchema.safeParse(entrada);
  if (!parsed.success) {
    return {
      ok: false as const,
      erro: parsed.error.issues[0]?.message ?? "Confira os dados do cadastro.",
    };
  }

  try {
    const criada = await reservarNoCanalDireto(parsed.data);
    return { ok: true as const, criada: jsonCotacao(criada) };
  } catch (err) {
    if (err instanceof CanalDiretoNaoConfigurado) {
      return { ok: false as const, erro: "config" as const };
    }
    if (err instanceof PrecoMudou) {
      return {
        ok: false as const,
        erro: "O valor mudou. Consulte as datas de novo para ver a cotação atual.",
        codigo: "PRICE_CHANGED" as const,
      };
    }
    if (err instanceof UnidadeIndisponivel) {
      return {
        ok: false as const,
        erro: "Essas datas acabaram de ser reservadas. Escolha outras.",
        codigo: "UNAVAILABLE" as const,
      };
    }
    if (err instanceof UnidadeNaoVendavel) {
      return {
        ok: false as const,
        erro: err.message || "Esta unidade não pode ser vendida nestas datas.",
      };
    }
    const msg = err instanceof Error ? err.message : "Não foi possível concluir a reserva.";
    return { ok: false as const, erro: msg };
  }
}
