/**
 * Configuração editável do canal direto Madre 914.
 *
 * Fonte: o site ao vivo https://www.madre914.com.br (consultado em
 * 2026-08-17). Números que o site NÃO publica (diária, CEP, km, minutos)
 * não entram aqui. Eventos na Mooca também não — não há calendário
 * verificado no código.
 */

export const MADRE914_SLUG = "madre-914";

export const MADRE914 = {
  name: "MADRE 914",
  tagline: "Studios para curta temporada na Mooca",
  title: "Madre 914 · Studios para curta temporada na Mooca",
  description:
    "Studios de 40 m² para até 6 pessoas na Av. Paes de Barros, Mooca. Reserva direta, sem intermediário, com instruções de entrada pelo WhatsApp.",
  canonicalPath: "/",
  addressLine1: "Av. Paes de Barros, 1179",
  neighborhood: "Mooca",
  city: "São Paulo",
  state: "SP",
  country: "BR",
  mapsQuery: "Av. Paes de Barros, 1179, Mooca, São Paulo",
  checkInTime: "15:00",
  checkOutTime: "11:00",
  sizeM2: 40,
  maxGuests: 6,
  minNights: 2,
  maxNights: 90,
  maxAdvanceDays: 90,
  includedGuests: 2,
  bedsLabel: "2 camas de casal + sofá-cama",
  whatsapp: "5511916870066",
  whatsappMessage: "Olá! Estou consultando uma hospedagem no Madre 914.",
  email: "contato@madre914.com.br",
  contratada: "TITAN PRIME LTDA",
  cnpj: "68.264.726/0001-75",
  /** Taxas publicadas no site ao vivo — não são diária. */
  extraGuestCentsPerNight: 4_000,
  petFeeCents: 8_000,
  maxPets: 2,
  parkingFeeCents: 5_000,
  smokingFineCents: 60_000,
  fotos: [
    {
      src: "/fotos/fachada.jpg",
      alt: "Fachada do edifício Madre 914 na Avenida Paes de Barros",
      width: 960,
      height: 1280,
      cover: true,
    },
    {
      src: "/fotos/placa.jpg",
      alt: "Placa do edifício Madre 914",
      width: 960,
      height: 1280,
    },
    {
      src: "/fotos/lobby-estar.jpg",
      alt: "Hall de entrada com estar",
      width: 576,
      height: 768,
    },
    {
      src: "/fotos/lobby-corredor.jpg",
      alt: "Corredor do edifício",
      width: 576,
      height: 768,
    },
  ],
  /**
   * Pontos listados no site ao vivo. Distâncias e tempos NÃO entram:
   * o próprio site diz que ainda não foram medidos.
   */
  localizacao: {
    intro:
      "A Paes de Barros corta a Mooca de ponta a ponta: hospital, shopping, estádio e metrô ficam todos no mesmo eixo. Bom para quem vem por consulta médica, jogo, show, formatura ou trabalho.",
    notaDistancias:
      "Pontos conferidos nos sites oficiais de cada estabelecimento. Distâncias e tempos de deslocamento serão publicados por ponto depois de medidos — não estimamos.",
    grupos: [
      {
        titulo: "Hospitais",
        itens: [
          "Villa-Lobos",
          "São Cristóvão",
          "Salvalus",
          "CEMA",
          "Santa Maggiore",
          "Vitória",
          "São Camilo",
        ],
      },
      {
        titulo: "Clube, estádio e casas de evento",
        itens: [
          "Clube Atlético Juventus",
          "Estádio Conde Rodolfo Crespi",
          "Komplexo Tempo",
        ],
      },
      {
        titulo: "Shoppings",
        itens: ["Mooca Plaza", "Anália Franco", "Metrô Tatuapé"],
      },
      {
        titulo: "Cultura e universidades",
        itens: [
          "Museu da Imigração",
          "Memorial do Imigrante",
          "Museu Catavento",
          "Universidade São Judas",
          "UNICID",
        ],
      },
      {
        titulo: "Igrejas",
        itens: [
          "Igreja Universal do Reino de Deus",
          "Igreja Renascer",
        ],
      },
    ],
  },
  noApartamento: [
    "40 m² para até 6 hóspedes",
    "2 camas de casal e sofá-cama",
    "Ar-condicionado",
    "Smart TV",
    "Wi-Fi de fibra",
    "Frigobar e micro-ondas",
    "Grill e utensílios para refeições rápidas",
    "Pia com bancada de granito",
    "Roupa de cama e toalhas",
    "Espelho com iluminação e secador de cabelo",
    "Cortinas blackout em todas as janelas",
    "Fechadura eletrônica com senha",
  ],
  noEdificio: [
    "Academia",
    "Lavanderia",
    "Portaria com atendente",
    "Elevadores",
    "Hall de entrada com estar",
    "Garagem paga à parte",
  ],
} as const;

export function whatsappUrl(texto = MADRE914.whatsappMessage): string {
  return `https://wa.me/${MADRE914.whatsapp}?text=${encodeURIComponent(texto)}`;
}

export function publicBaseUrl(): string {
  const fromEnv = process.env.DIRECT_BOOKING_PUBLIC_URL?.replace(/\/+$/, "");
  if (fromEnv) return fromEnv;
  return "https://www.madre914.com.br";
}

export function directBookingTenantSlug(): string | null {
  const slug = process.env.DIRECT_BOOKING_TENANT_SLUG?.trim();
  return slug ? slug : null;
}

export function directBookingPropertySlug(): string {
  return process.env.DIRECT_BOOKING_PROPERTY_SLUG?.trim() || MADRE914_SLUG;
}
