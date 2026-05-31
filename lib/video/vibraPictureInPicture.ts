export type VibraPiPResult =
  | { ok: true; mode: "standard" | "webkit" | "android-fullscreen" }
  | { ok: false; reason: string };

type WebKitVideo = HTMLVideoElement & {
  webkitSupportsPresentationMode?: (mode: "picture-in-picture" | "fullscreen") => boolean;
  webkitSetPresentationMode?: (mode: "picture-in-picture" | "inline" | "fullscreen") => void;
  webkitPresentationMode?: string;
};

function isAndroid() {
  return /Android/i.test(navigator.userAgent);
}

export async function enterVibraPictureInPicture(
  video: HTMLVideoElement | null,
): Promise<VibraPiPResult> {
  if (!video) return { ok: false, reason: "No hay video activo." };

  try {
    if (video.paused) {
      await video.play();
    }
  } catch {
    return { ok: false, reason: "El navegador bloqueó la reproducción automática." };
  }

  const webkitVideo = video as WebKitVideo;

  try {
    if (
      typeof webkitVideo.webkitSupportsPresentationMode === "function" &&
      webkitVideo.webkitSupportsPresentationMode("picture-in-picture") &&
      typeof webkitVideo.webkitSetPresentationMode === "function"
    ) {
      webkitVideo.webkitSetPresentationMode("picture-in-picture");
      return { ok: true, mode: "webkit" };
    }

    if (
      document.pictureInPictureEnabled &&
      typeof video.requestPictureInPicture === "function"
    ) {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }

      return { ok: true, mode: "standard" };
    }

    if (isAndroid() && typeof video.requestFullscreen === "function") {
      await video.requestFullscreen();
      return { ok: true, mode: "android-fullscreen" };
    }

    return {
      ok: false,
      reason: "Este navegador no permite activar PiP desde la web.",
    };
  } catch {
    return {
      ok: false,
      reason: "No se pudo activar PiP. Intenta reproducir el video y salir con Home.",
    };
  }
}