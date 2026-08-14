import type { ReservationStatus } from "@/generated/prisma/enums";
import { STATUS_CURTO, STATUS_LABELS } from "@/lib/reservations/estados";
import { Badge } from "@/components/ui/badge";
import { STATUS_VARIANTE } from "./rotulos";

/**
 * Selo de status da reserva.
 *
 * O texto vem de `STATUS_CURTO` (`estados.ts`), nunca redigitado: a
 * máquina de estados é a dona dos nomes, e um segundo mapa de rótulos
 * acabaria divergindo dela na primeira mudança.
 */
export function StatusReserva({
  status,
  className,
}: {
  status: ReservationStatus;
  className?: string;
}) {
  return (
    <Badge
      variant={STATUS_VARIANTE[status]}
      className={className}
      title={`Reserva ${STATUS_LABELS[status]}`}
    >
      {STATUS_CURTO[status]}
    </Badge>
  );
}
