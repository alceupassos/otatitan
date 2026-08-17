import "server-only";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { TenantTx } from "@/lib/db/with-tenant";

const MAX_FOTO_BYTES = 1_500_000;

function s3Configurado(): boolean {
  return Boolean(
    process.env.S3_BUCKET &&
      process.env.S3_ACCESS_KEY_ID &&
      process.env.S3_SECRET_ACCESS_KEY,
  );
}

function s3(): S3Client {
  return new S3Client({
    region: process.env.S3_REGION ?? "us-east-1",
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
  });
}

function decodificarDataUrl(bruto: string): { mime: string; bytes: Buffer } {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+=*)$/.exec(
    bruto.trim(),
  );
  if (!m) {
    throw new Error("A foto precisa ser JPEG, PNG ou WebP.");
  }
  const bytes = Buffer.from(m[2]!, "base64");
  if (bytes.length === 0 || bytes.length > MAX_FOTO_BYTES) {
    throw new Error("A foto é inválida ou grande demais.");
  }
  return { mime: m[1]!, bytes };
}

/**
 * Guarda a foto do responsável (privada). S3 se o ambiente tiver bucket;
 * senão, disco local em `uploads/media` — o caminho que não quebra
 * produção sem MinIO (docs/13).
 */
export async function guardarFotoResponsavel(opts: {
  tx: TenantTx;
  tenantId: string;
  guestId: string;
  reservationId: string;
  base64: string;
}): Promise<void> {
  const { mime, bytes } = decodificarDataUrl(opts.base64);
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const storageKey = `direct/${opts.tenantId}/guest/${opts.guestId}/${opts.reservationId}.${ext}`;
  const bucket = s3Configurado() ? process.env.S3_BUCKET! : "local";

  if (s3Configurado()) {
    await s3().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: storageKey,
        Body: bytes,
        ContentType: mime,
      }),
    );
  } else {
    const dest = path.join(process.cwd(), "uploads", "media", storageKey);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, bytes);
  }

  await opts.tx.media.create({
    data: {
      ownerType: "GUEST",
      ownerId: opts.guestId,
      bucket,
      storageKey,
      mimeType: mime,
      sizeBytes: bytes.length,
      checksumSha256: checksum,
      visibility: "PRIVATE",
      scanStatus: "SKIPPED",
      altText: "Foto do responsável pela reserva (portaria)",
    },
  });
}

export function storagePublicoDisponivel(): boolean {
  return s3Configurado();
}

export async function guardarFotoImovel(opts: {
  tx: TenantTx;
  propertyId: string;
  uploadedById: string;
  bytes: Buffer;
  mime: string;
  fileName: string;
  altText?: string;
  isCover?: boolean;
}): Promise<void> {
  const max = Number(process.env.MAX_UPLOAD_BYTES ?? 10_485_760);
  if (opts.bytes.length > max) {
    throw new Error("Arquivo acima do limite de upload.");
  }
  if (!/^image\/(jpeg|png|webp)$/.test(opts.mime)) {
    throw new Error("Use JPEG, PNG ou WebP.");
  }
  const ext = opts.mime === "image/png" ? "png" : opts.mime === "image/webp" ? "webp" : "jpg";
  const checksum = createHash("sha256").update(opts.bytes).digest("hex");
  const storageKey = `property/${opts.propertyId}/${Date.now()}-${checksum.slice(0, 8)}.${ext}`;
  const bucket = s3Configurado() ? process.env.S3_BUCKET! : "local";

  if (s3Configurado()) {
    await s3().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: storageKey,
        Body: opts.bytes,
        ContentType: opts.mime,
      }),
    );
  } else {
    const dest = path.join(process.cwd(), "uploads", "media", storageKey);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, opts.bytes);
  }

  if (opts.isCover) {
    await opts.tx.media.updateMany({
      where: { ownerType: "PROPERTY", ownerId: opts.propertyId, isCover: true },
      data: { isCover: false },
    });
  }

  await opts.tx.media.create({
    data: {
      ownerType: "PROPERTY",
      ownerId: opts.propertyId,
      bucket,
      storageKey,
      mimeType: opts.mime,
      sizeBytes: opts.bytes.length,
      checksumSha256: checksum,
      visibility: "PUBLIC_READ",
      scanStatus: "SKIPPED",
      isCover: opts.isCover ?? false,
      altText: opts.altText ?? opts.fileName,
      uploadedById: opts.uploadedById,
    },
  });
}

export function caminhoLocal(storageKey: string): string {
  return path.join(process.cwd(), "uploads", "media", storageKey);
}
