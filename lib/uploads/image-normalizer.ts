import heic2any from "heic2any";

export type NormalizedImageFile = {
  file: File;
  wasConverted: boolean;
  originalType: string;
  originalName: string;
};

const DEFAULT_MAX_IMAGE_SIZE_BYTES = 150 * 1024 * 1024;

const OUTPUT_MAX_WIDTH = 2000;
const OUTPUT_MAX_HEIGHT = 2000;
const OUTPUT_QUALITY = 0.82;

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
    throw new Error("La imagen no puede pesar más de 150 MB.");
  }
}

function getOutputSize(width: number, height: number) {
  const ratio = Math.min(
    OUTPUT_MAX_WIDTH / width,
    OUTPUT_MAX_HEIGHT / height,
    1
  );

  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("El navegador no pudo leer esta imagen."));
    };

    image.src = objectUrl;
  });
}

async function compressImageToJpeg(file: File): Promise<File> {
  const image = await loadImageFromFile(file);

  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;

  if (!sourceWidth || !sourceHeight) {
    throw new Error("No se pudo leer el tamaño de la imagen.");
  }

  const outputSize = getOutputSize(sourceWidth, sourceHeight);

  const canvas = document.createElement("canvas");
  canvas.width = outputSize.width;
  canvas.height = outputSize.height;

  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("No se pudo preparar la imagen.");
  }

  ctx.drawImage(image, 0, 0, outputSize.width, outputSize.height);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (!result) {
          reject(new Error("No se pudo comprimir la imagen."));
          return;
        }

        resolve(result);
      },
      "image/jpeg",
      OUTPUT_QUALITY
    );
  });

  const nextName = `${getSafeBaseName(file.name)}.jpg`;

  return new File([blob], nextName, {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
}

async function convertHeicToJpeg(file: File): Promise<File> {
  const nextName = `${getSafeBaseName(file.name)}.jpg`;

  try {
    const converted = await heic2any({
      blob: file,
      toType: "image/jpeg",
      quality: 0.88,
    });

    const blob = Array.isArray(converted) ? converted[0] : converted;

    if (blob instanceof Blob) {
      const convertedFile = new File([blob], nextName, {
        type: "image/jpeg",
        lastModified: Date.now(),
      });

      return compressImageToJpeg(convertedFile);
    }
  } catch {
    // Fallback abajo.
  }

  return compressImageToJpeg(
    new File([file], nextName, {
      type: "image/jpeg",
      lastModified: Date.now(),
    })
  );
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

    return {
      file: convertedFile,
      wasConverted: true,
      originalType,
      originalName,
    };
  }

  if (isWebSafeImage(file)) {
    const compressedFile = await compressImageToJpeg(file);

    return {
      file: compressedFile,
      wasConverted: false,
      originalType,
      originalName,
    };
  }

  try {
    const convertedFile = await convertHeicToJpeg(file);

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