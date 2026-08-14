"use client";

import { useState, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { AlertCircle, Search } from "lucide-react";
import type { z } from "zod";
import { buscaSchema } from "@/lib/pricing/schemas";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import {
  buscarDisponibilidadeAction,
  type ResultadoBuscaUI,
  type ValoresBusca,
} from "./actions";

/**
 * Passo 1 — período, imóvel e número de hóspedes.
 *
 * A validação usa `buscaSchema`, o MESMO schema que a server action aplica
 * do outro lado (RN-003 vale para o preço, mas o princípio é o mesmo aqui:
 * o cliente não é fonte de verdade). Validar no navegador serve para o
 * operador não esperar uma ida ao servidor para descobrir que a saída está
 * antes da entrada.
 */

/** A entrada do schema é toda em `string` — é o que os inputs produzem. */
type ValoresFormulario = z.input<typeof buscaSchema>;

const CAMPOS = ["checkIn", "checkOut", "hospedes", "propertyId"] as const;

export function PassoBusca({
  imoveis,
  valoresIniciais,
  onBuscou,
}: {
  imoveis: { id: string; name: string }[];
  valoresIniciais: ValoresBusca;
  onBuscou: (valores: ValoresBusca, resultado: ResultadoBuscaUI) => void;
}) {
  const [pendente, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  const form = useForm<ValoresFormulario, unknown, z.output<typeof buscaSchema>>({
    resolver: zodResolver(buscaSchema),
    defaultValues: valoresIniciais,
  });

  const enviar = form.handleSubmit(() => {
    // O schema já disse que os valores são válidos; ao servidor vão as
    // strings cruas, para ele reparsear com o mesmo schema em vez de
    // confiar numa conversão feita aqui.
    const valores = form.getValues() as ValoresBusca;
    setErro(null);

    startTransition(async () => {
      const resposta = await buscarDisponibilidadeAction(valores);
      if (!resposta.ok) {
        for (const campo of CAMPOS) {
          const msgs = resposta.fieldErrors?.[campo];
          if (msgs?.length) form.setError(campo, { message: msgs.join(" ") });
        }
        setErro(resposta.error ?? null);
        return;
      }
      onBuscou(valores, resposta.resultado);
    });
  });

  const erroDe = (campo: (typeof CAMPOS)[number]) =>
    form.formState.errors[campo]?.message;

  return (
    <form onSubmit={enviar} className="space-y-4" noValidate>
      {erro && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{erro}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-2">
          <Label htmlFor="checkIn">Entrada</Label>
          <Input id="checkIn" type="date" {...form.register("checkIn")} />
          <Erro mensagem={erroDe("checkIn")} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="checkOut">Saída</Label>
          <Input id="checkOut" type="date" {...form.register("checkOut")} />
          <Erro mensagem={erroDe("checkOut")} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="hospedes">Hóspedes</Label>
          <Input
            id="hospedes"
            type="number"
            min={1}
            inputMode="numeric"
            {...form.register("hospedes")}
          />
          {/* Bebês não contam contra a lotação da unidade e são informados
              na confirmação, junto com a divisão adultos/crianças. */}
          <p className="text-xs text-muted-foreground">Adultos e crianças.</p>
          <Erro mensagem={erroDe("hospedes")} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="propertyId">Imóvel</Label>
          <select
            id="propertyId"
            {...form.register("propertyId")}
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
          >
            <option value="">Todos os imóveis</option>
            {imoveis.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
          <Erro mensagem={erroDe("propertyId")} />
        </div>
      </div>

      <Button type="submit" disabled={pendente}>
        {pendente ? <Spinner /> : <Search />}
        Buscar disponibilidade
      </Button>
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
