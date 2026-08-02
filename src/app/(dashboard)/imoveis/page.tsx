import type { Metadata } from "next";
import Link from "next/link";
import { AlertCircle, Building2, Plus, Search } from "lucide-react";
import { requireActorWith } from "@/lib/auth/session";
import { listProperties } from "@/lib/properties/queries";
import { ERRO_MENSAGENS } from "@/lib/properties/errors";
import {
  PROPERTY_STATUS_LABELS,
  PROPERTY_TYPE_LABELS,
} from "@/lib/properties/schemas";
import { contar } from "@/lib/plural";
import { hasPermission } from "@/lib/rbac/guard";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata: Metadata = { title: "Imóveis" };

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  ACTIVE: "default",
  DRAFT: "secondary",
  INACTIVE: "outline",
  ARCHIVED: "outline",
};

export default async function PropertiesPage({
  searchParams,
}: {
  searchParams: Promise<{ busca?: string; status?: string; erro?: string }>;
}) {
  const actor = await requireActorWith("properties.view");
  const params = await searchParams;

  const status =
    params.status && params.status in PROPERTY_STATUS_LABELS
      ? (params.status as keyof typeof PROPERTY_STATUS_LABELS)
      : undefined;

  const [properties, podeCriar] = await Promise.all([
    listProperties(actor, { busca: params.busca?.trim() || undefined, status }),
    hasPermission(actor, "properties.create"),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Imóveis
          </h1>
          <p className="text-sm text-muted-foreground">
            {properties.length === 0
              ? "Nenhum imóvel cadastrado."
              : `${contar(properties.length, "imóvel", "imóveis")}.`}
          </p>
        </div>

        {podeCriar && (
          <Button asChild>
            <Link href="/imoveis/novo">
              <Plus />
              Novo imóvel
            </Link>
          </Button>
        )}
      </div>

      {params.erro && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>
            {ERRO_MENSAGENS[params.erro] ?? "Não foi possível concluir a operação."}
          </AlertDescription>
        </Alert>
      )}

      {/* Formulário GET: o filtro fica na URL, então a busca é
          compartilhável e sobrevive ao recarregar a página. */}
      <form method="get" className="flex flex-wrap gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            name="busca"
            defaultValue={params.busca ?? ""}
            placeholder="Buscar por nome, cidade ou bairro"
            className="pl-9"
            aria-label="Buscar imóveis"
          />
        </div>
        <select
          name="status"
          defaultValue={params.status ?? ""}
          aria-label="Filtrar por situação"
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
        >
          <option value="">Todas as situações</option>
          {Object.entries(PROPERTY_STATUS_LABELS).map(([valor, rotulo]) => (
            <option key={valor} value={valor}>
              {rotulo}
            </option>
          ))}
        </select>
        <Button type="submit" variant="secondary">
          Filtrar
        </Button>
      </form>

      {properties.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Building2 className="size-8 text-muted-foreground" />
            <div>
              <p className="font-medium">
                {params.busca || params.status
                  ? "Nenhum imóvel corresponde ao filtro"
                  : "Nenhum imóvel cadastrado ainda"}
              </p>
              <p className="text-sm text-muted-foreground">
                {params.busca || params.status
                  ? "Ajuste a busca ou limpe os filtros."
                  : "Cadastre o primeiro para começar a receber reservas."}
              </p>
            </div>
            {podeCriar && !params.busca && !params.status && (
              <Button asChild>
                <Link href="/imoveis/novo">
                  <Plus />
                  Cadastrar imóvel
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Localização</TableHead>
                <TableHead className="text-right">Unidades</TableHead>
                <TableHead>Situação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {properties.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link
                      href={`/imoveis/${p.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {p.name}
                    </Link>
                    {p.owner && (
                      <div className="text-xs text-muted-foreground">
                        {p.owner.name}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {PROPERTY_TYPE_LABELS[p.type]}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {[p.neighborhood, p.city, p.state].filter(Boolean).join(", ") || "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p._count.units}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[p.status] ?? "outline"}>
                      {PROPERTY_STATUS_LABELS[p.status]}
                    </Badge>
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
