// Los helpers de subida a Mux (getVideoDuration, uploadVideoFileToMux,
// VIDEO_MAX_DURATION_SECONDS y CreateMuxDirectUploadResponse) se mudaron a
// lib/posts/muxDirectUpload: los usa también el compositor del home.
// ProfileClient.utils.ts
// Helpers puros y tipos auxiliares extraídos de ProfileClient.tsx.
// No dependen del estado del componente; manipulan archivos, imágenes y fechas.

export type FirestoreDateLike =
  | string
  | Date
  | {
      toDate?: () => Date;
    }
  | null
  | undefined;

export type CropMode = "avatar" | "cover";
export type Area = { x: number; y: number; width: number; height: number };

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "";
  const b = parts[1]?.[0] ?? "";
  return (a + b).toUpperCase() || "?";
}

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function dataUrlFromFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = (e) => reject(e);
    r.readAsDataURL(file);
  });
}

export function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.addEventListener("load", () => resolve(img));
    img.addEventListener("error", (e) => reject(e));
    img.setAttribute("crossOrigin", "anonymous");
    img.src = url;
  });
}

export function normalizeDateValue(value?: FirestoreDateLike): string | Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "object" && typeof value.toDate === "function") {
    return value.toDate();
  }
  if (typeof value === "string") return value;
  return null;
}

/**
 * `maxSize` limita el lado mayor del archivo que se sube, conservando la
 * proporción.
 *
 * Hace falta porque el origen del recorte ya viene normalizado a 2 000 px, así
 * que sin tope un avatar se guardaba a 2 000 × 2 000 — y ESE es el archivo que
 * descarga cada avatar de 40 píxeles del feed, decenas de veces por pantalla.
 * El recorte se sigue haciendo a resolución completa; lo único que cambia es el
 * tamaño al que se pinta en el lienzo.
 *
 * Sin `maxSize` el comportamiento es el de antes: sin tope.
 */
export async function getCroppedBlob(
  imageSrc: string,
  pixelCrop: Area,
  mime = "image/jpeg",
  maxSize?: number
): Promise<Blob> {
  const image = await createImage(imageSrc);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo inicializar canvas");

  const safeX = clamp(pixelCrop.x, 0, image.width);
  const safeY = clamp(pixelCrop.y, 0, image.height);
  const safeW = clamp(pixelCrop.width, 1, image.width - safeX);
  const safeH = clamp(pixelCrop.height, 1, image.height - safeY);

  // Nunca se AMPLÍA: el factor se limita a 1 para que un recorte pequeño no se
  // estire hasta el tope y pierda nitidez.
  const escala = maxSize ? Math.min(1, maxSize / Math.max(safeW, safeH)) : 1;

  canvas.width = Math.max(1, Math.floor(safeW * escala));
  canvas.height = Math.max(1, Math.floor(safeH * escala));

  ctx.drawImage(
    image,
    safeX,
    safeY,
    safeW,
    safeH,
    0,
    0,
    canvas.width,
    canvas.height
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error("No se pudo generar blob"));
        resolve(blob);
      },
      mime,
      0.9
    );
  });
}


