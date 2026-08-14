import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { withTenant } from "@/lib/db/with-tenant";
import type { ActorContext } from "@/lib/rbac/guard";
import { LIMITE_BUSCA_MAXIMO, LIMITE_BUSCA_PADRAO, nomeCompleto } from "./schemas";

/**
 * Leituras de hóspedes.
 *
 * Diferente de imóveis e reservas, aqui não entra `scopeFor`: `Guest` não é
 * um modelo com escopo por linha, e os papéis auto-escopados (proprietário,
 * hóspede, equipe de campo) simplesmente não têm `guests.view`
 * (docs/07-matriz-permissoes.md). A separação que importa é a de empresa,
 * garantida pelo `withTenant` (RLS). O chamador é quem resolve o ator com
 * `requireActorWith("guests.view")` antes de chegar aqui.
 *
 * Nenhuma consulta devolve `documentNumberEnc`: o texto cifrado não tem uso
 * na interface, e carregá-lo só aumentaria a superfície de exposição
 * (docs/11-seguranca-lgpd.md). O que a tela mostra é `documentLast4`.
 */

export type HospedeResumo = {
  id: string;
  firstName: string;
  lastName: string;
  /** Pronto para exibição no autocomplete. */
  nome: string;
  email: string | null;
  phone: string | null;
  documentType: "CPF" | "PASSPORT" | "RG" | "OTHER" | null;
  documentLast4: string | null;
  country: string;
};

const CAMPOS_RESUMO = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  documentType: true,
  documentLast4: true,
  country: true,
} satisfies Prisma.GuestSelect;

/**
 * Busca do autocomplete da nova reserva (UC-030): nome, e-mail, telefone ou
 * final do documento.
 *
 * Termo vazio devolve os hóspedes mais recentes — abrir o campo já com os
 * últimos atendidos resolve boa parte dos casos de hóspede recorrente sem
 * ninguém digitar nada.
 */
export async function buscarHospedes(
  actor: ActorContext,
  termo: string,
  opts: { limite?: number } = {},
): Promise<HospedeResumo[]> {
  const limite = Math.min(
    Math.max(opts.limite ?? LIMITE_BUSCA_PADRAO, 1),
    LIMITE_BUSCA_MAXIMO,
  );
  const busca = termo.trim();

  const linhas = await withTenant(
    { tenantId: actor.tenantId, userId: actor.userId },
    (tx) =>
      tx.guest.findMany({
        where: { deletedAt: null, ...filtroDeBusca(busca) },
        select: CAMPOS_RESUMO,
        orderBy:
          busca === ""
            ? [{ createdAt: "desc" }]
            : [{ lastName: "asc" }, { firstName: "asc" }],
        take: limite,
      }),
  );

  return linhas.map((g) => ({ ...g, nome: nomeCompleto(g) }));
}

function filtroDeBusca(busca: string): Prisma.GuestWhereInput {
  if (busca === "") return {};

  const digitos = busca.replace(/\D/g, "");
  // Palavras de uma letra só alargariam demais o resultado sem ajudar.
  const palavras = busca.split(/\s+/).filter((p) => p.length >= 2);

  const alternativas: Prisma.GuestWhereInput[] = [];

  if (palavras.length > 0) {
    // Cada palavra precisa casar com o nome OU o sobrenome — assim
    // "souza ana" encontra Ana Souza sem depender da ordem digitada.
    alternativas.push({
      AND: palavras.map((p) => ({
        OR: [
          { firstName: { contains: p, mode: "insensitive" } },
          { lastName: { contains: p, mode: "insensitive" } },
        ],
      })),
    });
  }

  alternativas.push({ email: { contains: busca, mode: "insensitive" } });

  if (digitos.length >= 4) {
    // O telefone está normalizado em E.164 no banco, então o trecho de
    // dígitos digitado casa independentemente da pontuação de origem.
    alternativas.push({ phone: { contains: digitos } });
    // Só o final do documento é pesquisável: o número inteiro está cifrado
    // com IV aleatório e por definição não casa por comparação.
    alternativas.push({ documentLast4: digitos.slice(-4) });
  }

  return { OR: alternativas };
}

export type HospedeDetalhe = HospedeResumo & {
  birthDate: Date | null;
  nationality: string | null;
  notes: string | null;
  marketingOptIn: boolean;
  createdAt: Date;
  updatedAt: Date;
  /** Reservas em que este hóspede é o titular. */
  totalReservas: number;
};

/** Ficha completa. `null` quando não existe no tenant. */
export async function obterHospede(
  actor: ActorContext,
  id: string,
): Promise<HospedeDetalhe | null> {
  const g = await withTenant(
    { tenantId: actor.tenantId, userId: actor.userId },
    (tx) =>
      tx.guest.findFirst({
        where: { id, deletedAt: null },
        select: {
          ...CAMPOS_RESUMO,
          birthDate: true,
          nationality: true,
          notes: true,
          marketingOptIn: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { primaryReservations: true } },
        },
      }),
  );
  if (!g) return null;

  const { _count, ...campos } = g;
  return {
    ...campos,
    nome: nomeCompleto(campos),
    totalReservas: _count.primaryReservations,
  };
}

/**
 * Resumo por e-mail, para a tela oferecer "abrir o cadastro existente"
 * quando o operador esbarra na unicidade.
 */
export async function obterHospedePorEmail(
  actor: ActorContext,
  email: string,
): Promise<HospedeResumo | null> {
  const g = await withTenant(
    { tenantId: actor.tenantId, userId: actor.userId },
    (tx) =>
      tx.guest.findFirst({
        where: { email: email.trim().toLowerCase() },
        select: CAMPOS_RESUMO,
      }),
  );
  return g ? { ...g, nome: nomeCompleto(g) } : null;
}
