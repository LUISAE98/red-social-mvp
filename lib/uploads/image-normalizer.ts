import heic2any from "heic2any";

export type NormalizedImageFile = {
  file: File;
  wasConverted: boolean;
  originalType: string;
  originalName: string;
};

const DEFAULT_MAX_IMAGE_SIZE_BYTES = 80 * 1024 * 1024;

const WEB_SAFE_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const HEIC_IMAGE_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

function getSafeBaseName(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^/.]+$/, "");
  const safe = withoutExtension
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return safe || "image";
}

function isHeicLikeFile(file: File): boolean {
  const type = (file.type || "").toLowerCase();
  const name = (file.name || "").toLowerCase();

  return (
    HEIC_IMAGE_TYPES.has(type) ||
    type.includes("heic") ||
    type.includes("heif") ||
    name.endsWith(".heic") ||
    name.endsWith(".heif") ||
    name.includes("heic") ||
    name.includes("heif")
  );
}

function isWebSafeImage(file: File): boolean {
  const type = (file.type || "").toLowerCase();
  const name = (file.name || "").toLowerCase();

  return (
    WEB_SAFE_IMAGE_TYPES.has(type) ||
    name.endsWith(".jpg") ||
    name.endsWith(".jpeg") ||
    name.endsWith(".png") ||
    name.endsWith(".webp") ||
    name.endsWith(".gif")
  );
}

function assertMaxSize(file: File, maxSizeBytes: number) {
  if (file.size > maxSizeBytes) {
    throw new Error("La imagen no puede pesar más de 80 MB.");
  }
}

async function convertHeicToJpeg(file: File): Promise<File> {
  const converted = await heic2any({
    blob: file,
    toType: "image/jpeg",
    quality: 0.88,
  });

  const blob = Array.isArray(converted) ? converted[0] : converted;

  if (!(blob instanceof Blob)) {
    throw new Error("No se pudo convertir la imagen del iPhone.");
  }

  const nextName = `${getSafeBaseName(file.name)}.jpg`;

  return new File([blob], nextName, {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
}

export async function normalizeImageFile(
  file: File,
  options?: {
    maxSizeBytes?: number;
  }
): Promise<NormalizedImageFile> {
  const maxSizeBytes = options?.maxSizeBytes ?? DEFAULT_MAX_IMAGE_SIZE_BYTES;

  assertMaxSize(file, maxSizeBytes);

  const originalType = file.type || "application/octet-stream";
  const originalName = file.name || "image";

  if (isHeicLikeFile(file)) {
    const convertedFile = await convertHeicToJpeg(file);
    assertMaxSize(convertedFile, maxSizeBytes);

    return {
      file: convertedFile,
      wasConverted: true,
      originalType,
      originalName,
    };
  }

if (isWebSafeImage(file)) {
  assertMaxSize(file, maxSizeBytes);

  return {
    file,
    wasConverted: false,
    originalType,
    originalName,
  };
}

  try {
    const convertedFile = await convertHeicToJpeg(file);
    assertMaxSize(convertedFile, maxSizeBytes);

    return {
      file: convertedFile,
      wasConverted: true,
      originalType,
      originalName,
    };
  } catch (e: any) {
  throw new Error(
    e?.message
      ? `No se pudo convertir la imagen del iPhone: ${e.message}`
      : "No se pudo convertir la imagen del iPhone."
  );
}
}