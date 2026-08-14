import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Ban,
  Banknote,
  ChevronLeft,
  Link as LinkIcon,
  Mail,
  Phone,
} from "lucide-react";
import { requireActorWith } from "@/lib/auth/session";
import { formatarData } from "@/lib/dates";
import { TIPO_DOCUMENTO_LABELS } from "@/lib/guests/schemas";
import { formatMoney } from "@/lib/money";
import { contar } from "@/lib/plural";
import { hasPermission } from "@/lib/rbac/guard";
import { obterReserva } from "@/lib/reservations/queries";
import {
  INTENCOES_PAGAMENTO,
  MEIOS_PAGAMENTO_MANUAL,
  MEIO_PAGAMENTO_LABELS,
  ORIGEM_LABELS,
} from "@/lib/reservations/schemas";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AcoesReserva } from "@/components/reservas/acoes-reserva";
import { agoraDoRender } from "@/components/reservas/agora";
import { formatarInstante } from "@/components/reservas/formato";
import { HoldRestante } from "@/components/reservas/hold-restante";
import { PagamentosDaReserva } from "@/components/reservas/pagamentos-reserva";
import { QuebraDaCotacao } from "@/components/reservas/quebra-cotacao";
import { INTENCAO_LABELS } from "@/components/reservas/rotulos";
import { StatusReserva } from "@/components/reservas/status-reserva";
import { TarefasDaReserva } from "@/components/reservas/tarefas-reserva";

type Params = {
  params: Promise<{ id: string }>;
  /**
   * `?cobranca=link|manual` é o que a tela de venda decidiu no passo 4 e
   * carregou até aqui pelo `redirect` de
   * `src/components/reservas/nova/actions.ts`. Sem ler este parâmetro o
   * operador chega na reserva recém-criada sem saber qual é o próximo
   * passo — foi para isso que ele foi escrito.
   */
  searchParams: Promise<{ cobranca?: string | string[] }>;
};

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const actor = await requireActorWith("reservations.view");
  const reserva = await obterReserva(actor, id);
  return { title: reserva ? `Reserva ${reserva.codigoFormatado}` : "Reserva" };
}

/** Par rótulo/valor das fichas — a metade da tela que é só leitura. */
function Campo({
  rotulo,
  children,
}: {
  rotulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

/**
 * O que fazer agora com o dinheiro, para quem acabou de fechar a venda.
 *
 * Some assim que a reserva é quitada ou deixa de estar viva: manter o
 * lembrete numa reserva paga ou cancelada só atrapalharia.
 */
function AvisoDeCobranca({
  cobranca,
  saldoCents,
  currency,
  podePagar,
}: {
  cobranca: "link" | "manual";
  saldoCents: number;
  currency: string;
  podePagar: boolean;
}) {
  if (cobranca === "manual") {
    return (
      <Alert>
        <Banknote />
        <AlertTitle>Falta registrar o pagamento</AlertTitle>
        <AlertDescription>
          {podePagar
            ? `Esta venda foi fechada para baixa manual. Use “Registrar pagamento” acima para lançar os ${formatMoney(saldoCents, currency)} — quitar o total confirma a reserva e encerra o prazo de retenção.`
            : `Esta venda foi fechada para baixa manual, e faltam ${formatMoney(saldoCents, currency)}. Seu perfil não lança pagamentos: peça a baixa a quem tem essa permissão antes que o prazo de retenção vença.`}
        </AlertDescription>
      </Alert>
    );
  }

  /**
   * Só se chega aqui quando a abertura da cobrança FALHOU — o fluxo de
   * sucesso redireciona direto para o checkout do provedor. Dizer o que
   * aconteceu é melhor do que abrir o diálogo manual em silêncio: o
   * operador acharia que enviou um link que nunca saiu.
   */
  return (
    <Alert variant="destructive">
      <LinkIcon />
      <AlertTitle>O link de pagamento não foi gerado</AlertTitle>
      <AlertDescription>
        O provedor não respondeu ao pedido de cobrança. Tente de novo em
        “Cobrar por link”, cobre por fora e registre a entrada em “Registrar
        pagamento”, ou cancele a reserva para devolver as datas ao calendário —
        o prazo de retenção corre igual.
      </AlertDescription>
    </Alert>
  );
}

export default async function ReservaDetalhePage({
  params,
  searchParams,
}: Params) {
  const { id } = await params;
  const { cobranca: cobrancaBruta } = await searchParams;

  const actor = await requireActorWith("reservations.view");
  const reserva = await obterReserva(actor, id);

  // `notFound` (não 403) quando está fora do escopo: um 403 confirmaria que
  // o id existe na carteira de outra empresa.
  if (!reserva) notFound();

  const [podeEditar, podeCancelar, podePagar, podeVerPagamentos, podeVerTarefas, podeVerImovel] =
    await Promise.all([
      hasPermission(actor, "reservations.edit"),
      // Cancelar é `reservations.delete` no domínio (`cancelarReserva`) —
      // esconder o botão com outra permissão só produziria um erro na cara
      // de quem clicasse.
      hasPermission(actor, "reservations.delete"),
      hasPermission(actor, "payments.create"),
      hasPermission(actor, "payments.view"),
      hasPermission(actor, "tasks.view"),
      hasPermission(actor, "properties.view"),
    ]);

  /**
   * Só vale enquanto houver o que cobrar numa reserva viva. Depois de
   * quitada, cancelada ou não comparecida, o aviso viraria ruído — e um
   * `?cobranca=` de link antigo não pode ressuscitá-lo.
   */
  const cobranca =
    typeof cobrancaBruta === "string" &&
    (cobrancaBruta === "link" || cobrancaBruta === "manual") &&
    reserva.saldoCents > 0 &&
    reserva.status !== "CANCELLED" &&
    reserva.status !== "NO_SHOW"
      ? cobrancaBruta
      : null;

  const holdExpiraEm =
    reserva.status === "PENDING" ? reserva.holdExpiresAt : null;
  const documento =
    reserva.primaryGuest.documentType && reserva.primaryGuest.documentLast4
      ? `${TIPO_DOCUMENTO_LABELS[reserva.primaryGuest.documentType]} ••${reserva.primaryGuest.documentLast4}`
      : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link
          href="/reservas"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          Reservas
        </Link>

        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-heading font-mono text-2xl font-semibold tracking-tight">
            {reserva.codigoFormatado}
          </h1>
          <StatusReserva status={reserva.status} />
          {holdExpiraEm && (
            <HoldRestante
              restanteSegundos={Math.round(
                (holdExpiraEm.getTime() - agoraDoRender()) / 1000,
              )}
            />
          )}
        </div>

        <p className="text-sm text-muted-foreground">
          {reserva.hospedeNome} · {reserva.unit.internalCode} ·{" "}
          {formatarData(reserva.checkIn)} → {formatarData(reserva.checkOut)}
        </p>
      </div>

      {reserva.status === "CANCELLED" && (
        <Alert variant="destructive">
          <Ban />
          <AlertTitle>
            Reserva cancelada
            {reserva.cancelledAt && ` em ${formatarInstante(reserva.cancelledAt)}`}
          </AlertTitle>
          <AlertDescription>
            {reserva.cancellationReason ?? "Motivo não registrado."}
          </AlertDescription>
        </Alert>
      )}

      {cobranca && (
        <AvisoDeCobranca
          cobranca={cobranca}
          saldoCents={reserva.saldoCents}
          currency={reserva.currency}
          podePagar={podePagar}
        />
      )}

      <AcoesReserva
        reservaId={reserva.id}
        codigoFormatado={reserva.codigoFormatado}
        status={reserva.status}
        saldoCents={reserva.saldoCents}
        currency={reserva.currency}
        permissoes={{
          editar: podeEditar,
          cancelar: podeCancelar,
          pagar: podePagar,
        }}
        meiosPagamento={MEIOS_PAGAMENTO_MANUAL.map((m) => ({
          valor: m,
          rotulo: MEIO_PAGAMENTO_LABELS[m],
        }))}
        intencoes={INTENCOES_PAGAMENTO.map((i) => ({
          valor: i,
          rotulo: INTENCAO_LABELS[i],
        }))}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Estadia</CardTitle>
            <CardDescription>
              A saída não é noite ocupada: uma entrada no mesmo dia da saída é
              permitida.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4">
              <Campo rotulo="Entrada">{formatarData(reserva.checkIn)}</Campo>
              <Campo rotulo="Saída">{formatarData(reserva.checkOut)}</Campo>
              <Campo rotulo="Noites">{contar(reserva.nights, "noite")}</Campo>
              <Campo rotulo="Hóspedes">
                {contar(reserva.adults, "adulto")}
                {reserva.children > 0 && `, ${contar(reserva.children, "criança", "crianças")}`}
                {reserva.infants > 0 && `, ${contar(reserva.infants, "bebê", "bebês")}`}
              </Campo>

              <Campo rotulo="Unidade">
                {podeVerImovel ? (
                  <Link
                    href={`/imoveis/${reserva.propertyId}/unidades/${reserva.unitId}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {reserva.unit.internalCode}
                  </Link>
                ) : (
                  reserva.unit.internalCode
                )}
                <div className="text-xs text-muted-foreground">
                  {reserva.property.name}
                </div>
              </Campo>
              <Campo rotulo="Plano tarifário">
                {reserva.ratePlan
                  ? `${reserva.ratePlan.name} (${reserva.ratePlan.code})`
                  : "—"}
              </Campo>

              <Campo rotulo="Origem">
                {ORIGEM_LABELS[reserva.source] ?? reserva.source}
                {reserva.channelReservationId && (
                  <div className="text-xs text-muted-foreground">
                    Canal: {reserva.channelReservationId}
                  </div>
                )}
              </Campo>
              <Campo rotulo="Criada em">
                {formatarInstante(reserva.createdAt)}
              </Campo>

              {reserva.confirmedAt && (
                <Campo rotulo="Confirmada em">
                  {formatarInstante(reserva.confirmedAt)}
                </Campo>
              )}
              {reserva.checkedInAt && (
                <Campo rotulo="Check-in em">
                  {formatarInstante(reserva.checkedInAt)}
                </Campo>
              )}
              {reserva.checkedOutAt && (
                <Campo rotulo="Check-out em">
                  {formatarInstante(reserva.checkedOutAt)}
                </Campo>
              )}
              {reserva.availabilityBlock?.releasedAt && (
                <Campo rotulo="Datas liberadas em">
                  {formatarInstante(reserva.availabilityBlock.releasedAt)}
                </Campo>
              )}
            </dl>

            {(reserva.guestNotes || reserva.internalNotes) && (
              <div className="mt-4 space-y-3 border-t pt-4">
                {reserva.guestNotes && (
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Observações do hóspede
                    </p>
                    <p className="text-sm whitespace-pre-line">
                      {reserva.guestNotes}
                    </p>
                  </div>
                )}
                {reserva.internalNotes && (
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Notas internas (não visíveis ao hóspede)
                    </p>
                    <p className="text-sm whitespace-pre-line">
                      {reserva.internalNotes}
                    </p>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Hóspede</CardTitle>
            <CardDescription>
              Contato de quem responde pela estadia.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4">
              <Campo rotulo="Nome">{reserva.hospedeNome}</Campo>
              <Campo rotulo="Documento">{documento ?? "Não informado"}</Campo>
              <Campo rotulo="E-mail">
                {reserva.primaryGuest.email ? (
                  <a
                    href={`mailto:${reserva.primaryGuest.email}`}
                    className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
                  >
                    <Mail className="size-3.5" />
                    {reserva.primaryGuest.email}
                  </a>
                ) : (
                  "Não informado"
                )}
              </Campo>
              <Campo rotulo="Telefone">
                {reserva.primaryGuest.phone ? (
                  <a
                    href={`tel:${reserva.primaryGuest.phone}`}
                    className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
                  >
                    <Phone className="size-3.5" />
                    {reserva.primaryGuest.phone}
                  </a>
                ) : (
                  "Não informado"
                )}
              </Campo>
              {reserva.primaryGuest.country && (
                <Campo rotulo="País">{reserva.primaryGuest.country}</Campo>
              )}
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Cotação</CardTitle>
          <CardDescription>
            A conta como foi fechada, noite a noite.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <QuebraDaCotacao
            snapshot={reserva.quoteSnapshot}
            reserva={{
              currency: reserva.currency,
              nights: reserva.nights,
              nightlyTotalCents: reserva.nightlyTotalCents,
              feesTotalCents: reserva.feesTotalCents,
              taxesTotalCents: reserva.taxesTotalCents,
              discountsTotalCents: reserva.discountsTotalCents,
              totalCents: reserva.totalCents,
            }}
            ratePlan={reserva.ratePlan}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pagamentos</CardTitle>
          <CardDescription>
            Nenhum dado de cartão é armazenado — só o registro de que o dinheiro
            entrou.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PagamentosDaReserva
            pagamentos={podeVerPagamentos ? reserva.payments : null}
            currency={reserva.currency}
            totalCents={reserva.totalCents}
            paidCents={reserva.paidCents}
            saldoCents={reserva.saldoCents}
          />
        </CardContent>
      </Card>

      {podeVerTarefas && (
        <Card>
          <CardHeader>
            <CardTitle>Tarefas</CardTitle>
            <CardDescription>
              O que a equipe precisa fazer por causa desta estadia.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TarefasDaReserva tarefas={reserva.tasks} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
