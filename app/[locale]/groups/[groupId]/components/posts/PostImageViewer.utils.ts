// PostImageViewer.utils.ts
// Helpers puros extraídos de PostImageViewer.tsx. No dependen del estado del
// componente. El tipo ViewerMediaItem se importa como type-only desde el
// componente (sin ciclo en runtime) para mantener una sola fuente de verdad.

import type { ViewerMediaItem } from "./PostImageViewer";

export const fontStack = 'inherit';

export function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return "U";
  return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

export function formatMediaDuration(seconds?: number | null): string {
  if (
    typeof seconds !== "number" ||
    !Number.isFinite(seconds) ||
    seconds <= 0
  ) {
    return "0:00";
  }

  const totalSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;

  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

export function getVideoSrc(media: ViewerMediaItem | null): string | null {
  if (!media || media.type !== "video") return null;

  if (typeof media.hlsUrl === "string" && media.hlsUrl.trim().length > 0) {
    return media.hlsUrl.trim();
  }

  if (
    typeof media.playbackUrl === "string" &&
    media.playbackUrl.trim().length > 0
  ) {
    return media.playbackUrl.trim();
  }

  if (
    typeof media.url === "string" &&
    media.url.trim().length > 0 &&
    !media.url.startsWith("mux://uploads/")
  ) {
    return media.url.trim();
  }

  return null;
}
