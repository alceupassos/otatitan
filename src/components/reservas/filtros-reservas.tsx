import Link from "next/link";
import { Search, X } from "lucide-react";
import type { ReservationStatus } from "@/generated/prisma/enums";
import { STATUS_CURTO } from "@/lib/reservations/estados";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type ValoresDoFiltro = {
  busca: string;
  status: string;
  propertyId: string;
  de: string;
  ate: string;
  ordem: string;
};

/**
 * Filtros da lista, num formulário GET.
 *
 * O estado do filtro fica na URL — e não em `useState` — porque assim a
 * busca é compartilhável, sobrevive ao recarregar e volta inteira pelo
 * botão-voltar do navegador. Mesmo padrão da tela de imóveis.
 *
 * `pagina` NÃO é reenviada de propósito: mudar o filtro e continuar na
 * página 4 costuma cair num vazio que parece defeito.
 */
export function FiltrosDeReservas({
  valores,
  imoveis,
  statusDisponiveis,
  temFiltro,
}: {
  valores: ValoresDoFiltro;
  imoveis: { id: string; name: string }[];
  statusDisponiveis: readonly ReservationStatus[];
  temFiltro: boolean;
}) {
  const classeSelect =
    "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs";

  return (
    <form
      method="get"
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(14rem,2fr)_repeat(4,minmax(9rem,1fr))_auto]"
    >
      <div className="space-y-1.5">
        <Label htmlFor="busca">Buscar</Label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="busca"
            name="busca"
            defaultValue={valores.busca}
            placeholder="Código ou nome do hóspede"
            className="pl-9"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="status">Situação</Label>
        <select
          id="status"
          name="status"
          defaultValue={valores.status}
          className={classeSelect}
        >
          <option value="">Todas</option>
          {statusDisponiveis.map((s) => (
            <option key={s} value={s}>
              {STATUS_CURTO[s]}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="propertyId">Imóvel</Label>
        <select
          id="propertyId"
          name="propertyId"
          defaultValue={valores.propertyId}
          className={classeSelect}
          disabled={imoveis.length === 0}
        >
          <option value="">Todos</option>
          {imoveis.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
      </div>

      {/* Período por SOBREPOSIÇÃO: "o que tenho em março" inclui a estadia
          que começou em fevereiro e ainda está em curso. */}
      <div className="space-y-1.5">
        <Label htmlFor="de">Estadias a partir de</Label>
        <Input id="de" name="de" type="date" defaultValue={valores.de} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="ate">até</Label>
        <Input id="ate" name="ate" type="date" defaultValue={valores.ate} />
      </div>

      <div className="flex items-end gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="ordem">Ordem</Label>
          <select
            id="ordem"
            name="ordem"
            defaultValue={valores.ordem}
            className={classeSelect}
          >
            <option value="recentes">Mais recentes</option>
            <option value="chegada">Próximas chegadas</option>
          </select>
        </div>

        <Button type="submit" variant="secondary">
          Filtrar
        </Button>

        {temFiltro && (
          <Button asChild variant="ghost">
            <Link href="/reservas">
              <X />
              Limpar
            </Link>
          </Button>
        )}
      </div>
    </form>
  );
}
