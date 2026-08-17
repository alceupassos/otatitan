"use client";

import { useEffect, useMemo, useState } from "react";
import { formatMoney } from "@/lib/money";
import { toDateOnly } from "@/lib/dates";
import { MADRE914, whatsappUrl } from "@/lib/direct-booking/config";
import {
  consultarCalendarioPublicoAction,
  consultarDisponibilidadePublicaAction,
  reservarPublicoAction,
} from "@/lib/direct-booking/actions";
import { CameraCapture } from "./camera-capture";
import type { ResultadoPublico } from "@/lib/direct-booking/types";

type DiaCal = { data: string; livres: number; total: number };

function mesLabel(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  const nomes = [
    "janeiro", "fevereiro", "março", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
  ];
  return `${nomes[(m ?? 1) - 1]} ${y}`;
}

function diasDoMes(inicioIso: string): string[] {
  const inicio = new Date(`${inicioIso}T00:00:00Z`);
  const fim = new Date(Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth() + 1, 1));
  const out: string[] = [];
  for (let t = inicio.getTime(); t < fim.getTime(); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

export function BookingWidget() {
  const hoje = toDateOnly(new Date(Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate(),
  )));
  const mesAtual = hoje.slice(0, 7) + "-01";

  const [dias, setDias] = useState<DiaCal[]>([]);
  const [configOff, setConfigOff] = useState(false);
  const [checkIn, setCheckIn] = useState<string | null>(null);
  const [checkOut, setCheckOut] = useState<string | null>(null);
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [pets, setPets] = useState(0);
  const [parking, setParking] = useState(false);
  const [busca, setBusca] = useState<ResultadoPublico | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [escolha, setEscolha] = useState<{ unitId: string; ratePlanId: string; total: number } | null>(null);
  const [cadastro, setCadastro] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    documentNumber: "",
    aceitouPoliticas: false,
    aceitouFoto: false,
  });
  const [foto, setFoto] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    consultarCalendarioPublicoAction(mesAtual).then((r) => {
      if (r.ok) setDias(r.dias);
      else if (r.erro === "config") setConfigOff(true);
    });
  }, [mesAtual]);

  const porData = useMemo(() => {
    const m = new Map<string, DiaCal>();
    for (const d of dias) m.set(d.data, d);
    return m;
  }, [dias]);

  const mes1 = mesAtual;
  const mes2Date = new Date(`${mesAtual}T00:00:00Z`);
  const mes2 = toDateOnly(new Date(Date.UTC(mes2Date.getUTCFullYear(), mes2Date.getUTCMonth() + 1, 1)));

  function clicarDia(data: string) {
    if (data < hoje) return;
    if (!checkIn || (checkIn && checkOut)) {
      setCheckIn(data);
      setCheckOut(null);
      setBusca(null);
      setEscolha(null);
      return;
    }
    if (data <= checkIn) {
      setCheckIn(data);
      setCheckOut(null);
      return;
    }
    setCheckOut(data);
  }

  async function consultar() {
    if (!checkIn || !checkOut) {
      setErro("Toque em uma data de entrada e outra de saída.");
      return;
    }
    setErro(null);
    setBuscando(true);
    setEscolha(null);
    const r = await consultarDisponibilidadePublicaAction({
      checkIn,
      checkOut,
      adults,
      children,
      pets,
      parking,
    });
    setBuscando(false);
    if (!r.ok) {
      setErro(r.erro === "config"
        ? "A disponibilidade ainda não está ligada a este sistema. Fale no WhatsApp."
        : r.erro);
      setBusca(null);
      return;
    }
    setBusca(r.resultado);
  }

  async function confirmar() {
    if (!escolha || !checkIn || !checkOut) return;
    setErro(null);
    setEnviando(true);
    const r = await reservarPublicoAction({
      checkIn,
      checkOut,
      adults,
      children,
      pets,
      parking,
      unitId: escolha.unitId,
      ratePlanId: escolha.ratePlanId,
      totalConferidoCents: escolha.total,
      fotoResponsavelBase64: foto,
      aceitouPoliticas: cadastro.aceitouPoliticas,
      aceitouFoto: cadastro.aceitouFoto,
      hospede: {
        firstName: cadastro.firstName,
        lastName: cadastro.lastName,
        email: cadastro.email,
        phone: cadastro.phone,
        documentType: "CPF",
        documentNumber: cadastro.documentNumber,
        birthDate: "",
        nationality: "",
        country: "BR",
        notes: "",
        marketingOptIn: false,
      },
    });
    setEnviando(false);
    if (!r.ok) {
      setErro(r.erro);
      return;
    }
    if (r.criada.redirectUrl) {
      window.location.href = r.criada.redirectUrl;
      return;
    }
    setErro(
      r.criada.avisoPagamento ??
        "Reserva criada, mas o pagamento não abriu. Fale no WhatsApp com o código da reserva.",
    );
  }

  function grade(mesIso: string) {
    const diasMes = diasDoMes(mesIso);
    const primeiro = new Date(`${mesIso}T00:00:00Z`).getUTCDay();
    return (
      <div>
        <h3 className="mb-2 text-sm font-semibold capitalize">{mesLabel(mesIso)}</h3>
        <div className="grid grid-cols-7 gap-1 text-center text-xs text-[#6b5a48]">
          {["D", "S", "T", "Q", "Q", "S", "S"].map((d, i) => (
            <div key={`${d}${i}`}>{d}</div>
          ))}
          {Array.from({ length: primeiro }).map((_, i) => (
            <div key={`e${i}`} />
          ))}
          {diasMes.map((d) => {
            const info = porData.get(d);
            const passado = d < hoje;
            const sel =
              d === checkIn ||
              d === checkOut ||
              (checkIn && checkOut && d > checkIn && d < checkOut);
            const livres = info?.livres ?? (configOff ? null : 0);
            const ultima = livres === 1;
            const vazia = livres === 0;
            return (
              <button
                key={d}
                type="button"
                disabled={passado}
                onClick={() => clicarDia(d)}
                className={[
                  "h-9 rounded-md text-sm",
                  passado && "text-[#c4b7a4]",
                  sel && "bg-[#8b5a2b] text-[#f6e3c4]",
                  !sel && ultima && "ring-1 ring-[#c45c26]",
                  !sel && vazia && !passado && "bg-[#ead9c0] text-[#9a8874]",
                  !sel && !vazia && !passado && "hover:bg-[#efe0c8]",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {Number(d.slice(8))}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const hospedes = adults + children;

  return (
    <section id="datas" className="scroll-mt-20 space-y-6">
      <div>
        <h2 className="mb-2 text-2xl" style={{ fontFamily: "var(--font-madre-heading), serif" }}>
          Escolha suas datas
        </h2>
        <p className="text-[#6b5a48]">
          Mínimo de {MADRE914.minNights} noites. O valor total aparece antes de qualquer cadastro.
        </p>
      </div>

      {configOff && (
        <p className="rounded-lg border border-[#e0d0b8] bg-white/60 p-3 text-sm">
          O calendário de preços ainda não está ligado a este sistema. Você pode consultar pelo{" "}
          <a className="underline" href={whatsappUrl()}>WhatsApp</a>.
        </p>
      )}

      <div className="grid gap-8 sm:grid-cols-2">
        {grade(mes1)}
        {grade(mes2)}
      </div>

      <div className="flex flex-wrap gap-4 text-xs text-[#6b5a48]">
        <span className="flex items-center gap-1.5"><span className="size-3 rounded-sm bg-[#8b5a2b]" /> Selecionado</span>
        <span className="flex items-center gap-1.5"><span className="size-3 rounded-sm ring-1 ring-[#c45c26]" /> Última unidade</span>
        <span className="flex items-center gap-1.5"><span className="size-3 rounded-sm bg-[#ead9c0]" /> Sem disponibilidade</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm">
          Entrada
          <div className="mt-1 rounded-lg border border-[#e0d0b8] bg-white px-3 py-2">
            {checkIn ?? "—"} <span className="text-[#6b5a48]">a partir das {MADRE914.checkInTime}</span>
          </div>
        </label>
        <label className="text-sm">
          Saída
          <div className="mt-1 rounded-lg border border-[#e0d0b8] bg-white px-3 py-2">
            {checkOut ?? "—"} <span className="text-[#6b5a48]">até as {MADRE914.checkOutTime}</span>
          </div>
        </label>
        <label className="text-sm">
          Adultos
          <input type="number" min={1} max={MADRE914.maxGuests} value={adults}
            onChange={(e) => setAdults(Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-[#e0d0b8] bg-white px-3 py-2" />
        </label>
        <label className="text-sm">
          Crianças
          <input type="number" min={0} max={MADRE914.maxGuests} value={children}
            onChange={(e) => setChildren(Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-[#e0d0b8] bg-white px-3 py-2" />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-6 text-sm">
        <label className="flex items-center gap-2">
          PETs (R$ {MADRE914.petFeeCents / 100} por estadia)
          <input type="number" min={0} max={MADRE914.maxPets} value={pets}
            onChange={(e) => setPets(Number(e.target.value))}
            className="w-16 rounded-lg border border-[#e0d0b8] bg-white px-2 py-1" />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={parking} onChange={(e) => setParking(e.target.checked)} />
          Vaga de garagem — R$ {MADRE914.parkingFeeCents / 100} por estadia, sujeita a disponibilidade
        </label>
      </div>
      <p className="text-sm text-[#6b5a48]">
        Capacidade máxima de {MADRE914.maxGuests} hóspedes por studio. Cada hóspede acima de{" "}
        {MADRE914.includedGuests} custa R$ {(MADRE914.extraGuestCentsPerNight / 100).toFixed(2).replace(".", ",")} por noite, criança ou adulto.
      </p>

      <button
        type="button"
        onClick={consultar}
        disabled={buscando}
        className="rounded-full bg-[#8b5a2b] px-7 py-3 font-semibold text-[#f6e3c4] disabled:opacity-50"
      >
        {buscando ? "Consultando…" : "Ver studios livres"}
      </button>

      {erro && <p className="text-sm text-red-800">{erro}</p>}

      {busca && (
        <div className="space-y-4">
          {busca.vendaveis.length === 0 && (
            <p className="text-sm text-[#6b5a48]">
              Nenhum studio vendável nestas datas.
              {busca.recusadas.some((u) => u.recusa.codigo === "SEM_TARIFA")
                ? " Há unidade livre sem diária publicada — noites sem tarifa não vendem."
                : busca.ocupadas > 0
                  ? " As unidades estão ocupadas no período."
                  : ""}
              {" "}
              <a className="underline" href={whatsappUrl()}>Fale no WhatsApp</a>.
            </p>
          )}
          {busca.vendaveis.map((u) => (
            <div key={u.unitId} className="rounded-xl border border-[#e0d0b8] bg-white/70 p-4">
              <p className="font-semibold">{u.unitName}</p>
              <p className="text-sm text-[#6b5a48]">{u.internalCode} · até {u.maxGuests} hóspedes</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {u.planos.map((p) => (
                  <button
                    key={p.ratePlanId}
                    type="button"
                    onClick={() => setEscolha({ unitId: u.unitId, ratePlanId: p.ratePlanId, total: p.totalCents })}
                    className={[
                      "rounded-lg border p-3 text-left",
                      escolha?.ratePlanId === p.ratePlanId && escolha.unitId === u.unitId
                        ? "border-[#8b5a2b] bg-[#f6e3c4]"
                        : "border-[#e0d0b8]",
                    ].join(" ")}
                  >
                    <div className="text-sm font-semibold">{p.ratePlanName}</div>
                    <div className="text-lg">{formatMoney(p.totalCents, p.currency)}</div>
                    <div className="text-xs text-[#6b5a48]">
                      {p.nights} noites · {hospedes} hóspedes
                      {p.extras?.extraGuestCents ? ` · extra ${formatMoney(p.extras.extraGuestCents)}` : ""}
                      {p.extras?.petFeeCents ? ` · PET ${formatMoney(p.extras.petFeeCents)}` : ""}
                      {p.extras?.parkingFeeCents ? ` · garagem ${formatMoney(p.extras.parkingFeeCents)}` : ""}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {escolha && (
        <form
          className="space-y-4 rounded-xl border border-[#e0d0b8] bg-white/70 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void confirmar();
          }}
        >
          <h3 className="font-semibold">Cadastro dos hóspedes</h3>
          <p className="text-sm text-[#6b5a48]">
            A portaria só libera quem estiver cadastrado antes. Pedimos nome, CPF e uma foto do responsável.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <input required placeholder="Nome" value={cadastro.firstName}
              onChange={(e) => setCadastro({ ...cadastro, firstName: e.target.value })}
              className="rounded-lg border border-[#e0d0b8] px-3 py-2" />
            <input required placeholder="Sobrenome" value={cadastro.lastName}
              onChange={(e) => setCadastro({ ...cadastro, lastName: e.target.value })}
              className="rounded-lg border border-[#e0d0b8] px-3 py-2" />
            <input required type="email" placeholder="E-mail" value={cadastro.email}
              onChange={(e) => setCadastro({ ...cadastro, email: e.target.value })}
              className="rounded-lg border border-[#e0d0b8] px-3 py-2" />
            <input required placeholder="WhatsApp" value={cadastro.phone}
              onChange={(e) => setCadastro({ ...cadastro, phone: e.target.value })}
              className="rounded-lg border border-[#e0d0b8] px-3 py-2" />
            <input required placeholder="CPF" value={cadastro.documentNumber}
              onChange={(e) => setCadastro({ ...cadastro, documentNumber: e.target.value })}
              className="rounded-lg border border-[#e0d0b8] px-3 py-2 sm:col-span-2" />
          </div>
          <CameraCapture value={foto} onChange={setFoto} />
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={cadastro.aceitouPoliticas}
              onChange={(e) => setCadastro({ ...cadastro, aceitouPoliticas: e.target.checked })} />
            Li e aceito as{" "}
            <a className="underline" href="/politicas/hospedagem-e-regras">regras de hospedagem</a> e a{" "}
            <a className="underline" href="/politicas/privacidade">privacidade</a>.
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={cadastro.aceitouFoto}
              onChange={(e) => setCadastro({ ...cadastro, aceitouFoto: e.target.checked })} />
            Autorizo o uso da foto só para a portaria conferir a entrada, até 180 dias após a saída.
          </label>
          <p className="text-sm">
            Total a pagar (recalculado no servidor na confirmação):{" "}
            <strong>{formatMoney(escolha.total)}</strong>
          </p>
          <button
            type="submit"
            disabled={enviando}
            className="rounded-full bg-[#8b5a2b] px-7 py-3 font-semibold text-[#f6e3c4] disabled:opacity-50"
          >
            {enviando ? "Reservando…" : "Pagar com Pix ou cartão"}
          </button>
        </form>
      )}
    </section>
  );
}
