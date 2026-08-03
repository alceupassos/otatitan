"use client";

import { useState } from "react";
import Link from "next/link";
import { liberarBloqueioAction } from "@/lib/availability/actions";
import { diaDaSemanaCurto, ehFimDeSemana, formatarData, parseDateOnly } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type OcupacaoDia = {
  data: string;
  blockId: string;
  origem: string;
  motivo: string | null;
  reserva: { id: string; code: string; hospede: string } | null;
  ehInicio: boolean;
  ehFim: boolean;
};

type Linha = {
  unitId: string;
  unitName: string;
  internalCode: string;
  propertyId: string;
  propertyName: string;
  ocupacao: Record<string, OcupacaoDia>;
};

const CORES: Record<string, string> = {
  RESERVATION: "bg-primary/85 text-primary-foreground",
  MAINTENANCE: "bg-amber-500/80 text-white",
  OWNER_STAY: "bg-violet-500/80 text-white",
  MANUAL: "bg-slate-500/80 text-white",
  CHANNEL_SYNC: "bg-sky-500/80 text-white",
};

const ORIGEM_LABELS: Record<string, string> = {
  RESERVATION: "Reserva",
  MAINTENANCE: "Manutenção",
  OWNER_STAY: "Uso do proprietário",
  MANUAL: "Bloqueio manual",
  CHANNEL_SYNC: "Sincronização de canal",
};

/**
 * Grade unidade × dia.
 *
 * Uma célula ocupada é um botão, não um `<div>`: quem navega por teclado
 * precisa alcançar o bloqueio para inspecioná-lo ou liberá-lo.
 */
export function GradeCalendario({
  linhas,
  dias,
  hoje,
  mes,
  podeLiberar,
}: {
  linhas: Linha[];
  dias: string[];
  hoje: string;
  mes: string;
  podeLiberar: boolean;
}) {
  const [selecionado, setSelecionado] = useState<OcupacaoDia | null>(null);

  return (
    <>
      <div className="rounded-lg border">
        {/* Rolagem só nesta caixa: a grade de 31 colunas não pode
            empurrar o body inteiro para o lado. */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th
                  scope="col"
                  className="sticky left-0 z-10 min-w-48 border-b border-r bg-background p-2 text-left font-medium"
                >
                  Unidade
                </th>
                {dias.map((d) => {
                  const data = parseDateOnly(d);
                  const fds = ehFimDeSemana(data);
                  return (
                    <th
                      key={d}
                      scope="col"
                      className={cn(
                        "w-8 border-b border-l p-1 text-center text-xs font-normal",
                        fds && "bg-muted/50",
                        d === hoje && "bg-primary/10 font-semibold",
                      )}
                    >
                      <div className="text-muted-foreground">
                        {diaDaSemanaCurto(data)}
                      </div>
                      <div>{data.getUTCDate()}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>

            <tbody>
              {linhas.map((l) => (
                <tr key={l.unitId}>
                  <th
                    scope="row"
                    className="sticky left-0 z-10 border-b border-r bg-background p-2 text-left font-normal"
                  >
                    <Link
                      href={`/imoveis/${l.propertyId}/unidades/${l.unitId}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {l.internalCode}
                    </Link>
                    <div className="truncate text-xs text-muted-foreground">
                      {l.propertyName}
                    </div>
                  </th>

                  {dias.map((d) => {
                    const oc = l.ocupacao[d];
                    const fds = ehFimDeSemana(parseDateOnly(d));

                    if (!oc) {
                      return (
                        <td
                          key={d}
                          className={cn(
                            "border-b border-l",
                            fds && "bg-muted/40",
                            d === hoje && "bg-primary/5",
                          )}
                        />
                      );
                    }

                    const rotulo = oc.reserva
                      ? `${oc.reserva.code} — ${oc.reserva.hospede}`
                      : (oc.motivo ?? ORIGEM_LABELS[oc.origem] ?? "Bloqueado");

                    return (
                      <td key={d} className="border-b border-l p-0">
                        <button
                          type="button"
                          onClick={() => setSelecionado(oc)}
                          title={`${formatarData(parseDateOnly(d))} — ${rotulo}`}
                          aria-label={`${formatarData(parseDateOnly(d))}, ${rotulo}`}
                          className={cn(
                            "h-9 w-full",
                            CORES[oc.origem] ?? "bg-muted",
                            // Arredonda só as pontas do bloco, para que
                            // dias contíguos leiam como uma faixa única.
                            oc.ehInicio && "rounded-l-sm",
                            oc.ehFim && "rounded-r-sm",
                          )}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        {Object.entries(ORIGEM_LABELS)
          .filter(([k]) => k !== "CHANNEL_SYNC")
          .map(([k, label]) => (
            <span key={k} className="flex items-center gap-1.5">
              <span className={cn("size-3 rounded-sm", CORES[k])} />
              {label}
            </span>
          ))}
      </div>

      <Dialog
        open={selecionado !== null}
        onOpenChange={(aberto) => !aberto && setSelecionado(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selecionado?.reserva
                ? `Reserva ${selecionado.reserva.code}`
                : (ORIGEM_LABELS[selecionado?.origem ?? ""] ?? "Bloqueio")}
            </DialogTitle>
            <DialogDescription>
              {selecionado?.reserva
                ? `Hóspede: ${selecionado.reserva.hospede}`
                : (selecionado?.motivo ?? "Sem observação registrada.")}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Fechar</Button>
            </DialogClose>

            {selecionado?.reserva ? (
              // Bloqueio de reserva não se libera pelo calendário (UC-041):
              // o caminho é cancelar a reserva.
              //
              // Sem link para /reservas/[id] enquanto essa tela não existe —
              // um botão que leva a 404 é pior que um aviso honesto. Virar
              // link quando o módulo de reservas entrar.
              <p className="text-xs text-muted-foreground">
                Datas ocupadas por reserva. Para liberá-las, cancele a
                reserva — remover só o bloqueio deixaria a reserva sem lugar.
              </p>
            ) : (
              podeLiberar && (
                <form action={liberarBloqueioAction}>
                  <input type="hidden" name="blockId" value={selecionado?.blockId ?? ""} />
                  <input type="hidden" name="mes" value={mes} />
                  <Button type="submit" variant="destructive">
                    Liberar datas
                  </Button>
                </form>
              )
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
