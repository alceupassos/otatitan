import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import Link from "next/link";
import { MadreShell } from "@/components/direct-booking/shell";
import { isPoliticaSlug, POLITICAS } from "@/lib/direct-booking/policies";
import { publicBaseUrl } from "@/lib/direct-booking/config";
import { isDirectBookingHost } from "@/lib/direct-booking/hosts";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  if (!isPoliticaSlug(slug)) return { title: "Política" };
  const p = POLITICAS[slug];
  return {
    title: { absolute: `${p.titulo} · Madre 914` },
    alternates: { canonical: `${publicBaseUrl()}/politicas/${slug}` },
  };
}

export default async function PoliticaPage({ params }: Params) {
  const { slug } = await params;
  if (!isPoliticaSlug(slug)) notFound();
  const p = POLITICAS[slug];
  const host = (await headers()).get("host");
  const homePath = isDirectBookingHost(host) ? "/" : "/stays/madre-914";

  return (
    <MadreShell homePath={homePath}>
      <main className="mx-auto max-w-3xl px-5 py-12">
        <Link href={homePath} className="text-sm text-[#6b5a48] underline-offset-4 hover:underline">
          Voltar ao site
        </Link>
        <h1
          className="mt-4 mb-2 text-3xl"
          style={{ fontFamily: "var(--font-madre-heading), serif" }}
        >
          {p.titulo}
        </h1>
        <p className="mb-8 text-sm text-[#6b5a48]">
          Versão {p.versao} · vigente desde {p.vigenteDesde}
        </p>
        <div className="space-y-4 leading-relaxed text-[#2b2118]">
          {p.paragrafos.map((t) => (
            <p key={t.slice(0, 40)}>{t}</p>
          ))}
        </div>
      </main>
    </MadreShell>
  );
}
