-- AlterTable
ALTER TABLE "AvailabilityBlock" ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid;

-- AlterTable
ALTER TABLE "Consent" ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid;

-- AlterTable
ALTER TABLE "DailyRate" ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid;

-- AlterTable
ALTER TABLE "Guest" ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid;

-- AlterTable
ALTER TABLE "Media" ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid;

-- AlterTable
ALTER TABLE "Membership" ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid;

-- AlterTable
ALTER TABLE "Owner" ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid;

-- AlterTable
ALTER TABLE "Payment" ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid;

-- AlterTable
ALTER TABLE "Property" ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid;

-- AlterTable
ALTER TABLE "RatePlan" ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid;

-- AlterTable
ALTER TABLE "Reservation" ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid;

-- AlterTable
ALTER TABLE "ReservationGuest" ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid;

-- AlterTable
ALTER TABLE "Task" ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid;

-- AlterTable
ALTER TABLE "Unit" ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid;

-- AlterTable
ALTER TABLE "UnitAmenity" ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid;
