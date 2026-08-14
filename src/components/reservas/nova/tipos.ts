import type { BlockSource } from "@/generated/prisma/enums";
import type { TipoDocumento } from "@/lib/guests/schemas";

/**
 * Tipos compartilhados entre os passos da nova reserva.
 *
 * Vivem fora de `actions.ts` porque um módulo `"use server"` é carregado
 * pelo cliente como referência de endpoint, e constantes de formulário não
 * têm nada que fazer nessa fronteira.
 */

/**
 * A ficha do hóspede como o formulário a mantém: tudo em `string`, porque
 * é assim que ela viaja no `FormData` da confirmação e é assim que
 * `hospedeSchema` a espera. Converter para `Date`/`null` aqui só criaria
 * uma segunda representação para o schema desfazer depois.
 */
export type HospedeValores = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  documentType: TipoDocumento | "";
  documentNumber: string;
  birthDate: string;
  nationality: string;
  country: string;
  notes: string;
  marketingOptIn: boolean;
};

export const HOSPEDE_VAZIO: HospedeValores = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  documentType: "",
  documentNumber: "",
  birthDate: "",
  nationality: "",
  country: "BR",
  notes: "",
  marketingOptIn: false,
};

/**
 * O cadastro escolhido no autocomplete, quando houve um.
 *
 * Só informativo: quem decide reaproveitar ou criar é
 * `encontrarOuCriarHospede`, no servidor, e o critério dele é o e-mail —
 * não este id. Guardamos o registro escolhido para a tela poder avisar
 * quando esse reaproveitamento NÃO vai acontecer (hóspede sem e-mail).
 */
export type HospedeEscolhido = {
  id: string;
  nome: string;
  email: string | null;
  documentLast4: string | null;
};

/** Como a cobrança será conduzida depois que a reserva existir. */
export type FormaDeCobranca = "link" | "manual";

/**
 * Rótulo de cada origem de ocupação exibida na lista de indisponíveis.
 *
 * Indexado pelo ENUM, não por `string`: uma origem nova em
 * `BlockSource` tem de quebrar o build aqui, e não chegar ao operador como
 * `CHANNEL_SYNC` cru no meio de uma frase em português. (Só importa o
 * TIPO do Prisma, então o módulo continua atravessando para o cliente.)
 *
 * Candidato a subir para o domínio ao lado de `MOTIVO_LABELS`
 * (`@/lib/availability/schemas`), que hoje nomeia apenas as origens de
 * bloqueio manual e não as que a busca também devolve.
 */
export const ORIGEM_OCUPACAO_LABELS: Record<BlockSource, string> = {
  RESERVATION: "Reserva",
  MANUAL: "Bloqueio manual",
  MAINTENANCE: "Manutenção",
  OWNER_STAY: "Uso do proprietário",
  CHANNEL_SYNC: "Bloqueio vindo de canal",
};
