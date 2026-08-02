-- Integridade de reserva: garantia de zero overbooking NO BANCO, não só na
-- aplicação (docs/09-arquitetura.md, ADR-003).

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Nenhuma unidade pode ter duas ocupações bloqueantes com datas sobrepostas
-- (RN-002). Cobre reservas E bloqueios manuais, porque ambos vivem na
-- mesma tabela AvailabilityBlock (ADR-005).
ALTER TABLE "otatitan"."AvailabilityBlock"
  ADD CONSTRAINT "availability_block_no_overlap"
  EXCLUDE USING gist (
    "unitId" WITH =,
    daterange("startDate", "endDate", '[)') WITH &&
  ) WHERE ("isBlocking" AND "releasedAt" IS NULL);

ALTER TABLE "otatitan"."AvailabilityBlock"
  ADD CONSTRAINT "availability_block_valid_range" CHECK ("endDate" > "startDate");

ALTER TABLE "otatitan"."Reservation"
  ADD CONSTRAINT "reservation_valid_range" CHECK ("checkOut" > "checkIn");

ALTER TABLE "otatitan"."Reservation"
  ADD CONSTRAINT "reservation_nights_match" CHECK ("nights" = ("checkOut" - "checkIn"));

ALTER TABLE "otatitan"."Reservation"
  ADD CONSTRAINT "reservation_total_non_negative" CHECK ("totalCents" >= 0);

ALTER TABLE "otatitan"."DailyRate"
  ADD CONSTRAINT "daily_rate_price_positive" CHECK ("priceCents" > 0);

-- Um único plano de tarifa padrão ativo por unidade (RN-012 depende disso
-- para saber qual plano usar quando a reserva não especifica um).
CREATE UNIQUE INDEX "rate_plan_one_default_per_unit"
  ON "otatitan"."RatePlan" ("tenantId", "unitId")
  WHERE ("isDefault" AND "status" = 'ACTIVE');

-- Um único hóspede principal por reserva.
CREATE UNIQUE INDEX "reservation_guest_one_primary"
  ON "otatitan"."ReservationGuest" ("reservationId")
  WHERE ("isPrimary");

-- E-mail de usuário é case-insensitive na prática (login), mas a unique
-- constraint do Prisma é case-sensitive — este índice é o backstop real.
CREATE UNIQUE INDEX "user_email_lower_unique" ON "otatitan"."User" (lower("email"));
