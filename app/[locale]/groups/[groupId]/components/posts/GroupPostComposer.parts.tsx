"use client";

// Tipos, helpers y constantes de GroupPostComposer (aislados; NO incluye el cuerpo ni los gesture locks).

import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  MAX_POST_IMAGES,
  type GroupVisibility,
  type Post,
  type PostMedia,
  type PostPremium,
} from "@/lib/posts/types";
import {
  MAX_VIDEO_DURATION_FREE_SECONDS,
  MAX_VIDEO_DURATION_PREMIUM_SECONDS,
} from "@/lib/posts/premium";
import { VibraNavigationIcon } from "@/app/components/VibraServiceIcons/VibraNavigationIcons";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { doc, getDoc } from "firebase/firestore";

import { auth, db } from "@/lib/firebase";
import { normalizeImageFile } from "@/lib/uploads/image-normalizer";
import PostComposerDesktopOverlay from "./PostComposerDesktopOverlay";
import PostComposerMobileOverlay from "./PostComposerMobileOverlay";
import { useComposerPremium } from "./useComposerPremium";

export type ComposerMediaItem = {
  type: "image" | "video";
  file: File;
  coverFile?: File | null;
  existingPostMedia?: PostMedia;
};

export type ComposerContextType = "group" | "profile";

export type GroupPostComposerSubmitPayload = {
  text: string;
  contextType: ComposerContextType;
  imageFiles?: File[];
  videoFiles?: File[];
  mediaItems?: ComposerMediaItem[];
  premium?: PostPremium | null;
};


// La forma de los botones de accion se mudo a `components/ui`: la comparten
// publicaciones y el compositor de live, que son rutas distintas. Se reexporta
// para no tocar los sitios que ya la importan de aqui.
export { BOTON_ACCION_FORMA } from "@/components/ui";

/**
 * En qué anda una publicación. Decide el TEXTO del botón.
 */
export type PublishPhase = "preparando" | "subiendoVideo" | "publicando";

/**
 * Avance de una publicación, para el relleno del botón.
 *
 * 🚨 `ratio` ES DEL CONJUNTO, de 0 a 1. Preparar las imágenes, subir cada video
 * y escribir la publicación NO son tres barras seguidas: son tramos de la misma.
 * El botón se llena una sola vez de vacío a lleno, pase lo que pase por dentro.
 *
 * Quien publica reparte el peso de cada tramo; el botón solo pinta lo que le
 * llega. Por eso el reparto vive en `repartirAvance`, aquí abajo, y no en cada
 * una de las cuatro pantallas que publican.
 */
export type PublishProgress = {
  ratio: number;
  phase: PublishPhase;
  /** Solo en `subiendoVideo`, para poder decir "Subiendo video 23%". */
  videoPct?: number;
};

/**
 * Reparto de la barra entre los tramos de una publicación.
 *
 * Los pesos salen de lo que tarda cada cosa de verdad: subir el video a Mux se
 * lleva la mayor parte del tiempo cuando hay video, y escribir el documento es
 * casi instantáneo. Sin video, preparar las imágenes ocupa su hueco.
 */
export function repartirAvance(params: {
  phase: PublishPhase;
  /** 0..100 de la subida del video en curso. */
  videoPct?: number;
  /** Cuál de los videos va, empezando en 0. */
  videoIndex?: number;
  videoTotal?: number;
  hayVideo: boolean;
}): PublishProgress {
  const { phase, videoPct = 0, videoIndex = 0, videoTotal = 1, hayVideo } = params;

  // Sin video la preparación es lo único que lleva tiempo, así que se le da casi
  // toda la barra; con video, el video manda.
  const pesoPreparar = hayVideo ? 0.12 : 0.85;
  const pesoVideo = hayVideo ? 0.8 : 0;

  if (phase === "preparando") {
    return { ratio: pesoPreparar * 0.9, phase };
  }

  if (phase === "subiendoVideo") {
    const total = Math.max(1, videoTotal);
    const hechos = Math.min(videoIndex, total - 1);
    const dentro = (hechos + Math.min(100, Math.max(0, videoPct)) / 100) / total;
    return {
      ratio: pesoPreparar + pesoVideo * dentro,
      phase,
      videoPct: Math.round(videoPct),
    };
  }

  // Escribir la publicación. Se deja en 0.97 y NO en 1: el 100 se reserva para
  // cuando la promesa resuelve de verdad, que es lo que la persona espera ver.
  return { ratio: 0.97, phase };
}

export type GroupPostComposerProps = {
  /**
   * Publica. El segundo argumento sirve para ir contando el avance; quien no
   * suba nada pesado puede ignorarlo y el botón se llenará por estimación.
   */
  onSubmit: (
    payload: GroupPostComposerSubmitPayload,
    onProgress?: (progreso: PublishProgress) => void
  ) => Promise<void>;
  onLiveClick?: () => void;
  contextType?: ComposerContextType;
  groupVisibility?: GroupVisibility | null;
  isOwner?: boolean;
  editPost?: Post | null;
  onEditClose?: () => void;
  /** Deep-link: al montar, abre el overlay del composer con premium activado. */
  autoOpenPremium?: boolean;
  /**
   * Aire propio arriba y abajo del compositor, en píxeles. Por defecto 12, que
   * es lo que necesita cuando va suelto en una comunidad.
   *
   * En el home no va suelto: lo aprieta el rail de reels por arriba y la primera
   * publicación por abajo, y cada uno trae ya su propio margen. Sumados, el
   * compositor quedaba flotando en un hueco de más de treinta píxeles por lado.
   * El horizontal NO se toca: ese sí lo necesita para no pegarse a las orillas.
   */
  paddingBlock?: number;
};

export type SelectedMediaItem = ComposerMediaItem & {
  id: string;
  previewUrl: string;
  durationSeconds: number | null;
  coverPreviewUrl?: string | null;
  autoCoverUrl?: string | null;
  autoCoverFile?: File | null;
  coverStatus?: "loading" | "ready" | "error";
  locked?: boolean;
};

export const MAX_POST_VIDEOS = 3;

export const fontStack =
  'inherit';

export function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return "U";
  return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

export function createLocalMediaId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function readVideoDurationFromUrl(previewUrl: string): Promise<number | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");

    video.preload = "metadata";

    video.onloadedmetadata = () => {
      resolve(Number.isFinite(video.duration) ? video.duration : null);
    };

    video.onerror = () => {
      resolve(null);
    };

    video.src = previewUrl;
  });
}

export function captureFirstVideoFrame(
  previewUrl: string,
  fileName: string,
): Promise<{ file: File; previewUrl: string } | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const canvas = document.createElement("canvas");

    let settled = false;

    function finish(value: { file: File; previewUrl: string } | null) {
      if (settled) return;
      settled = true;
      video.removeAttribute("src");
      video.load();
      resolve(value);
    }

    const timeoutId = window.setTimeout(() => {
      finish(null);
    }, 8000);

    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.crossOrigin = "anonymous";

    video.onerror = () => {
      window.clearTimeout(timeoutId);
      finish(null);
    };

    video.onloadedmetadata = () => {
      const seekTime =
        Number.isFinite(video.duration) && video.duration > 0 ? 0.01 : 0;

      try {
        video.currentTime = seekTime;
      } catch {
        window.clearTimeout(timeoutId);
        finish(null);
      }
    };

    video.onseeked = () => {
      try {
        const width = video.videoWidth || 720;
        const height = video.videoHeight || 1280;

        canvas.width = width;
        canvas.height = height;

        const context = canvas.getContext("2d");

        if (!context) {
          window.clearTimeout(timeoutId);
          finish(null);
          return;
        }

        context.drawImage(video, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            window.clearTimeout(timeoutId);

            if (!blob) {
              finish(null);
              return;
            }

            const safeBaseName =
              fileName.replace(/\.[^.]+$/, "") || "video-cover";
            const file = new File([blob], `${safeBaseName}-cover.jpg`, {
              type: "image/jpeg",
              lastModified: Date.now(),
            });

            finish({ file, previewUrl: URL.createObjectURL(file) });
          },
          "image/jpeg",
          0.86,
        );
      } catch {
        window.clearTimeout(timeoutId);
        finish(null);
      }
    };

    video.src = previewUrl;
  });
}

export function Avatar({
  name,
  avatarUrl,
  size = 36,
}: {
  name: string;
  avatarUrl?: string | null;
  size?: number;
}) {
  if (avatarUrl) {
    return (
      <Image
        src={avatarUrl}
        alt={name}
        width={size} height={size}
        style={{
          borderRadius: "50%",
          objectFit: "cover",
          display: "block",
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.04)",
          flexShrink: 0,
        }}
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        display: "grid",
        placeItems: "center",
        background: "rgba(255,255,255,0.08)",
        border: "1px solid rgba(255,255,255,0.08)",
        color: "#fff",
        fontSize: Math.max(11, Math.floor(size * 0.32)),
        fontWeight: 500,
        letterSpacing: "-0.02em",
        flexShrink: 0,
      }}
    >
      {getInitials(name)}
    </div>
  );
}

