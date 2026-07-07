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

export type CreateMuxDirectUploadResponse = {
  provider: "mux";
  uploadId: string;
  uploadUrl: string;
  postId: string;
  mediaId: string;
  status: string;
};

export const VIDEO_MAX_DURATION_SECONDS = 60 * 30;

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

export async function getCroppedBlob(
  imageSrc: string,
  pixelCrop: Area,
  mime = "image/jpeg"
): Promise<Blob> {
  const image = await createImage(imageSrc);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo inicializar canvas");

  const safeX = clamp(pixelCrop.x, 0, image.width);
  const safeY = clamp(pixelCrop.y, 0, image.height);
  const safeW = clamp(pixelCrop.width, 1, image.width - safeX);
  const safeH = clamp(pixelCrop.height, 1, image.height - safeY);

  canvas.width = Math.floor(safeW);
  canvas.height = Math.floor(safeH);

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

export function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const objectUrl = URL.createObjectURL(file);

    video.preload = "metadata";

    video.onloadedmetadata = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(video.duration);
    };

    video.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("No se pudo leer la duración del video."));
    };

    video.src = objectUrl;
  });
}

export function uploadVideoFileToMux(params: {
  uploadUrl: string;
  file: File;
  onProgress: (progress: number) => void;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      params.onProgress(Math.round((event.loaded / event.total) * 100));
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }

      reject(new Error(`Mux upload falló con status ${xhr.status}.`));
    };

    xhr.onerror = () => {
      reject(new Error("Error de red al subir el video a Mux."));
    };

    xhr.open("PUT", params.uploadUrl);
    xhr.setRequestHeader("Content-Type", params.file.type || "video/mp4");
    xhr.send(params.file);
  });
}
