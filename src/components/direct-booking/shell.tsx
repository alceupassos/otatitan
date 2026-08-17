import { Caprasimo, Figtree } from "next/font/google";
import Link from "next/link";
import type { ReactNode } from "react";
import { MADRE914, whatsappUrl } from "@/lib/direct-booking/config";

const caprasimo = Caprasimo({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-madre-heading",
  display: "swap",
});

const figtree = Figtree({
  subsets: ["latin"],
  variable: "--font-madre-sans",
  display: "swap",
});

function ancora(homePath: string, id: string): string {
  return homePath === "/" ? `/#${id}` : `${homePath}#${id}`;
}

export function MadreShell({
  children,
  homePath = "/stays/madre-914",
}: {
  children: ReactNode;
  homePath?: string;
}) {
  return (
    <div
      className={`${caprasimo.variable} ${figtree.variable} min-h-svh bg-[#f5ead8] text-[#2b2118]`}
      style={{ fontFamily: "var(--font-madre-sans), ui-sans-serif, system-ui" }}
    >
      <header className="sticky top-0 z-40 border-b border-[#e0d0b8]/80 bg-[#f5ead8]/92 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1160px] items-center gap-5 px-5 py-3">
          <Link href={homePath === "/" ? "#topo" : homePath} className="flex items-center gap-2.5 no-underline">
            <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-gradient-to-br from-[#8b5a2b] to-[#5c3a1a] text-lg text-[#f6e3c4]"
              style={{ fontFamily: "var(--font-madre-heading), serif" }}>
              M
            </span>
            <span className="flex flex-col leading-none">
              <span className="text-[17px] tracking-[0.04em] whitespace-nowrap"
                style={{ fontFamily: "var(--font-madre-heading), serif" }}>
                {MADRE914.name}
              </span>
              <span className="mt-[3px] text-[9px] tracking-[0.34em] text-[#6b5a48]">
                MOOCA
              </span>
            </span>
          </Link>
          <nav className="ml-auto hidden items-center gap-6 text-sm lg:flex">
            <a href={ancora(homePath, "datas")} className="text-[#6b5a48] no-underline hover:text-[#2b2118]">Datas</a>
            <a href={ancora(homePath, "comodidades")} className="text-[#6b5a48] no-underline hover:text-[#2b2118]">Comodidades</a>
            <a href={ancora(homePath, "localizacao")} className="text-[#6b5a48] no-underline hover:text-[#2b2118]">Localização</a>
            <a href={ancora(homePath, "regras")} className="text-[#6b5a48] no-underline hover:text-[#2b2118]">Regras</a>
            <a href={ancora(homePath, "duvidas")} className="text-[#6b5a48] no-underline hover:text-[#2b2118]">Dúvidas</a>
          </nav>
          <div className="ml-auto flex items-center gap-2 lg:ml-0">
            <a
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-[#e0d0b8] px-4 py-2 text-sm font-semibold no-underline hover:bg-[#efe0c8]"
              href={whatsappUrl()}
              target="_blank"
              rel="noopener"
            >
              WhatsApp
            </a>
            <a
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-[#8b5a2b] px-4 py-2 text-sm font-semibold text-[#f6e3c4] no-underline hover:bg-[#5c3a1a]"
              href={ancora(homePath, "datas")}
            >
              Consultar datas
            </a>
          </div>
        </div>
      </header>
      {children}
      <footer className="border-t border-[#e0d0b8] px-5 py-10 text-sm text-[#6b5a48]">
        <div className="mx-auto flex max-w-[1160px] flex-col gap-4 sm:flex-row sm:justify-between">
          <p>
            {MADRE914.name} · {MADRE914.addressLine1} · {MADRE914.neighborhood}
          </p>
          <nav className="flex flex-wrap gap-4">
            <Link href="/politicas/privacidade" className="underline-offset-4 hover:underline">Privacidade</Link>
            <Link href="/politicas/cookies" className="underline-offset-4 hover:underline">Cookies</Link>
            <Link href="/politicas/dados-e-fotografia" className="underline-offset-4 hover:underline">Foto e dados</Link>
            <Link href="/politicas/regras-da-casa" className="underline-offset-4 hover:underline">Regras</Link>
            <Link href="/politicas/politica-pet" className="underline-offset-4 hover:underline">PETs</Link>
            <Link href="/politicas/hospedagem-e-regras" className="underline-offset-4 hover:underline">Contrato</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
