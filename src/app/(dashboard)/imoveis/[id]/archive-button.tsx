"use client";

import { Archive } from "lucide-react";
import { archivePropertyAction } from "@/lib/properties/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

/**
 * Arquivar pede confirmação porque some com o imóvel e todas as unidades
 * da operação de uma vez. Não é destrutivo (o histórico permanece), mas é
 * disruptivo o bastante para não acontecer por um clique errado.
 */
export function ArchivePropertyButton({
  propertyId,
  nome,
}: {
  propertyId: string;
  nome: string;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Archive />
          Arquivar
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Arquivar “{nome}”?</AlertDialogTitle>
          <AlertDialogDescription>
            O imóvel e todas as suas unidades saem da operação e deixam de
            aparecer em buscas de disponibilidade. As reservas e o histórico
            financeiro são preservados.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          {/* form dentro do diálogo: a action roda no servidor e
              redireciona; o botão é o submit dela. */}
          <form action={archivePropertyAction}>
            <input type="hidden" name="propertyId" value={propertyId} />
            <AlertDialogAction type="submit">Arquivar</AlertDialogAction>
          </form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
