"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ResultadoBuscaUI, UnidadeVendavelUI, ValoresBusca } from "./actions";
import { PassoBusca } from "./passo-busca";
import { PassoConfirmacao } from "./passo-confirmacao";
import { PassoHospede } from "./passo-hospede";
import { PassoResultado } from "./passo-resultado";
import {
  HOSPEDE_VAZIO,
  type HospedeEscolhido,
  type HospedeValores,
} from "./tipos";

/**
 * Fluxo de venda em uma página só (UC-040).
 *
 * As etapas aparecem à medida que fazem sentido, e nenhuma some depois de
 * concluída: a venda por telefone é iterativa — o hóspede muda a data, o
 * atendente refaz a busca — e esconder o passo anterior obrigaria a
 * recomeçar a cada ajuste.
 *
 * A ficha do hóspede fica disponível assim que existe um resultado, e não
 * só depois de a unidade ser escolhida: o atendente costuma anotar o nome
 * enquanto ainda discute qual unidade vender, e desmontar o formulário
 * apagaria o que ele já digitou.
 */
export function NovaReservaFluxo({
  imoveis,
  buscaInicial,
  origens,
}: {
  imoveis: { id: string; name: string }[];
  buscaInicial: ValoresBusca;
  origens: { valor: string; label: string }[];
}) {
  const [resultado, setResultado] = useState<ResultadoBuscaUI | null>(null);
  const [unidade, setUnidade] = useState<UnidadeVendavelUI | null>(null);
  const [hospede, setHospede] = useState<HospedeValores | null>(null);
  const [escolhido, setEscolhido] = useState<HospedeEscolhido | null>(null);

  return (
    <div className="space-y-6">
      <Passo
        numero={1}
        titulo="Período e ocupação"
        descricao="A estadia vai da entrada até a saída, sem contar a noite do check-out."
      >
        <PassoBusca
          imoveis={imoveis}
          valoresIniciais={buscaInicial}
          onBuscou={(_valores, novo) => {
            setResultado(novo);
            // A unidade escolhida pertencia à busca anterior; mantê-la
            // deixaria a confirmação apontando para datas que ninguém
            // pediu. A ficha do hóspede continua, porque não depende disso.
            setUnidade(null);
          }}
        />
      </Passo>

      {resultado && (
        <Passo
          numero={2}
          titulo="Unidades"
          descricao="O que dá para vender e, com o mesmo destaque, o que está impedindo o resto."
        >
          <PassoResultado
            resultado={resultado}
            unidadeSelecionada={unidade?.unitId ?? null}
            onSelecionar={setUnidade}
          />
        </Passo>
      )}

      {resultado && (
        <Passo
          numero={3}
          titulo="Hóspede"
          descricao="Busque o cadastro existente ou preencha a ficha — o e-mail é o que evita duplicar."
        >
          <PassoHospede
            valoresIniciais={hospede ?? HOSPEDE_VAZIO}
            escolhidoInicial={escolhido}
            onConcluiu={(valores, escolha) => {
              setHospede(valores);
              setEscolhido(escolha);
            }}
          />
          {hospede && (
            <p className="mt-3 text-xs text-muted-foreground">
              Ficha registrada para esta venda. Se alterar algo acima, clique
              de novo em “Continuar para a confirmação”.
            </p>
          )}
        </Passo>
      )}

      {unidade && hospede && (
        <Passo
          numero={4}
          titulo="Confirmação"
          descricao="A conta noite a noite, como ela será gravada na reserva."
        >
          <PassoConfirmacao
            // Trocar de unidade tem que recomeçar o estado da confirmação
            // (divergência de preço, composição de hóspedes) — senão um
            // aviso de preço da unidade anterior sobreviveria à troca.
            key={unidade.unitId}
            unidade={unidade}
            hospede={hospede}
            origens={origens}
          />
        </Passo>
      )}
    </div>
  );
}

function Passo({
  numero,
  titulo,
  descricao,
  children,
}: {
  numero: number;
  titulo: string;
  descricao: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
          >
            {numero}
          </span>
          <div>
            <CardTitle>{titulo}</CardTitle>
            <CardDescription>{descricao}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
