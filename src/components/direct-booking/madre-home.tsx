import Image from "next/image";
import { MADRE914, publicBaseUrl, whatsappUrl } from "@/lib/direct-booking/config";
import { BookingWidget } from "./booking-widget";
import { MadreShell } from "./shell";

export function madreMetadata() {
  const url = publicBaseUrl();
  const cover = MADRE914.fotos.find((f) => f.cover) ?? MADRE914.fotos[0]!;
  return {
    metadataBase: new URL(url),
    title: { absolute: MADRE914.title },
    description: MADRE914.description,
    alternates: { canonical: url },
    openGraph: {
      title: MADRE914.title,
      description: MADRE914.description,
      url,
      siteName: MADRE914.name,
      locale: "pt_BR",
      type: "website",
      images: [
        {
          url: `${url}${cover.src}`,
          width: cover.width,
          height: cover.height,
          alt: cover.alt,
        },
      ],
    },
    twitter: {
      card: "summary_large_image" as const,
      title: MADRE914.title,
      description: MADRE914.description,
      images: [`${url}${cover.src}`],
    },
  };
}

export function MadreHome({ homePath = "/" }: { homePath?: string }) {
  const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(MADRE914.mapsQuery)}`;

  return (
    <MadreShell homePath={homePath}>
      <main id="conteudo">
        <section id="topo" className="pb-8 sm:pb-14">
          <div className="mx-auto grid max-w-[1160px] items-end gap-8 px-5 pt-8 sm:pt-13 lg:grid-cols-[1.1fr_0.9fr] lg:gap-12">
            <div>
              <div className="mb-4 flex items-center gap-2.5">
                <span className="h-[7px] w-[7px] rounded-full bg-[#4a7c59]" />
                <span className="text-[12.5px] uppercase tracking-[0.09em] text-[#6b5a48]">
                  {MADRE914.addressLine1} · {MADRE914.neighborhood} · {MADRE914.city}
                </span>
              </div>
              <h1
                className="mb-4 text-[clamp(1.85rem,5vw,3.5rem)] leading-[1.04] tracking-[-0.015em]"
                style={{ fontFamily: "var(--font-madre-heading), serif" }}
              >
                <span className="block">Studio novo de {MADRE914.sizeM2} m²</span>
                <span className="block">para até {MADRE914.maxGuests} pessoas,</span>
                <span className="block">na Mooca.</span>
              </h1>
              <p className="mb-6 max-w-[44ch] text-[clamp(1rem,1.7vw,1.19rem)] leading-relaxed text-[#6b5a48]">
                Prédio recém-entregue na principal avenida do bairro. Você reserva
                direto com a gente, sem intermediário, e recebe as instruções de
                entrada pelo WhatsApp.
              </p>
              <div className="mb-6 flex flex-wrap gap-2.5">
                {[MADRE914.bedsLabel, "Ar-condicionado", "Wi-Fi fibra", "Academia e lavanderia"].map((t) => (
                  <span key={t} className="rounded-full bg-[#efe0c8] px-3 py-1 text-[13px] font-medium">
                    {t}
                  </span>
                ))}
                <span className="rounded-full bg-[#dce8dc] px-3 py-1 text-[13px] font-medium text-[#2d5a38]">
                  PETs aceitos
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <a href="#datas" className="inline-flex min-h-12 items-center rounded-full bg-[#8b5a2b] px-7 py-4 font-semibold text-[#f6e3c4] no-underline">
                  Ver datas disponíveis
                </a>
                <a href={whatsappUrl()} target="_blank" rel="noopener" className="inline-flex min-h-12 items-center rounded-full border border-[#e0d0b8] px-7 py-4 font-semibold no-underline">
                  Tirar dúvida no WhatsApp
                </a>
              </div>
            </div>
            <div className="overflow-hidden rounded-2xl">
              <Image
                src={MADRE914.fotos[0]!.src}
                alt={MADRE914.fotos[0]!.alt}
                width={MADRE914.fotos[0]!.width}
                height={MADRE914.fotos[0]!.height}
                priority
                className="h-full w-full object-cover"
              />
              <p className="bg-[#2b2118] px-3 py-2 text-xs text-[#f6e3c4]">Foto real do edifício</p>
            </div>
          </div>
        </section>

        <div className="mx-auto max-w-[1160px] px-5 py-8">
          <BookingWidget />
        </div>

        <section id="comodidades" className="mx-auto max-w-[1160px] scroll-mt-20 px-5 py-12 sm:py-20">
          <h2 className="mb-3 text-2xl" style={{ fontFamily: "var(--font-madre-heading), serif" }}>
            O que o prédio e o studio entregam
          </h2>
          <p className="mb-8 max-w-[60ch] text-[#6b5a48]">
            Só listamos o que existe hoje. O edifício foi entregue recentemente e
            algumas unidades ainda estão em montagem — pode haver movimento em
            horário comercial.
          </p>
          <div className="grid gap-10 sm:grid-cols-2">
            <div>
              <h3 className="mb-3 font-semibold">No apartamento</h3>
              <ul className="space-y-1.5 text-[#6b5a48]">
                {MADRE914.noApartamento.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="mb-3 font-semibold">No edifício</h3>
              <ul className="space-y-1.5 text-[#6b5a48]">
                {MADRE914.noEdificio.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </div>
          </div>
          <div className="mt-10 grid gap-3 sm:grid-cols-4">
            {MADRE914.fotos.map((f) => (
              <Image
                key={f.src}
                src={f.src}
                alt={f.alt}
                width={f.width}
                height={f.height}
                className="h-48 w-full rounded-xl object-cover"
              />
            ))}
          </div>
          <p className="mt-3 text-xs text-[#6b5a48]">
            Fotografias reais do edifício e das unidades, sem retoque de conteúdo.
          </p>
        </section>

        <section id="localizacao" className="mx-auto max-w-[1160px] scroll-mt-20 px-5 py-12 sm:py-20">
          <h2 className="mb-3 text-2xl" style={{ fontFamily: "var(--font-madre-heading), serif" }}>
            Avenida Paes de Barros, 1179
          </h2>
          <p className="mb-4 max-w-[60ch] text-[#6b5a48]">{MADRE914.localizacao.intro}</p>
          <div className="mb-6 flex flex-wrap gap-3">
            <a href={maps} target="_blank" rel="noopener" className="rounded-full bg-[#8b5a2b] px-5 py-2 text-sm font-semibold text-[#f6e3c4] no-underline">
              Abrir rota no mapa
            </a>
            <a href={whatsappUrl("Olá! Preciso de orientação para chegar ao Madre 914.")} target="_blank" rel="noopener" className="rounded-full border border-[#e0d0b8] px-5 py-2 text-sm font-semibold no-underline">
              Pedir orientação
            </a>
          </div>
          <p className="mb-8 text-sm text-[#6b5a48]">A entrada dos hóspedes é pelo número 1179.</p>
          <div className="grid gap-6 sm:grid-cols-2">
            {MADRE914.localizacao.grupos.map((g) => (
              <div key={g.titulo}>
                <h3 className="mb-2 font-semibold">{g.titulo}</h3>
                <p className="text-sm text-[#6b5a48]">{g.itens.join(" · ")}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-sm text-[#6b5a48]">{MADRE914.localizacao.notaDistancias}</p>
        </section>

        <section id="regras" className="mx-auto max-w-[1160px] scroll-mt-20 px-5 py-12 sm:py-20">
          <h2 className="mb-6 text-2xl" style={{ fontFamily: "var(--font-madre-heading), serif" }}>
            Regras da casa
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2">
            <li><strong>Não se fuma dentro do apartamento.</strong> Higienização de R$ 600,00 se constatado.</li>
            <li><strong>Até {MADRE914.maxGuests} hóspedes</strong>, todos cadastrados.</li>
            <li><strong>Silêncio das 22h às 8h.</strong></li>
            <li><strong>Festas e eventos não são permitidos.</strong></li>
            <li><strong>Horários:</strong> entrada {MADRE914.checkInTime}, saída {MADRE914.checkOutTime}.</li>
            <li><strong>Obra em andamento</strong> em algumas unidades do prédio, em horário comercial.</li>
          </ul>
        </section>

        <section id="duvidas" className="mx-auto max-w-[1160px] scroll-mt-20 px-5 py-12 sm:py-20">
          <h2 className="mb-6 text-2xl" style={{ fontFamily: "var(--font-madre-heading), serif" }}>
            Perguntas frequentes
          </h2>
          <dl className="space-y-4 text-[#6b5a48]">
            <div>
              <dt className="font-semibold text-[#2b2118]">Qual a estadia mínima?</dt>
              <dd>Duas noites. A máxima é de três meses.</dd>
            </div>
            <div>
              <dt className="font-semibold text-[#2b2118]">Crianças pagam?</dt>
              <dd>A partir do terceiro hóspede, sim — R$ 40 por noite, independente da idade.</dd>
            </div>
            <div>
              <dt className="font-semibold text-[#2b2118]">Posso levar meu PET?</dt>
              <dd>Pode. Taxa de R$ 80 por estadia, até 2 animais. Informe na consulta de datas.</dd>
            </div>
            <div>
              <dt className="font-semibold text-[#2b2118]">Quais formas de pagamento?</dt>
              <dd>Pix e cartão de crédito pelo próprio site. Não pedimos dados de cartão por mensagem.</dd>
            </div>
          </dl>
        </section>
      </main>
    </MadreShell>
  );
}
