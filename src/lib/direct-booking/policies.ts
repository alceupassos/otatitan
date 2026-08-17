import { MADRE914 } from "./config";

export type PoliticaSlug =
  | "privacidade"
  | "cookies"
  | "dados-e-fotografia"
  | "hospedagem-e-regras"
  | "politica-pet"
  | "regras-da-casa";

export const POLITICAS: Record<
  PoliticaSlug,
  { titulo: string; versao: string; vigenteDesde: string; paragrafos: string[] }
> = {
  privacidade: {
    titulo: "Política de privacidade",
    versao: "4",
    vigenteDesde: "16/08/2026",
    paragrafos: [
      `Contratada: ${MADRE914.contratada} · CNPJ ${MADRE914.cnpj}. Endereço do imóvel: ${MADRE914.addressLine1} — ${MADRE914.neighborhood}, ${MADRE914.city}/${MADRE914.state}. Atendimento: WhatsApp +55 11 91687-0066 · ${MADRE914.email}.`,
      "Bases legais. Tratamos dados pessoais com fundamento em: execução de contrato (art. 7º, V da LGPD) — identificação, contato e cobrança; cumprimento de obrigação legal (art. 7º, II) — registro de hóspedes e obrigações fiscais; consentimento (art. 7º, I) — fotografia do rosto do responsável, coletada mediante aceite específico; legítimo interesse (art. 7º, IX) — segurança do edifício e prevenção a fraude.",
      "Compartilhamos o mínimo necessário com o provedor de pagamento (nome, CPF, e-mail, valor), a portaria do condomínio (nome e fotografia, só para conferir a entrada) e o provedor de e-mail/WhatsApp (nome e contato, para confirmação e instruções). Não vendemos dados pessoais. Não compartilhamos para publicidade de terceiros.",
      "Retenção: fotografia do responsável, 180 dias após a saída; documentos de identificação, 180 dias após a saída; dados de reserva e pagamento, prazo fiscal e contábil aplicável; registros de acesso e auditoria, 5 anos.",
      "Seus direitos (confirmação, acesso, correção, eliminação, portabilidade, revogação do consentimento) pelo WhatsApp +55 11 91687-0066 ou " +
        MADRE914.email +
        ". Respondemos em até 15 dias.",
    ],
  },
  cookies: {
    titulo: "Política de cookies",
    versao: "1",
    vigenteDesde: "02/08/2026",
    paragrafos: [
      "Essenciais — mantêm sua sessão e o orçamento em andamento enquanto você navega. Sem eles o site não funciona. Não dependem de consentimento.",
      "Preferências — lembram escolhas como datas consultadas, para você não precisar repetir.",
      "Não utilizamos cookies de publicidade nem compartilhamos dados de navegação com redes de anúncio.",
      "Como controlar: pelo próprio navegador, nas configurações de privacidade. Bloquear os essenciais impede o funcionamento da reserva.",
    ],
  },
  "dados-e-fotografia": {
    titulo: "Tratamento de dados pessoais e fotografia",
    versao: "4",
    vigenteDesde: "16/08/2026",
    paragrafos: [
      `Contratada: ${MADRE914.contratada} · CNPJ ${MADRE914.cnpj}. Endereço: ${MADRE914.addressLine1} — ${MADRE914.neighborhood}, ${MADRE914.city}/${MADRE914.state}.`,
      "Do responsável pela reserva: nome completo, CPF, data de nascimento, telefone, WhatsApp, e-mail e uma fotografia do rosto. Dos demais hóspedes adultos: nome completo e CPF. Das crianças: nome completo e data de nascimento; o CPF é opcional.",
      "Finalidade única da fotografia: permitir que a portaria confirme, na chegada, que quem entra é quem reservou. A fotografia não é usada para treinar inteligência artificial, marketing, perfilamento, reconhecimento facial para outra finalidade, nem compartilhamento com terceiros não informados aqui.",
      "Quem vê a foto: apenas a operação da hospedagem e a portaria, na conferência da entrada. Guardamos até 180 dias após a saída, depois é excluída automaticamente. Exclusão antes do prazo: WhatsApp +55 11 91687-0066, a qualquer momento após a estadia.",
      "A exclusão da fotografia não afeta o histórico da reserva, que permanece pelos prazos legais. Encarregado (DPO): a confirmar — o site ao vivo ainda não publica um nome.",
    ],
  },
  "hospedagem-e-regras": {
    titulo: "Contrato de hospedagem por temporada",
    versao: "4",
    vigenteDesde: "16/08/2026",
    paragrafos: [
      "Objeto: hospedagem temporária em unidade mobiliada do Condomínio Madre 914, pelo período contratado, com finalidade exclusiva de moradia temporária. Não constitui locação residencial nem gera direito de permanência além do período contratado.",
      `Entrada a partir das ${MADRE914.checkInTime} da data de início. Saída até as ${MADRE914.checkOutTime} da data de término. Estadia mínima de ${MADRE914.minNights} noites e máxima de 3 meses.`,
      `A unidade acomoda até ${MADRE914.maxGuests} hóspedes. O valor contratado inclui ${MADRE914.includedGuests} pessoas; cada hóspede adicional é cobrado à parte, conforme o orçamento antes do pagamento. Todos os ocupantes precisam estar cadastrados antes da chegada. O responsável pela reserva deve ser maior de 18 anos na data de entrada.`,
      "É proibido fumar no interior da unidade. Constatado fumo, pode ser cobrada higienização de R$ 600,00, com evidência e direito de manifestação prévia. Silêncio das 22h às 8h. Festas e eventos não são permitidos. Visitantes só com consulta prévia.",
      "O edifício foi entregue recentemente e algumas unidades ainda estão em montagem. Pode haver movimentação e ruído em horário comercial. Esta informação é prestada antes da contratação.",
      "Foro: a comarca ainda não foi confirmada no texto publicado no site ao vivo — não inventamos. O consumidor pode acionar o foro de seu domicílio, nos termos da legislação aplicável.",
    ],
  },
  "politica-pet": {
    titulo: "Política para animais de estimação",
    versao: "1",
    vigenteDesde: "02/08/2026",
    paragrafos: [
      `Aceitamos até ${MADRE914.maxPets} animais por reserva, com taxa de R$ ${(MADRE914.petFeeCents / 100).toFixed(2).replace(".", ",")} por estadia. O valor aparece no resumo antes do pagamento, nunca depois.`,
      "O hóspede responde por qualquer dano causado pelo animal, não o deixa sozinho no apartamento, recolhe dejetos e o mantém sob controle no trajeto entre a rua e a unidade.",
      "Restrições de porte ou raça, quando aplicáveis pelas normas do condomínio, são informadas durante a reserva.",
    ],
  },
  "regras-da-casa": {
    titulo: "Regras da casa",
    versao: "1",
    vigenteDesde: "02/08/2026",
    paragrafos: [
      "Não se fuma dentro do apartamento. Constatado fumo, é cobrada a higienização de R$ 600,00. Vale para cigarro, vape e narguilé, em qualquer ambiente da unidade.",
      "Ocupação de até 6 hóspedes. Todos cadastrados, adultos e crianças. Pessoas não cadastradas não entram no prédio.",
      "Silêncio das 22h às 8h. É um edifício residencial.",
      "Festas e eventos não são permitidos. A hospedagem é para os hóspedes da reserva.",
      `Entrada a partir das ${MADRE914.checkInTime}, saída até as ${MADRE914.checkOutTime}. Fora disso, consulte antes — depende da agenda de limpeza.`,
      "Obra em andamento: algumas unidades ainda estão em montagem. Pode haver movimentação e ruído em horário comercial.",
    ],
  },
};

export function isPoliticaSlug(s: string): s is PoliticaSlug {
  return s in POLITICAS;
}
