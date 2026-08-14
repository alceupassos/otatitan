import { describe, expect, it } from "vitest";
import { parseDateOnly } from "@/lib/dates";
import { avaliarHold, type CandidataAExpirar } from "@/worker/jobs/expirar-holds";
import {
  calcularDueAt,
  montarDedupeKey,
  TIPOS_DA_RESERVA,
  type ContextoDaEstadia,
} from "@/worker/jobs/tarefas-da-reserva";

/**
 * Só as funções puras dos jobs — a decisão "expira ou não" e a montagem de
 * dedupeKey/dueAt. São elas que erram em produção de um jeito caro (reserva
 * paga sumindo do calendário, limpeza duplicada na agenda da equipe), e
 * testá-las não pode depender de Redis nem de Postgres no ar.
 */

const AGORA = new Date("2026-03-10T12:00:00.000Z");

function reserva(over: Partial<CandidataAExpirar> = {}): CandidataAExpirar {
  return {
    status: "PENDING",
    holdExpiresAt: new Date("2026-03-10T11:30:00.000Z"),
    paidCents: 0,
    temPagamentoEmCurso: false,
    ...over,
  };
}

describe("avaliarHold", () => {
  it("expira reserva PENDING com hold vencido e sem pagamento", () => {
    expect(avaliarHold(reserva(), AGORA)).toEqual({ expira: true });
  });

  it("não expira antes do prazo", () => {
    const d = avaliarHold(
      reserva({ holdExpiresAt: new Date("2026-03-10T12:00:00.001Z") }),
      AGORA,
    );
    expect(d).toEqual({ expira: false, motivo: "hold_vigente" });
  });

  /**
   * O limite tem de ser inclusivo para casar com o `lte` da consulta que
   * seleciona as candidatas. Se divergisse, a reserva que vence no instante
   * exato da varredura seria buscada e nunca tratada — presa em PENDING
   * segurando a unidade para sempre.
   */
  it("expira no instante exato do vencimento", () => {
    expect(avaliarHold(reserva({ holdExpiresAt: AGORA }), AGORA)).toEqual({
      expira: true,
    });
  });

  it("não expira reserva com valor já pago (RN-004)", () => {
    expect(avaliarHold(reserva({ paidCents: 1 }), AGORA)).toEqual({
      expira: false,
      motivo: "ja_pago",
    });
  });

  /**
   * Pagamento em PROCESSING é dinheiro em trânsito: liberar a unidade
   * debaixo de uma cobrança que ainda pode ser aprovada produz overbooking.
   */
  it("não expira com pagamento em curso, mesmo com paidCents zerado", () => {
    expect(
      avaliarHold(reserva({ temPagamentoEmCurso: true }), AGORA),
    ).toEqual({ expira: false, motivo: "ja_pago" });
  });

  it("ignora reserva sem hold", () => {
    expect(avaliarHold(reserva({ holdExpiresAt: null }), AGORA)).toEqual({
      expira: false,
      motivo: "sem_hold",
    });
  });

  it("ignora reserva que não está PENDING", () => {
    expect(avaliarHold(reserva({ status: "CONFIRMED" }), AGORA)).toEqual({
      expira: false,
      motivo: "nao_pendente",
    });
  });
});

describe("montarDedupeKey", () => {
  it("é determinística — o retry do webhook cai na mesma chave", () => {
    const a = montarDedupeKey("11111111-1111-1111-1111-111111111111", "CLEANING");
    const b = montarDedupeKey("11111111-1111-1111-1111-111111111111", "CLEANING");
    expect(a).toBe(b);
    expect(a).toBe("reservation:11111111-1111-1111-1111-111111111111:CLEANING");
  });

  it("gera uma chave distinta por tipo de tarefa", () => {
    const chaves = TIPOS_DA_RESERVA.map((t) => montarDedupeKey("r1", t));
    expect(new Set(chaves).size).toBe(TIPOS_DA_RESERVA.length);
  });
});

describe("calcularDueAt", () => {
  const ctx: ContextoDaEstadia = {
    checkIn: parseDateOnly("2026-03-10"),
    checkOut: parseDateOnly("2026-03-14"),
    checkInTime: "15:00",
    checkOutTime: "11:00",
    timezone: "America/Sao_Paulo",
  };

  it("marca o check-in no horário de chegada do imóvel", () => {
    // 15:00 em São Paulo (UTC-3) = 18:00Z.
    expect(calcularDueAt("CHECK_IN", ctx).toISOString()).toBe(
      "2026-03-10T18:00:00.000Z",
    );
  });

  it("marca check-out e limpeza no dia da saída, no horário de saída", () => {
    const esperado = "2026-03-14T14:00:00.000Z";
    expect(calcularDueAt("CHECK_OUT", ctx).toISOString()).toBe(esperado);
    expect(calcularDueAt("CLEANING", ctx).toISOString()).toBe(esperado);
  });

  /**
   * O fuso que vale é o do imóvel, não o do servidor: uma pousada no Acre
   * (UTC-5) tem check-in às 15:00 locais, e o worker pode rodar em
   * qualquer lugar.
   */
  it("usa o fuso do imóvel, não o do processo", () => {
    expect(
      calcularDueAt("CHECK_IN", { ...ctx, timezone: "America/Rio_Branco" })
        .toISOString(),
    ).toBe("2026-03-10T20:00:00.000Z");
  });
});
