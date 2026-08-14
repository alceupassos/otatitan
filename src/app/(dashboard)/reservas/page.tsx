import type { Metadata } from "next";
import Link from "next/link";
import { CalendarRange, Plus, SearchX } from "lucide-react";
import { requireActorWith } from "@/lib/auth/session";
import { toDateOnly } from "@/lib/dates";
import { contar } from "@/lib/plural";
import { listProperties } from "@/lib/properties/queries";
import { hasPermission } from "@/lib/rbac/guard";
import { listarReservas } from "@/lib/reservations/queries";
import {
  filtroReservasSchema,
  STATUS_RESERVA,
} from "@/lib/reservations/schemas";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { agoraDoRender } from "@/components/reservas/agora";
import { FiltrosDeReservas } from "@/components/reservas/filtros-reservas";
import { PaginacaoDeReservas } from "@/components/reservas/paginacao-reservas";
import { TabelaDeReservas } from "@/components/reservas/tabela-reservas";

export const metadata: Metadata = { title: "Reservas" };

/** Querystring pode repetir chave (`?status=A&status=B`); vale a primeira. */
function primeiro(valor: string | string[] | undefined): string {
  if (Array.isArray(valor)) return valor[0] ?? "";
  return valor ?? "";
}

export default async function ReservasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireActorWith("reservations.view");
  const params = await searchParams;

  // Filtro inválido na URL (link antigo, usuário editando à mão) não pode
  // derrubar a tela de reservas: cai no padrão e mostra a lista.
  const analisado = filtroReservasSchema.safeParse(
    Object.fromEntries(
      Object.entries(params).map(([chave, valor]) => [chave, primeiro(valor)]),
    ),
  );
  const filtros = analisado.success
    ? analisado.data
    : filtroReservasSchema.parse({});

  // Um instante só para a tela inteira — ver `TabelaDeReservas`.
  const agoraMs = agoraDoRender();

  // A lista de imóveis do filtro é dado de imóvel, não de reserva: quem não
  // tem `properties.view` continua vendo as próprias reservas, só não ganha
  // o seletor.
  const podeVerImoveis = await hasPermission(actor, "properties.view");

  const [pagina, imoveis, podeCriar] = await Promise.all([
    listarReservas(actor, filtros),
    podeVerImoveis ? listProperties(actor) : Promise.resolve([]),
    hasPermission(actor, "reservations.create"),
  ]);

  // Querystring canônica (sem `pagina`) para os links de paginação.
  const qs = new URLSearchParams();
  if (filtros.busca) qs.set("busca", filtros.busca);
  if (filtros.status.length > 0) qs.set("status", filtros.status.join(","));
  if (filtros.propertyId) qs.set("propertyId", filtros.propertyId);
  if (filtros.de) qs.set("de", toDateOnly(filtros.de));
  if (filtros.ate) qs.set("ate", toDateOnly(filtros.ate));
  if (filtros.ordem !== "recentes") qs.set("ordem", filtros.ordem);

  // "Ordem" não estreita a lista, então não conta como filtro: trocar de
  // ordenação nunca deve produzir a mensagem de "nada encontrado".
  const temFiltro =
    filtros.busca !== null ||
    filtros.status.length > 0 ||
    filtros.propertyId !== null ||
    filtros.de !== null ||
    filtros.ate !== null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Reservas
          </h1>
          <p className="text-sm text-muted-foreground">
            {pagina.total === 0
              ? "Nenhuma reserva encontrada."
              : `${contar(pagina.total, "reserva")}.`}
          </p>
        </div>

        {podeCriar && (
          <Button asChild>
            <Link href="/reservas/nova">
              <Plus />
              Nova reserva
            </Link>
          </Button>
        )}
      </div>

      <FiltrosDeReservas
        valores={{
          busca: filtros.busca ?? "",
          status: filtros.status.join(","),
          propertyId: filtros.propertyId ?? "",
          de: filtros.de ? toDateOnly(filtros.de) : "",
          ate: filtros.ate ? toDateOnly(filtros.ate) : "",
          ordem: filtros.ordem,
        }}
        imoveis={imoveis.map((i) => ({ id: i.id, name: i.name }))}
        statusDisponiveis={STATUS_RESERVA}
        temFiltro={temFiltro}
      />

      {pagina.total === 0 ? (
        <Card>
          <CardContent className="py-6">
            {temFiltro ? (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <SearchX />
                  </EmptyMedia>
                  <EmptyTitle>Nenhuma reserva com esses filtros</EmptyTitle>
                  <EmptyDescription>
                    O período é filtrado por sobreposição: uma estadia que
                    começou antes da data inicial ainda aparece. Amplie as
                    datas ou limpe os filtros.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button asChild variant="outline">
                    <Link href="/reservas">Limpar filtros</Link>
                  </Button>
                </EmptyContent>
              </Empty>
            ) : (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <CalendarRange />
                  </EmptyMedia>
                  <EmptyTitle>Nenhuma reserva ainda</EmptyTitle>
                  <EmptyDescription>
                    Toda reserva nasce segurando a unidade por 30 minutos até o
                    pagamento; é a partir daí que o calendário e as tarefas da
                    equipe se movem.
                  </EmptyDescription>
                </EmptyHeader>
                {podeCriar && (
                  <EmptyContent>
                    <Button asChild>
                      <Link href="/reservas/nova">
                        <Plus />
                        Lançar a primeira reserva
                      </Link>
                    </Button>
                  </EmptyContent>
                )}
              </Empty>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          {pagina.itens.length > 0 ? (
            <Card>
              <TabelaDeReservas itens={pagina.itens} agoraMs={agoraMs} />
            </Card>
          ) : (
            // Página fora do intervalo (link antigo, filtro que encolheu o
            // resultado): há reservas, só não nesta página.
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Esta página não tem resultados para o filtro atual.{" "}
                <Link
                  href={`/reservas${qs.toString() ? `?${qs.toString()}` : ""}`}
                  className="underline underline-offset-4"
                >
                  Voltar à primeira página
                </Link>
                .
              </CardContent>
            </Card>
          )}

          <PaginacaoDeReservas
            pagina={pagina.pagina}
            paginas={pagina.paginas}
            queryBase={qs.toString()}
          />
        </>
      )}
    </div>
  );
}
