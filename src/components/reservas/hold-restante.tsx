"use client";

import { useEffect, useState } from "react";
import { Clock, TimerOff } from "lucide-react";
import { MINUTOS_DE_HOLD } from "@/lib/reservations/estados";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { formatarContagem } from "./formato";

/**
 * Quanto falta para o hold da reserva PENDING expirar (RN-004).
 *
 * É a informação que decide a ação do operador: um hold vencendo em três
 * minutos é uma venda prestes a se perder, e "pendente" sozinho não conta
 * essa história. Por isso o relógio corre na tela em vez de mostrar um
 * horário fixo que o usuário teria de subtrair de cabeça.
 *
 * O valor inicial vem calculado do servidor (`restanteSegundos`) e é o
 * mesmo na primeira renderização do cliente — é o que mantém a hidratação
 * sem divergência. A partir daí o tique usa uma âncora no relógio LOCAL
 * (`fim`), para o contador não acumular desvio a cada segundo.
 */
const AVISO_SEGUNDOS = 5 * 60;

export function HoldRestante({
  restanteSegundos,
  className,
}: {
  restanteSegundos: number;
  className?: string;
}) {
  const [restante, setRestante] = useState(restanteSegundos);

  // Ajuste durante o render: quando a página revalida (depois de uma
  // ação), o servidor manda um valor novo e o contador reinicia dele.
  const [ultimoDoServidor, setUltimoDoServidor] = useState(restanteSegundos);
  if (ultimoDoServidor !== restanteSegundos) {
    setUltimoDoServidor(restanteSegundos);
    setRestante(restanteSegundos);
  }

  useEffect(() => {
    if (restanteSegundos <= 0) return;

    const fim = Date.now() + restanteSegundos * 1000;
    const id = setInterval(() => {
      setRestante(Math.max(0, Math.round((fim - Date.now()) / 1000)));
    }, 1000);
    return () => clearInterval(id);
  }, [restanteSegundos]);

  if (restante <= 0) {
    return (
      <Badge
        variant="destructive"
        className={cn("gap-1", className)}
        title={
          "O prazo de retenção acabou. O worker de expiração libera as " +
          "datas e cancela a reserva; até lá ela ainda aparece como pendente."
        }
      >
        <TimerOff className="size-3" />
        Hold vencido
      </Badge>
    );
  }

  const urgente = restante <= AVISO_SEGUNDOS;

  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 tabular-nums",
        urgente
          ? "border-destructive/40 text-destructive"
          : "border-amber-500/40 text-amber-700 dark:text-amber-400",
        className,
      )}
      title={`A reserva retém a unidade por ${MINUTOS_DE_HOLD} minutos após a criação (RN-004).`}
    >
      <Clock className="size-3" />
      Expira em {formatarContagem(restante)}
    </Badge>
  );
}
