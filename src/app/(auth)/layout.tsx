import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-muted/40 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="font-heading text-2xl font-semibold tracking-tight">
            Otatitan
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Gestão de imóveis de temporada
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}
