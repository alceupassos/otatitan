import Link from "next/link";
import type { Metadata } from "next";
import { CheckCircle2, Clock, Undo2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Retorno do checkout hospedado — a página que o pagador vê depois de sair
 * do provedor.
 *
 * DUAS DECISÕES DE PROJETO, as duas por segurança:
 *
 * 1. **Nenhum acesso ao banco.** O mesmo link pode terminar com o operador
 *    (que o abriu) ou com o hóspede (a quem ele foi repassado), e esta rota
 *    é pública. Buscar a reserva pelo id da URL exporia nome de hóspede,
 *    datas e valores a quem tivesse só o identificador — e responder
 *    "reserva não encontrada" para um id inválido já seria um oráculo de
 *    quais reservas existem. Como a página não consulta nada, não há o que
 *    vazar nem o que enumerar (docs/11-seguranca-lgpd.md).
 *
 * 2. **Não afirma que o pagamento foi confirmado.** Quem confirma é o
 *    webhook, que chega por outro caminho e pode demorar — no pix são
 *    segundos, mas nada garante a ordem. Dizer "pagamento confirmado" aqui
 *    seria afirmar como certo algo que ainda não aconteceu no nosso lado, e
 *    é justamente a informação que o hóspede usaria para não pagar de novo.
 *    O texto fala do que de fato ocorreu: ele voltou do provedor.
 *
 * Por isso a página não recebe (nem precisa de) dados da reserva. O
 * `estado` na querystring só escolhe o texto; adulterá-lo troca uma
 * mensagem tranquilizadora por outra, sem efeito nenhum.
 */

export const metadata: Metadata = {
  title: "Pagamento",
};

type Params = {
  searchParams: Promise<{ estado?: string; r?: string }>;
};

export default async function RetornoDoPagamentoPage({ searchParams }: Params) {
  const { estado, r } = await searchParams;
  const concluido = estado !== "cancelado";

  return (
    <Card>
      <CardHeader>
        <div
          className={
            concluido
              ? "flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary"
              : "flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground"
          }
        >
          {concluido ? <CheckCircle2 /> : <Undo2 />}
        </div>
        <CardTitle className="mt-4">
          {concluido
            ? "Recebemos seu pagamento"
            : "Pagamento não concluído"}
        </CardTitle>
        <CardDescription>
          {concluido
            ? "Você voltou da tela de pagamento. A confirmação da reserva chega por e-mail assim que a operadora liberar o valor."
            : "Você saiu da tela de pagamento antes de concluir. Sua reserva continua aguardando — mas só por um tempo."}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4 text-sm text-muted-foreground">
        {concluido ? (
          <p className="flex gap-2">
            <Clock className="mt-0.5 size-4 shrink-0" />
            <span>
              Não é preciso pagar de novo. Se algo tiver falhado, avisamos pelo
              mesmo e-mail — e nenhuma cobrança é feita duas vezes.
            </span>
          </p>
        ) : (
          <p className="flex gap-2">
            <Clock className="mt-0.5 size-4 shrink-0" />
            <span>
              As datas ficam reservadas por tempo limitado. Passado esse prazo,
              elas voltam ao calendário e podem ser vendidas para outra pessoa.
              Para retomar, use o mesmo link de pagamento ou fale com quem
              cuida do imóvel.
            </span>
          </p>
        )}

        {/*
          O operador que abriu a cobrança também cai aqui. Este atalho leva
          ao painel; para o hóspede é só um link que pede login, e por isso
          está rotulado de forma a ele saber que não é para si. O id já veio
          na URL dele — o link não revela nada novo.
        */}
        {r && (
          <p className="border-t pt-4 text-xs">
            É da equipe?{" "}
            <Link
              href={`/reservas/${r}`}
              className="font-medium text-foreground underline underline-offset-4"
            >
              Abrir esta reserva no painel
            </Link>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
