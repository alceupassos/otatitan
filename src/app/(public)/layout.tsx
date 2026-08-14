import type { ReactNode } from "react";

/**
 * Páginas alcançáveis SEM sessão (ver `PUBLIC_PREFIXES` em
 * `src/lib/auth/routes.ts`). O público aqui é o hóspede, não a equipe —
 * por isso não há navegação do painel, seletor de empresa nem qualquer
 * elemento que pressuponha alguém logado.
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-muted/40 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <p className="font-heading text-2xl font-semibold tracking-tight">
            Otatitan
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Aluguel por temporada
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}
