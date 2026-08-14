"use client";

import { useRef, useState, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { AlertCircle, Search, UserCheck, X } from "lucide-react";
import type { z } from "zod";
import type { HospedeResumo } from "@/lib/guests/queries";
import {
  hospedeSchema,
  TIPO_DOCUMENTO_LABELS,
  TIPOS_DOCUMENTO,
} from "@/lib/guests/schemas";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { buscarHospedesAction } from "./actions";
import {
  HOSPEDE_VAZIO,
  type HospedeEscolhido,
  type HospedeValores,
} from "./tipos";

/**
 * Passo 3 — quem se hospeda.
 *
 * O autocomplete existe porque hóspede recorrente é a regra, não a
 * exceção: reaproveitar a ficha evita um cadastro duplicado a cada
 * estadia. Mas quem decide reaproveitar é o servidor, em
 * `encontrarOuCriarHospede`, e o critério dele é o E-MAIL — por isso a
 * seleção aqui PREENCHE o formulário em vez de mandar um id adiante.
 */

/** Entrada do schema: tudo em `string`, como os inputs produzem. */
type ValoresFicha = z.input<typeof hospedeSchema>;

/** Espera entre a última tecla e a consulta ao servidor. */
const ATRASO_BUSCA_MS = 300;

function paraValores(v: ValoresFicha): HospedeValores {
  return {
    firstName: v.firstName ?? "",
    lastName: v.lastName ?? "",
    email: v.email ?? "",
    phone: v.phone ?? "",
    documentType: v.documentType ?? "",
    documentNumber: v.documentNumber ?? "",
    birthDate: v.birthDate ?? "",
    nationality: v.nationality ?? "",
    country: v.country ?? "BR",
    notes: v.notes ?? "",
    marketingOptIn: v.marketingOptIn === true,
  };
}

export function PassoHospede({
  valoresIniciais,
  escolhidoInicial,
  onConcluiu,
}: {
  valoresIniciais: HospedeValores;
  escolhidoInicial: HospedeEscolhido | null;
  onConcluiu: (valores: HospedeValores, escolhido: HospedeEscolhido | null) => void;
}) {
  const [termo, setTermo] = useState("");
  const [sugestoes, setSugestoes] = useState<HospedeResumo[]>([]);
  const [erroBusca, setErroBusca] = useState<string | null>(null);
  const [escolhido, setEscolhido] = useState<HospedeEscolhido | null>(
    escolhidoInicial,
  );
  const [buscando, startBusca] = useTransition();

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jaAbriu = useRef(false);

  const form = useForm<ValoresFicha, unknown, z.output<typeof hospedeSchema>>({
    resolver: zodResolver(hospedeSchema),
    defaultValues: valoresIniciais,
  });

  /**
   * Uma consulta por pausa de digitação. Sem o atraso, cada tecla vira uma
   * ida ao banco e as respostas chegam fora de ordem.
   */
  function agendarBusca(valor: string) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      startBusca(async () => {
        const resposta = await buscarHospedesAction(valor);
        if (resposta.ok) {
          setSugestoes(resposta.hospedes);
          setErroBusca(null);
        } else {
          setSugestoes([]);
          setErroBusca(resposta.error);
        }
      });
    }, ATRASO_BUSCA_MS);
  }

  function escolher(h: HospedeResumo) {
    form.setValue("firstName", h.firstName, { shouldValidate: true });
    form.setValue("lastName", h.lastName, { shouldValidate: true });
    form.setValue("email", h.email ?? "");
    form.setValue("phone", h.phone ?? "");
    form.setValue("country", h.country);
    // O documento não volta: só os 4 últimos dígitos existem em claro (o
    // número está cifrado, docs/11-seguranca-lgpd.md) e `hospedeSchema`
    // exige tipo E número juntos. Reenviar meio documento invalidaria a
    // ficha; o cadastro existente segue com o dele.
    form.setValue("documentType", "");
    form.setValue("documentNumber", "");

    setEscolhido({
      id: h.id,
      nome: h.nome,
      email: h.email,
      documentLast4: h.documentLast4,
    });
    setSugestoes([]);
    setTermo("");
  }

  function limparEscolha() {
    setEscolhido(null);
    form.reset(HOSPEDE_VAZIO);
  }

  const enviar = form.handleSubmit(() => {
    onConcluiu(paraValores(form.getValues()), escolhido);
  });

  const erroDe = (campo: keyof ValoresFicha) =>
    form.formState.errors[campo]?.message;

  return (
    <form onSubmit={enviar} className="space-y-6" noValidate>
      {/* ── Autocomplete ────────────────────────────────────────────── */}
      <div className="space-y-2">
        <Label htmlFor="buscaHospede">Buscar hóspede já cadastrado</Label>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="buscaHospede"
            className="pl-9"
            autoComplete="off"
            placeholder="Nome, e-mail, telefone ou final do documento"
            value={termo}
            onChange={(e) => {
              setTermo(e.target.value);
              agendarBusca(e.target.value);
            }}
            onFocus={() => {
              // Abrir o campo já com os últimos atendidos resolve boa
              // parte dos casos sem ninguém digitar nada.
              if (jaAbriu.current) return;
              jaAbriu.current = true;
              agendarBusca("");
            }}
          />
          {buscando && (
            <Spinner className="absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
          )}
        </div>

        {erroBusca && (
          <p className="text-xs text-muted-foreground" role="status">
            {erroBusca}
          </p>
        )}

        {sugestoes.length > 0 && (
          <ul className="max-h-64 divide-y overflow-y-auto rounded-md border">
            {sugestoes.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  onClick={() => escolher(h)}
                  className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-accent"
                >
                  <span className="font-medium">{h.nome}</span>
                  <span className="text-xs text-muted-foreground">
                    {[
                      h.email,
                      h.phone,
                      h.documentLast4 && `documento •••${h.documentLast4}`,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "sem contato cadastrado"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {escolhido && (
        <Alert>
          <UserCheck />
          <AlertDescription>
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <span>
                Usando o cadastro de <strong>{escolhido.nome}</strong>
                {escolhido.documentLast4 &&
                  ` · documento •••${escolhido.documentLast4} já registrado`}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={limparEscolha}
              >
                <X />
                Limpar
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* O reaproveitamento da ficha é feito pelo e-mail. Sem ele, a reserva
          criaria um segundo cadastro da mesma pessoa — e o operador precisa
          saber disso antes, não depois. */}
      {escolhido && !escolhido.email && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>
            Este cadastro não tem e-mail. Sem e-mail, a reserva criará uma
            ficha nova em vez de reaproveitar esta. Informe um e-mail abaixo
            para uni-las.
          </AlertDescription>
        </Alert>
      )}

      {/* ── Ficha ───────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="firstName">Nome</Label>
          <Input id="firstName" {...form.register("firstName")} />
          <Erro mensagem={erroDe("firstName")} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="lastName">Sobrenome</Label>
          <Input id="lastName" {...form.register("lastName")} />
          <Erro mensagem={erroDe("lastName")} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">E-mail</Label>
          <Input id="email" type="email" {...form.register("email")} />
          <p className="text-xs text-muted-foreground">
            É o e-mail que identifica um hóspede recorrente: se já existir,
            a ficha é reaproveitada e só o que estiver em branco é
            preenchido.
          </p>
          <Erro mensagem={erroDe("email")} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="phone">Telefone</Label>
          <Input
            id="phone"
            inputMode="tel"
            placeholder="(21) 99999-1234"
            {...form.register("phone")}
          />
          <Erro mensagem={erroDe("phone")} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="documentType">Tipo de documento</Label>
          <select
            id="documentType"
            {...form.register("documentType")}
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
          >
            <option value="">Não informar</option>
            {TIPOS_DOCUMENTO.map((t) => (
              <option key={t} value={t}>
                {TIPO_DOCUMENTO_LABELS[t]}
              </option>
            ))}
          </select>
          <Erro mensagem={erroDe("documentType")} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="documentNumber">Número do documento</Label>
          <Input
            id="documentNumber"
            autoComplete="off"
            {...form.register("documentNumber")}
          />
          <Erro mensagem={erroDe("documentNumber")} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="birthDate">Nascimento</Label>
          <Input id="birthDate" type="date" {...form.register("birthDate")} />
          <Erro mensagem={erroDe("birthDate")} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="nationality">Nacionalidade</Label>
            <Input id="nationality" {...form.register("nationality")} />
            <Erro mensagem={erroDe("nationality")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="country">País</Label>
            <Input
              id="country"
              maxLength={2}
              placeholder="BR"
              {...form.register("country")}
            />
            <Erro mensagem={erroDe("country")} />
          </div>
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="notes">Observações sobre o hóspede</Label>
          <Textarea id="notes" rows={2} {...form.register("notes")} />
          <Erro mensagem={erroDe("notes")} />
        </div>

        <div className="sm:col-span-2">
          <Controller
            control={form.control}
            name="marketingOptIn"
            render={({ field }) => (
              <label
                htmlFor="marketingOptIn"
                className="flex items-start gap-2 text-sm"
              >
                <Checkbox
                  id="marketingOptIn"
                  checked={field.value === true}
                  onCheckedChange={(v) => field.onChange(v === true)}
                />
                {/* LGPD, art. 8º: consentimento é ato explícito. Nunca vem
                    marcado nem é herdado de outra finalidade. */}
                <span>
                  O hóspede autorizou receber comunicações de marketing.
                </span>
              </label>
            )}
          />
        </div>
      </div>

      <Button type="submit">Continuar para a confirmação</Button>
    </form>
  );
}

function Erro({ mensagem }: { mensagem?: string }) {
  if (!mensagem) return null;
  return (
    <p className="text-xs text-destructive" role="alert">
      {mensagem}
    </p>
  );
}
