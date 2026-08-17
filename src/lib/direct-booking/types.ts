import type { Cotacao } from "@/lib/pricing/quote";
import type { Recusa } from "@/lib/pricing/errors";

/**
 * Tipos do canal direto compartilhados com o client (widget).
 * Sem `server-only` — o módulo de busca que toca o banco é que é servidor.
 */

export type UnidadePublicaVendavel = {
  unitId: string;
  unitName: string;
  internalCode: string;
  maxGuests: number;
  planos: Cotacao[];
};

export type UnidadePublicaRecusada = {
  unitId: string;
  unitName: string;
  internalCode: string;
  recusa: Recusa;
};

export type ResultadoPublico = {
  checkIn: string;
  checkOut: string;
  nights: number;
  hospedes: number;
  pets: number;
  parking: boolean;
  vendaveis: UnidadePublicaVendavel[];
  recusadas: UnidadePublicaRecusada[];
  ocupadas: number;
};

export type DiaCalendarioPublico = {
  data: string;
  livres: number;
  total: number;
};
