"use client";

/**
 * Subida directa de video a Mux (VOD) desde el navegador.
 *
 * Vivían en `ProfileClient.utils`, colgando de la ruta del perfil. Al necesitarlos
 * también para publicar desde el home se movieron aquí: no tienen nada de
 * "perfil", son el contrato genérico de subir un archivo a una URL directa de
 * Mux, y `lib/` no puede depender de una carpeta de `app/`.
 *
 * Recuerda el reparto de motores de video de Vibra: Mux es SOLO el VOD de las
 * publicaciones. Los lives van por Cloudflare Stream y las llamadas 1-a-1 por
 * LiveKit.
 */

export type CreateMuxDirectUploadResponse = {
  provider: "mux";
  uploadId: string;
  uploadUrl: string;
  postId: string;
  mediaId: string;
  status: string;
};

/** Tope de duración por video: 30 minutos. */
export const VIDEO_MAX_DURATION_SECONDS = 60 * 30;

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
