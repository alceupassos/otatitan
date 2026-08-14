import { ListChecks } from "lucide-react";
import type {
  TaskPriority,
  TaskStatus,
  TaskType,
} from "@/generated/prisma/enums";
import { isRoleSlug, ROLE_LABELS } from "@/lib/rbac/roles";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Item, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { formatarInstante } from "./formato";
import {
  TAREFA_PRIORIDADE_LABELS,
  TAREFA_STATUS_LABELS,
  TAREFA_STATUS_VARIANTE,
  TAREFA_TIPO_LABELS,
} from "./rotulos";

export type TarefaDaReserva = {
  id: string;
  type: TaskType;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: Date | null;
  assignedRoleSlug: string | null;
  assignedToUserId: string | null;
  completedAt: Date | null;
};

/** Papel responsável, quando a tarefa foi endereçada a uma função e não a uma pessoa. */
function responsavel(slug: string | null): string | null {
  if (!slug) return null;
  return isRoleSlug(slug) ? ROLE_LABELS[slug] : slug;
}

/**
 * Tarefas operacionais geradas pela confirmação da reserva (RN-008):
 * limpeza, check-in, check-out.
 *
 * A lista fica vazia enquanto a reserva não é confirmada — e continua
 * vazia se a fila estiver fora do ar no momento da confirmação, porque o
 * enfileiramento é best-effort de propósito (uma reserva paga não é
 * desfeita porque o Redis caiu).
 */
export function TarefasDaReserva({ tarefas }: { tarefas: TarefaDaReserva[] }) {
  if (tarefas.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ListChecks />
          </EmptyMedia>
          <EmptyTitle>Nenhuma tarefa nesta reserva</EmptyTitle>
          <EmptyDescription>
            As tarefas de limpeza, check-in e check-out são criadas quando a
            reserva é confirmada.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="divide-y rounded-lg border">
      {tarefas.map((t) => {
        const papel = responsavel(t.assignedRoleSlug);
        return (
          <Item key={t.id} className="gap-3">
            <ItemContent>
              <ItemTitle>{t.title || TAREFA_TIPO_LABELS[t.type]}</ItemTitle>
              <ItemDescription>
                {[
                  TAREFA_TIPO_LABELS[t.type],
                  t.dueAt ? `prazo ${formatarInstante(t.dueAt)}` : null,
                  papel ? `responsável: ${papel}` : null,
                  t.priority === "HIGH" || t.priority === "URGENT"
                    ? `prioridade ${TAREFA_PRIORIDADE_LABELS[t.priority].toLowerCase()}`
                    : null,
                  t.completedAt ? `concluída em ${formatarInstante(t.completedAt)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </ItemDescription>
            </ItemContent>
            <Badge variant={TAREFA_STATUS_VARIANTE[t.status]}>
              {TAREFA_STATUS_LABELS[t.status]}
            </Badge>
          </Item>
        );
      })}
    </div>
  );
}
