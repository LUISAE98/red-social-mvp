export type CropPixels = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.crossOrigin = "anonymous";
    image.decoding = "async";

    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("No se pudo cargar la imagen para recortarla."));

    image.src = url;
  });
}

function sanitizeCrop(crop: CropPixels, imageWidth: number, imageHeight: number): CropPixels {
  const x = Math.max(0, Math.floor(crop.x));
  const y = Math.max(0, Math.floor(crop.y));
  const width = Math.max(1, Math.floor(crop.width));
  const height = Math.max(1, Math.floor(crop.height));

  const safeWidth = Math.min(width, imageWidth - x);
  const safeHeight = Math.min(height, imageHeight - y);

  return {
    x,
    y,
    width: Math.max(1, safeWidth),
    height: Math.max(1, safeHeight),
  };
}

export async function cropImageToBlob(
  imageSrc: string,
  crop: CropPixels,
  mimeType: "image/jpeg" | "image/png" | "image/webp" = "image/jpeg",
  quality = 0.92
): Promise<Blob> {
  if (!imageSrc) {
    throw new Error("No se recibió una imagen válida.");
  }

  const image = await createImage(imageSrc);
  const safeCrop = sanitizeCrop(crop, image.naturalWidth, image.naturalHeight);

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("No se pudo crear el contexto del canvas.");
  }

  canvas.width = safeCrop.width;
  canvas.height = safeCrop.height;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  ctx.drawImage(
    image,
    safeCrop.x,
    safeCrop.y,
    safeCrop.width,
    safeCrop.height,
    0,
    0,
    canvas.width,
    canvas.height
  );

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (!result) {
          reject(new Error("No se pudo generar el archivo recortado."));
          return;
        }
        resolve(result);
      },
      mimeType,
      mimeType === "image/jpeg" || mimeType === "image/webp" ? quality : undefined
    );
  });

  return blob;
}