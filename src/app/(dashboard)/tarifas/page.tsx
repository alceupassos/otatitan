import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Tag } from "lucide-react";
import { requireActorWith } from "@/lib/auth/session";
import { formatarData, hojeUtc, parseDateOnly } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { listUnidadesComTarifa } from "@/lib/rates/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata: Metadata = { title: "Tarifas" };

export default async function TarifasPage() {
  const actor = await requireActorWith("rates.view");
  const unidades = await listUnidadesComTarifa(actor, hojeUtc());

  const semPlano = unidades.filter((u) => u.planoPadrao === null).length;
  const comLacuna = unidades.filter(
    (u) => u.planoPadrao !== null && u.primeiraLacuna !== null,
  ).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Tarifas
        </h1>
        <p className="text-sm text-muted-foreground">
          Uma noite sem tarifa publicada fica indisponível para venda — nunca
          é tratada como grátis.
        </p>
      </div>

      {(semPlano > 0 || comLacuna > 0) && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex items-start gap-3 py-4 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <div className="space-y-1">
              {semPlano > 0 && (
                <p>
                  <strong>
                    {semPlano === 1
                      ? "1 unidade sem plano de tarifa ativo"
                      : `${semPlano} unidades sem plano de tarifa ativo`}
                  </strong>{" "}
                  — não podem receber reserva.
                </p>
              )}
              {comLacuna > 0 && (
                <p>
                  {comLacuna === 1
                    ? "1 unidade tem dias sem tarifa"
                    : `${comLacuna} unidades têm dias sem tarifa`}{" "}
                  nos próximos 90 dias.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {unidades.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Tag className="size-8 text-muted-foreground" />
            <div>
              <p className="font-medium">Nenhuma unidade cadastrada</p>
              <p className="text-sm text-muted-foreground">
                Tarifa é sempre por unidade. Cadastre uma primeiro.
              </p>
            </div>
            <Button asChild>
              <Link href="/imoveis">Ir para imóveis</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Unidade</TableHead>
                <TableHead>Plano padrão</TableHead>
                <TableHead className="text-right">Diária base</TableHead>
                <TableHead>Cobertura (90 dias)</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {unidades.map((u) => (
                <TableRow key={u.unitId}>
                  <TableCell>
                    <Link
                      href={`/tarifas/${u.unitId}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {u.internalCode}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {u.propertyName}
                    </div>
                  </TableCell>

                  <TableCell>
                    {u.planoPadrao ? (
                      <span className="text-sm">{u.planoPadrao.name}</span>
                    ) : (
                      <Badge variant="destructive">Sem plano ativo</Badge>
                    )}
                  </TableCell>

                  <TableCell className="text-right tabular-nums">
                    {u.baseRateCents === null
                      ? "—"
                      : formatMoney(u.baseRateCents, u.currency)}
                  </TableCell>

                  <TableCell>
                    <div className="text-sm tabular-nums">{u.diasCobertos} / 90</div>
                    {u.primeiraLacuna && (
                      <div className="text-xs text-amber-600">
                        1ª lacuna: {formatarData(parseDateOnly(u.primeiraLacuna))}
                      </div>
                    )}
                  </TableCell>

                  <TableCell className="text-right">
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/tarifas/${u.unitId}`}>Gerenciar</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
