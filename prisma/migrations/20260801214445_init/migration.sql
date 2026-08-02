-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "OwnerType" AS ENUM ('INDIVIDUAL', 'COMPANY');

-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('APARTMENT', 'HOUSE', 'CONDO', 'FLAT', 'ROOM', 'OTHER');

-- CreateEnum
CREATE TYPE "PropertyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "UnitStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AmenityCategory" AS ENUM ('ESSENTIALS', 'KITCHEN', 'OUTDOOR', 'LEISURE', 'ACCESSIBILITY', 'SAFETY', 'OTHER');

-- CreateEnum
CREATE TYPE "MediaOwnerType" AS ENUM ('PROPERTY', 'UNIT', 'GUEST', 'RESERVATION', 'TASK', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "MediaVisibility" AS ENUM ('PRIVATE', 'PUBLIC_READ');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('CPF', 'PASSPORT', 'RG', 'OTHER');

-- CreateEnum
CREATE TYPE "RatePlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CancellationPolicy" AS ENUM ('FLEXIBLE', 'MODERATE', 'STRICT', 'NON_REFUNDABLE');

-- CreateEnum
CREATE TYPE "RateSource" AS ENUM ('MANUAL', 'BULK_EDIT', 'RULE', 'AI_SUGGESTION', 'CHANNEL');

-- CreateEnum
CREATE TYPE "BlockSource" AS ENUM ('RESERVATION', 'MANUAL', 'MAINTENANCE', 'OWNER_STAY', 'CHANNEL_SYNC');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "ReservationSource" AS ENUM ('DIRECT', 'MANUAL', 'WEBSITE', 'CHANNEL');

-- CreateEnum
CREATE TYPE "ReservationGuestRole" AS ENUM ('PRIMARY', 'ADDITIONAL');

-- CreateEnum
CREATE TYPE "PaymentProviderKey" AS ENUM ('STRIPE', 'MANUAL', 'MERCADOPAGO', 'PAGARME');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CARD', 'PIX', 'BOLETO', 'CASH', 'BANK_TRANSFER', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentIntentKind" AS ENUM ('DEPOSIT', 'BALANCE', 'FULL', 'SECURITY_DEPOSIT', 'EXTRA');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('REQUIRES_ACTION', 'PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');

-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('CHECK_IN', 'CHECK_OUT', 'CLEANING', 'INSPECTION', 'MAINTENANCE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "ConsentSubjectType" AS ENUM ('GUEST', 'USER', 'OWNER');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'SYSTEM', 'WEBHOOK', 'JOB');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "taxId" TEXT,
    "status" "TenantStatus" NOT NULL DEFAULT 'TRIAL',
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "defaultCurrency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "locale" TEXT NOT NULL DEFAULT 'pt-BR',
    "permVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMPTZ(3),
    "name" TEXT NOT NULL,
    "passwordHash" TEXT,
    "image" TEXT,
    "isSuperadmin" BOOLEAN NOT NULL DEFAULT false,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecretEnc" TEXT,
    "mfaRecoveryCodesEnc" TEXT,
    "mfaEnrolledAt" TIMESTAMPTZ(3),
    "lastLoginAt" TIMESTAMPTZ(3),
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "userId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("provider","providerAccountId")
);

-- CreateTable
CREATE TABLE "Session" (
    "sessionToken" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "expires" TIMESTAMPTZ(3) NOT NULL
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "VerificationToken_pkey" PRIMARY KEY ("identifier","token")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "requestedIp" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "code" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenantId" UUID,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "userId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'INVITED',
    "invitedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Owner" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "OwnerType" NOT NULL DEFAULT 'INDIVIDUAL',
    "email" TEXT,
    "phone" TEXT,
    "taxIdEnc" TEXT,
    "userId" UUID,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Owner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Property" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenantId" UUID NOT NULL,
    "ownerId" UUID,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "type" "PropertyType" NOT NULL DEFAULT 'APARTMENT',
    "description" TEXT,
    "status" "PropertyStatus" NOT NULL DEFAULT 'DRAFT',
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "neighborhood" TEXT,
    "city" TEXT,
    "state" CHAR(2),
    "postalCode" TEXT,
    "country" TEXT NOT NULL DEFAULT 'BR',
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "checkInTime" TEXT NOT NULL DEFAULT '15:00',
    "checkOutTime" TEXT NOT NULL DEFAULT '11:00',
    "houseRules" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "archivedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Unit" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenantId" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "internalCode" TEXT NOT NULL,
    "maxGuests" INTEGER NOT NULL,
    "bedrooms" INTEGER NOT NULL DEFAULT 0,
    "beds" INTEGER NOT NULL DEFAULT 0,
    "bathrooms" DECIMAL(3,1) NOT NULL DEFAULT 1,
    "sizeM2" INTEGER,
    "floor" TEXT,
    "status" "UnitStatus" NOT NULL DEFAULT 'DRAFT',
    "baseRateCents" INTEGER,
    "cleaningFeeCents" INTEGER NOT NULL DEFAULT 0,
    "minNights" INTEGER NOT NULL DEFAULT 1,
    "maxNights" INTEGER,
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "archivedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Amenity" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenantId" UUID,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "AmenityCategory" NOT NULL DEFAULT 'OTHER',
    "icon" TEXT,

    CONSTRAINT "Amenity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitAmenity" (
    "tenantId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "amenityId" UUID NOT NULL,
    "notes" TEXT,

    CONSTRAINT "UnitAmenity_pkey" PRIMARY KEY ("unitId","amenityId")
);

-- CreateTable
CREATE TABLE "Media" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenantId" UUID NOT NULL,
    "ownerType" "MediaOwnerType" NOT NULL,
    "ownerId" UUID NOT NULL,
    "bucket" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "checksumSha256" TEXT,
    "visibility" "MediaVisibility" NOT NULL DEFAULT 'PRIVATE',
    "scanStatus" "ScanStatus" NOT NULL DEFAULT 'PENDING',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isCover" BOOLEAN NOT NULL DEFAULT false,
    "altText" TEXT,
    "uploadedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Guest" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenantId" UUID NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "documentType" "DocumentType",
    "documentNumberEnc" TEXT,
    "documentLast4" TEXT,
    "birthDate" DATE,
    "nationality" TEXT,
    "country" TEXT NOT NULL DEFAULT 'BR',
    "notes" TEXT,
    "userId" UUID,
    "marketingOptIn" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Guest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RatePlan" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenantId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "status" "RatePlanStatus" NOT NULL DEFAULT 'DRAFT',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "minNights" INTEGER NOT NULL DEFAULT 1,
    "maxNights" INTEGER,
    "minAdvanceDays" INTEGER NOT NULL DEFAULT 0,
    "maxAdvanceDays" INTEGER,
    "includesCleaningFee" BOOLEAN NOT NULL DEFAULT false,
    "cancellationPolicy" "CancellationPolicy" NOT NULL DEFAULT 'MODERATE',
    "validFrom" DATE,
    "validTo" DATE,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RatePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyRate" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenantId" UUID NOT NULL,
    "ratePlanId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "minNights" INTEGER,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "closedToArrival" BOOLEAN NOT NULL DEFAULT false,
    "closedToDeparture" BOOLEAN NOT NULL DEFAULT false,
    "source" "RateSource" NOT NULL DEFAULT 'MANUAL',
    "sourceNote" TEXT,
    "updatedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DailyRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailabilityBlock" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenantId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "source" "BlockSource" NOT NULL,
    "isBlocking" BOOLEAN NOT NULL DEFAULT true,
    "reservationId" UUID,
    "reason" TEXT,
    "createdById" UUID,
    "releasedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AvailabilityBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reservation" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenantId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "propertyId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "primaryGuestId" UUID NOT NULL,
    "ratePlanId" UUID,
    "status" "ReservationStatus" NOT NULL DEFAULT 'PENDING',
    "source" "ReservationSource" NOT NULL DEFAULT 'DIRECT',
    "checkIn" DATE NOT NULL,
    "checkOut" DATE NOT NULL,
    "nights" INTEGER NOT NULL,
    "adults" INTEGER NOT NULL DEFAULT 1,
    "children" INTEGER NOT NULL DEFAULT 0,
    "infants" INTEGER NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "nightlyTotalCents" INTEGER NOT NULL,
    "feesTotalCents" INTEGER NOT NULL DEFAULT 0,
    "discountsTotalCents" INTEGER NOT NULL DEFAULT 0,
    "taxesTotalCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL,
    "paidCents" INTEGER NOT NULL DEFAULT 0,
    "quoteSnapshot" JSONB NOT NULL,
    "holdExpiresAt" TIMESTAMPTZ(3),
    "confirmedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "cancellationReason" TEXT,
    "checkedInAt" TIMESTAMPTZ(3),
    "checkedOutAt" TIMESTAMPTZ(3),
    "channelReservationId" TEXT,
    "internalNotes" TEXT,
    "guestNotes" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservationGuest" (
    "tenantId" UUID NOT NULL,
    "reservationId" UUID NOT NULL,
    "guestId" UUID NOT NULL,
    "role" "ReservationGuestRole" NOT NULL DEFAULT 'ADDITIONAL',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenantId" UUID NOT NULL,
    "reservationId" UUID,
    "provider" "PaymentProviderKey" NOT NULL,
    "providerPaymentId" TEXT,
    "providerSessionId" TEXT,
    "providerCustomerId" TEXT,
    "method" "PaymentMethod" NOT NULL DEFAULT 'CARD',
    "intent" "PaymentIntentKind" NOT NULL DEFAULT 'FULL',
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amountCents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "providerFeeCents" INTEGER,
    "netCents" INTEGER,
    "cardBrand" TEXT,
    "cardLast4" TEXT,
    "receiptUrl" TEXT,
    "description" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "paidAt" TIMESTAMPTZ(3),
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "provider" "PaymentProviderKey" NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "signatureVerified" BOOLEAN NOT NULL,
    "payload" JSONB NOT NULL,
    "tenantId" UUID,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(3),
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenantId" UUID NOT NULL,
    "type" "TaskType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "TaskPriority" NOT NULL DEFAULT 'NORMAL',
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "propertyId" UUID,
    "unitId" UUID,
    "reservationId" UUID,
    "assignedToUserId" UUID,
    "assignedRoleSlug" TEXT,
    "dedupeKey" TEXT,
    "completedAt" TIMESTAMPTZ(3),
    "completedByUserId" UUID,
    "createdBySystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consent" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenantId" UUID NOT NULL,
    "subjectType" "ConsentSubjectType" NOT NULL,
    "subjectId" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "documentVersion" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "grantedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenantId" UUID,
    "actorType" "ActorType" NOT NULL,
    "actorUserId" UUID,
    "actorLabel" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_code_key" ON "Permission"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Role_tenantId_slug_key" ON "Role"("tenantId", "slug");

-- CreateIndex
CREATE INDEX "Membership_tenantId_roleId_idx" ON "Membership"("tenantId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_tenantId_key" ON "Membership"("userId", "tenantId");

-- CreateIndex
CREATE INDEX "Owner_tenantId_name_idx" ON "Owner"("tenantId", "name");

-- CreateIndex
CREATE INDEX "Property_tenantId_status_idx" ON "Property"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Property_tenantId_city_idx" ON "Property"("tenantId", "city");

-- CreateIndex
CREATE UNIQUE INDEX "Property_tenantId_id_key" ON "Property"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Property_tenantId_slug_key" ON "Property"("tenantId", "slug");

-- CreateIndex
CREATE INDEX "Unit_tenantId_propertyId_status_idx" ON "Unit"("tenantId", "propertyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Unit_tenantId_id_key" ON "Unit"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Unit_tenantId_propertyId_internalCode_key" ON "Unit"("tenantId", "propertyId", "internalCode");

-- CreateIndex
CREATE UNIQUE INDEX "Amenity_tenantId_slug_key" ON "Amenity"("tenantId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Media_storageKey_key" ON "Media"("storageKey");

-- CreateIndex
CREATE INDEX "Media_tenantId_ownerType_ownerId_sortOrder_idx" ON "Media"("tenantId", "ownerType", "ownerId", "sortOrder");

-- CreateIndex
CREATE INDEX "Guest_tenantId_lastName_firstName_idx" ON "Guest"("tenantId", "lastName", "firstName");

-- CreateIndex
CREATE INDEX "Guest_tenantId_phone_idx" ON "Guest"("tenantId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "Guest_tenantId_id_key" ON "Guest"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Guest_tenantId_email_key" ON "Guest"("tenantId", "email");

-- CreateIndex
CREATE INDEX "RatePlan_tenantId_status_idx" ON "RatePlan"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RatePlan_tenantId_id_key" ON "RatePlan"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RatePlan_tenantId_unitId_code_key" ON "RatePlan"("tenantId", "unitId", "code");

-- CreateIndex
CREATE INDEX "DailyRate_tenantId_unitId_date_idx" ON "DailyRate"("tenantId", "unitId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyRate_tenantId_ratePlanId_unitId_date_key" ON "DailyRate"("tenantId", "ratePlanId", "unitId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AvailabilityBlock_reservationId_key" ON "AvailabilityBlock"("reservationId");

-- CreateIndex
CREATE INDEX "AvailabilityBlock_tenantId_unitId_startDate_endDate_idx" ON "AvailabilityBlock"("tenantId", "unitId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "Reservation_tenantId_unitId_checkIn_idx" ON "Reservation"("tenantId", "unitId", "checkIn");

-- CreateIndex
CREATE INDEX "Reservation_tenantId_status_checkIn_idx" ON "Reservation"("tenantId", "status", "checkIn");

-- CreateIndex
CREATE INDEX "Reservation_tenantId_primaryGuestId_idx" ON "Reservation"("tenantId", "primaryGuestId");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_tenantId_id_key" ON "Reservation"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_tenantId_code_key" ON "Reservation"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ReservationGuest_reservationId_guestId_key" ON "ReservationGuest"("reservationId", "guestId");

-- CreateIndex
CREATE INDEX "Payment_tenantId_reservationId_idx" ON "Payment"("tenantId", "reservationId");

-- CreateIndex
CREATE INDEX "Payment_tenantId_status_idx" ON "Payment"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_tenantId_idempotencyKey_key" ON "Payment"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_provider_providerPaymentId_key" ON "Payment"("provider", "providerPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_provider_eventId_key" ON "WebhookEvent"("provider", "eventId");

-- CreateIndex
CREATE INDEX "Task_tenantId_status_dueAt_idx" ON "Task"("tenantId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "Task_tenantId_assignedToUserId_status_idx" ON "Task"("tenantId", "assignedToUserId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Task_tenantId_dedupeKey_key" ON "Task"("tenantId", "dedupeKey");

-- CreateIndex
CREATE INDEX "Consent_tenantId_subjectType_subjectId_purpose_idx" ON "Consent"("tenantId", "subjectType", "subjectId", "purpose");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_entityType_entityId_idx" ON "AuditLog"("tenantId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_actorUserId_createdAt_idx" ON "AuditLog"("tenantId", "actorUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_tenantId_propertyId_fkey" FOREIGN KEY ("tenantId", "propertyId") REFERENCES "Property"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitAmenity" ADD CONSTRAINT "UnitAmenity_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitAmenity" ADD CONSTRAINT "UnitAmenity_amenityId_fkey" FOREIGN KEY ("amenityId") REFERENCES "Amenity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RatePlan" ADD CONSTRAINT "RatePlan_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyRate" ADD CONSTRAINT "DailyRate_ratePlanId_fkey" FOREIGN KEY ("ratePlanId") REFERENCES "RatePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyRate" ADD CONSTRAINT "DailyRate_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityBlock" ADD CONSTRAINT "AvailabilityBlock_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityBlock" ADD CONSTRAINT "AvailabilityBlock_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_tenantId_unitId_fkey" FOREIGN KEY ("tenantId", "unitId") REFERENCES "Unit"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_tenantId_primaryGuestId_fkey" FOREIGN KEY ("tenantId", "primaryGuestId") REFERENCES "Guest"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_ratePlanId_fkey" FOREIGN KEY ("ratePlanId") REFERENCES "RatePlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationGuest" ADD CONSTRAINT "ReservationGuest_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationGuest" ADD CONSTRAINT "ReservationGuest_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
