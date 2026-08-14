import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { writeAudit } from "@/lib/audit/log";
import { encryptSecret } from "@/lib/auth/crypto";
import { withTenant, type TenantTx } from "@/lib/db/with-tenant";
import type { ActorContext } from "@/lib/rbac/guard";
import { DocumentoNaoCifravel, EmailJaCadastrado, HospedeNaoEncontrado } from "./errors";
import {
  normalizarDocumento,
  ultimosQuatro,
  type HospedeInput,
  type TipoDocumento,
} from "./schemas";

/**
 * Escritas de hóspedes.
 *
 * Ficam FORA de `actions.ts` de propósito. Todo export de um arquivo
 * `"use server"` vira um endpoint chamável pelo cliente com argumentos
 * arbitrários; uma função que recebe o `ActorContext` como parâmetro
 * exposta assim deixaria qualquer um forjar o ator. Aqui o ator é sempre
 * fornecido por quem já o resolveu no servidor — as server actions em
 * `actions.ts` e o fluxo de reserva.
 *
 * A autorização é do chamador (`requireActorWith("guests.create" | ...)`).
 */

/** Campos que a auditoria pode citar pelo nome (nunca pelo valor). */
type CampoHospede = keyof Prisma.GuestUncheckedCreateInput;

/**
 * Cifra o documento de identidade.
 *
 * AES-256-GCM com IV aleatório (`src/lib/auth/crypto.ts`), o mesmo esquema
 * já usado para o segredo de MFA. Consequência prática: o texto cifrado NÃO
 * é pesquisável — dois cadastros do mesmo CPF produzem cifras diferentes.
 * É por isso que `documentLast4` existe em claro, e é o único pedaço do
 * documento que a interface e a busca enxergam
 * (docs/11-seguranca-lgpd.md).
 */
function cifrarDocumento(tipo: TipoDocumento, numero: string) {
  const canonico = normalizarDocumento(tipo, numero);
  try {
    return {
      documentType: tipo,
      documentNumberEnc: encryptSecret(canonico),
      documentLast4: ultimosQuatro(canonico),
    };
  } catch {
    // `encryptSecret` só falha por chave ausente/inválida. Guardar o número
    // em claro seria pior do que recusar a gravação.
    throw new DocumentoNaoCifravel();
  }
}

/** Campos comuns a criação e edição, exceto o documento. */
function camposBasicos(dados: HospedeInput) {
  return {
    firstName: dados.firstName,
    lastName: dados.lastName,
    email: dados.email,
    phone: dados.phone,
    birthDate: dados.birthDate,
    nationality: dados.nationality,
    country: dados.country,
    notes: dados.notes,
    marketingOptIn: dados.marketingOptIn,
  };
}

function ehEmailDuplicado(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}

/**
 * Auditoria de hóspede registra QUAIS campos mudaram, nunca os valores.
 *
 * A trilha é append-only e de retenção longa (RN-010); copiar e-mail,
 * telefone e data de nascimento para dentro dela criaria uma segunda base
 * de dados pessoais fora do alcance de uma exclusão a pedido do titular.
 */
async function auditarHospede(
  tx: TenantTx,
  actor: ActorContext,
  action: string,
  guestId: string,
  campos: string[],
) {
  await writeAudit(tx, {
    action,
    entityType: "Guest",
    entityId: guestId,
    actorUserId: actor.userId,
    after: { campos },
  });
}

// ── Criação e edição ──────────────────────────────────────────────────────

export async function criarHospede(
  actor: ActorContext,
  dados: HospedeInput,
): Promise<string> {
  try {
    return await withTenant(
      { tenantId: actor.tenantId, userId: actor.userId },
      async (tx) => {
        const guest = await tx.guest.create({
          data: {
            ...camposBasicos(dados),
            ...(dados.documentType && dados.documentNumber
              ? cifrarDocumento(dados.documentType, dados.documentNumber)
              : {}),
          },
          select: { id: true },
        });

        await auditarHospede(tx, actor, "guest.created", guest.id, [
          ...Object.keys(camposBasicos(dados)),
          ...(dados.documentType ? ["documentNumber"] : []),
        ]);

        return guest.id;
      },
    );
  } catch (err) {
    if (ehEmailDuplicado(err) && dados.email) {
      throw new EmailJaCadastrado(dados.email, await idPorEmail(actor, dados.email));
    }
    throw err;
  }
}

/**
 * Edição da ficha (UC-030).
 *
 * O documento só é tocado quando um número novo é informado: o formulário
 * exibe apenas os 4 últimos dígitos, então campo em branco significa "não
 * mexi", e não "apague". Para exclusão do documento a pedido do titular
 * (LGPD, art. 18), passe `removerDocumento`.
 */
export async function atualizarHospede(
  actor: ActorContext,
  id: string,
  dados: HospedeInput,
  opts: { removerDocumento?: boolean } = {},
): Promise<void> {
  try {
    await withTenant(
      { tenantId: actor.tenantId, userId: actor.userId },
      async (tx) => {
        const antes = await tx.guest.findFirst({
          where: { id, deletedAt: null },
          select: { id: true },
        });
        if (!antes) throw new HospedeNaoEncontrado();

        const documento =
          dados.documentType && dados.documentNumber
            ? cifrarDocumento(dados.documentType, dados.documentNumber)
            : opts.removerDocumento
              ? { documentType: null, documentNumberEnc: null, documentLast4: null }
              : {};

        await tx.guest.update({
          where: { id },
          data: { ...camposBasicos(dados), ...documento },
        });

        await auditarHospede(tx, actor, "guest.updated", id, [
          ...Object.keys(camposBasicos(dados)),
          ...(Object.keys(documento).length > 0 ? ["documentNumber"] : []),
        ]);
      },
    );
  } catch (err) {
    if (ehEmailDuplicado(err) && dados.email) {
      throw new EmailJaCadastrado(dados.email, await idPorEmail(actor, dados.email));
    }
    throw err;
  }
}

// ── Encontrar ou criar (fluxo de reserva) ────────────────────────────────

export type ResolucaoHospede = {
  id: string;
  /** `false` quando um cadastro existente foi reaproveitado. */
  criado: boolean;
  /** Campos que estavam vazios e foram preenchidos com os dados da reserva. */
  camposPreenchidos: string[];
};

/**
 * Resolve o hóspede de uma reserva: reaproveita o cadastro do mesmo e-mail
 * ou cria um novo.
 *
 * O reaproveitamento só PREENCHE lacunas — nunca sobrescreve dado existente.
 * A ficha do hóspede é curada ao longo de várias estadias; deixar um
 * formulário de reserva apressado sobrescrever o telefone correto por um
 * antigo destruiria essa curadoria em silêncio.
 *
 * Chame ANTES de abrir a transação da reserva, não dentro dela: a colisão
 * de e-mail concorrente é resolvida aqui abrindo uma transação nova, e uma
 * violação de unicidade dentro da transação da reserva a abortaria inteira.
 * O custo de uma reserva que falha depois é um cadastro de hóspede órfão —
 * um contato a mais na agenda, não uma inconsistência.
 */
export async function encontrarOuCriarHospede(
  actor: ActorContext,
  dados: HospedeInput,
): Promise<ResolucaoHospede> {
  const ctx = { tenantId: actor.tenantId, userId: actor.userId };

  try {
    return await withTenant(ctx, (tx) => resolver(tx, actor, dados));
  } catch (err) {
    // Sem e-mail não existe unicidade a violar — o erro é outro.
    if (!ehEmailDuplicado(err) || !dados.email) throw err;
  }

  // Corrida: outra requisição criou o mesmo e-mail entre o nosso SELECT e o
  // INSERT. O Postgres já abortou a transação anterior, então a releitura
  // precisa acontecer numa transação nova — não há savepoint a que voltar.
  return withTenant(ctx, async (tx) => {
    const existente = await acharPorEmail(tx, dados.email!);
    if (!existente) {
      // O e-mail colidiu e sumiu: só acontece se algo apagou a linha entre
      // as duas transações. Devolve erro de domínio legível em vez de
      // insistir num laço.
      throw new EmailJaCadastrado(dados.email!);
    }
    const camposPreenchidos = await mesclar(tx, actor, existente, dados);
    return { id: existente.id, criado: false, camposPreenchidos };
  });
}

type HospedeExistente = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  documentNumberEnc: string | null;
  birthDate: Date | null;
  nationality: string | null;
  notes: string | null;
  marketingOptIn: boolean;
  deletedAt: Date | null;
};

const CAMPOS_MESCLA = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  documentNumberEnc: true,
  birthDate: true,
  nationality: true,
  notes: true,
  marketingOptIn: true,
  deletedAt: true,
} satisfies Prisma.GuestSelect;

function acharPorEmail(tx: TenantTx, email: string): Promise<HospedeExistente | null> {
  // Inclui os apagados logicamente: o índice único não os ignora, então um
  // cadastro excluído continua "ocupando" o e-mail e precisa ser revivido
  // em vez de gerar uma colisão eterna.
  return tx.guest.findFirst({ where: { email }, select: CAMPOS_MESCLA });
}

async function resolver(
  tx: TenantTx,
  actor: ActorContext,
  dados: HospedeInput,
): Promise<ResolucaoHospede> {
  if (dados.email) {
    const existente = await acharPorEmail(tx, dados.email);
    if (existente) {
      const camposPreenchidos = await mesclar(tx, actor, existente, dados);
      return { id: existente.id, criado: false, camposPreenchidos };
    }
  }

  const guest = await tx.guest.create({
    data: {
      ...camposBasicos(dados),
      ...(dados.documentType && dados.documentNumber
        ? cifrarDocumento(dados.documentType, dados.documentNumber)
        : {}),
    },
    select: { id: true },
  });

  await auditarHospede(tx, actor, "guest.created", guest.id, [
    ...Object.keys(camposBasicos(dados)),
    ...(dados.documentType ? ["documentNumber"] : []),
  ]);

  return { id: guest.id, criado: true, camposPreenchidos: [] };
}

/** Preenche as lacunas do cadastro existente. Devolve os campos tocados. */
async function mesclar(
  tx: TenantTx,
  actor: ActorContext,
  existente: HospedeExistente,
  dados: HospedeInput,
): Promise<string[]> {
  const patch: Prisma.GuestUpdateInput = {};
  const tocados: CampoHospede[] = [];

  const preencher = <K extends CampoHospede>(campo: K, atual: unknown, novo: unknown) => {
    if (atual === null || atual === "") {
      if (novo !== null && novo !== "") {
        (patch as Record<string, unknown>)[campo] = novo;
        tocados.push(campo);
      }
    }
  };

  preencher("firstName", existente.firstName.trim() || null, dados.firstName);
  preencher("lastName", existente.lastName.trim() || null, dados.lastName);
  preencher("phone", existente.phone, dados.phone);
  preencher("birthDate", existente.birthDate, dados.birthDate);
  preencher("nationality", existente.nationality, dados.nationality);
  preencher("notes", existente.notes, dados.notes);

  if (!existente.documentNumberEnc && dados.documentType && dados.documentNumber) {
    Object.assign(patch, cifrarDocumento(dados.documentType, dados.documentNumber));
    tocados.push("documentNumberEnc");
  }

  // Consentimento de marketing só caminha de "não" para "sim", e só com
  // opt-in explícito nesta reserva. Revogar é um ato deliberado do titular,
  // que não pode acontecer por um checkbox desmarcado num formulário de
  // reserva (LGPD, art. 8º, §5º).
  if (!existente.marketingOptIn && dados.marketingOptIn) {
    patch.marketingOptIn = true;
    tocados.push("marketingOptIn");
  }

  // Hóspede excluído logicamente que volta a se hospedar é reativado: o
  // e-mail já é dele, e criar outro cadastro é impossível pela unicidade.
  if (existente.deletedAt) {
    patch.deletedAt = null;
    tocados.push("deletedAt");
  }

  if (tocados.length === 0) return [];

  await tx.guest.update({ where: { id: existente.id }, data: patch });
  await auditarHospede(tx, actor, "guest.updated", existente.id, tocados);
  return tocados;
}

/** Id do cadastro que já ocupa o e-mail, para a mensagem de erro apontar para ele. */
async function idPorEmail(actor: ActorContext, email: string): Promise<string | undefined> {
  const g = await withTenant(
    { tenantId: actor.tenantId, userId: actor.userId },
    (tx) => tx.guest.findFirst({ where: { email }, select: { id: true } }),
  );
  return g?.id;
}
