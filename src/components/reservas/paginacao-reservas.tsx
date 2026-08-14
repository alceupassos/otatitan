import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

/**
 * Paginação da lista.
 *
 * Os links carregam a querystring atual inteira (menos `pagina`), senão
 * ir para a página 2 jogaria fora o filtro que o usuário acabou de aplicar.
 */

/** Janela de páginas ao redor da atual, com reticências nas pontas. */
function janela(pagina: number, paginas: number): (number | "…")[] {
  if (paginas <= 7) {
    return Array.from({ length: paginas }, (_, i) => i + 1);
  }

  const perto = new Set<number>([1, paginas, pagina]);
  if (pagina - 1 > 1) perto.add(pagina - 1);
  if (pagina + 1 < paginas) perto.add(pagina + 1);

  const ordenadas = [...perto].sort((a, b) => a - b);
  const saida: (number | "…")[] = [];
  let anterior = 0;
  for (const n of ordenadas) {
    if (anterior && n - anterior > 1) saida.push("…");
    saida.push(n);
    anterior = n;
  }
  return saida;
}

export function PaginacaoDeReservas({
  pagina,
  paginas,
  queryBase,
}: {
  pagina: number;
  paginas: number;
  /** Querystring já sem `pagina` (pode ser vazia). */
  queryBase: string;
}) {
  if (paginas <= 1) return null;

  const href = (n: number) =>
    `/reservas?${queryBase ? `${queryBase}&` : ""}pagina=${n}`;

  return (
    <Pagination>
      <PaginationContent>
        {pagina > 1 && (
          <PaginationItem>
            <PaginationPrevious href={href(pagina - 1)} text="Anterior" />
          </PaginationItem>
        )}

        {janela(pagina, paginas).map((n, i) =>
          n === "…" ? (
            <PaginationItem key={`elipse-${i}`}>
              <PaginationEllipsis />
            </PaginationItem>
          ) : (
            <PaginationItem key={n}>
              <PaginationLink href={href(n)} isActive={n === pagina}>
                {n}
              </PaginationLink>
            </PaginationItem>
          ),
        )}

        {pagina < paginas && (
          <PaginationItem>
            <PaginationNext href={href(pagina + 1)} text="Próxima" />
          </PaginationItem>
        )}
      </PaginationContent>
    </Pagination>
  );
}
