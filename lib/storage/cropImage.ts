export type CropPixels = { x: number; y: number; width: number; height: number };

function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = (e) => reject(e);
    image.src = url;
  });
}

export async function cropImageToBlob(imageSrc: string, crop: CropPixels, mimeType = "image/jpeg", quality = 0.92) {
  const image = await createImage(imageSrc);

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo crear el contexto del canvas.");

  canvas.width = Math.max(1, Math.floor(crop.width));
  canvas.height = Math.max(1, Math.floor(crop.height));

  ctx.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    canvas.width,
    canvas.height
  );

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("No se pudo generar el Blob."))),
      mimeType,
      mimeType === "image/jpeg" ? quality : undefined
    );
  });

  return blob;
}