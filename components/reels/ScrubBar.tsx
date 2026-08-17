"use client";

// Barra de progreso que además sirve para moverse por el video.
//
// Funciona igual con el dedo y con el ratón: se usa la API de puntero, que
// unifica los dos, en vez de duplicar la lógica con eventos táctiles.
//
// Mientras arrastras, quien manda es el arrastre y no el video. Si no, cada
// fotograma reproducido devolvería el indicador a su sitio y el dedo pelearía
// contra la reproducción.

import { useCallback, useRef, useState } from "react";
import { useDirectionFactor } from "@/lib/i18n/useDirectionFactor";

type Props = {
  /** Progreso real del video, de 0 a 1. */
  progress: number;
  /** Salta a esa fracción del video. */
  onSeek: (ratio: number) => void;
  /** Se avisa al empezar y terminar de arrastrar (para pausar mientras). */
  onScrubbingChange?: (scrubbing: boolean) => void;
  /** Alto de la barra pintada. El área sensible al dedo es mayor. */
  height?: number;
  ariaLabel: string;
};

/** Alto del área que responde al dedo, por encima del grosor visible. */
const HIT_HEIGHT = 22;

export default function ScrubBar({
  progress,
  onSeek,
  onScrubbingChange,
  height = 3,
  ariaLabel,
}: Props) {
  const dirX = useDirectionFactor();
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [preview, setPreview] = useState(0);

  const ratioAt = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0) return 0;
      const raw = (clientX - rect.left) / rect.width;
      // En lectura de derecha a izquierda el principio del video está a la
      // derecha, así que la fracción se invierte.
      const oriented = dirX === -1 ? 1 - raw : raw;
      return Math.min(1, Math.max(0, oriented));
    },
    [dirX],
  );

  const begin = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = trackRef.current;
      if (!el) return;
      const ratio = ratioAt(e.clientX);
      setScrubbing(true);
      setPreview(ratio);
      onScrubbingChange?.(true);
      onSeek(ratio);
      el.setPointerCapture(e.pointerId);
    },
    [ratioAt, onSeek, onScrubbingChange],
  );

  const move = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!scrubbing) return;
      const ratio = ratioAt(e.clientX);
      setPreview(ratio);
      onSeek(ratio);
    },
    [scrubbing, ratioAt, onSeek],
  );

  const end = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!scrubbing) return;
      setScrubbing(false);
      onScrubbingChange?.(false);
      const el = trackRef.current;
      if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    },
    [scrubbing, onScrubbingChange],
  );

  const shown = scrubbing ? preview : progress;

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(shown * 100)}
      tabIndex={0}
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") onSeek(Math.min(1, progress + 0.05));
        if (e.key === "ArrowLeft") onSeek(Math.max(0, progress - 0.05));
      }}
      // Impide que el gesto se lo lleve el scroll vertical del reel: sin esto,
      // arrastrar en la barra pasa a la siguiente historia.
      style={{
        position: "relative",
        flex: 1,
        height: HIT_HEIGHT,
        display: "flex",
        alignItems: "center",
        cursor: "pointer",
        touchAction: "none",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <div
        style={{
          width: "100%",
          height: scrubbing ? height + 2 : height,
          borderRadius: 2,
          background: "rgba(255,255,255,0.3)",
          overflow: "hidden",
          transition: "height 120ms ease",
        }}
      >
        <div
          style={{
            height: "100%",
            borderRadius: 2,
            background: "#fff",
            width: `${Math.round(shown * 100)}%`,
            // Sin transición: el ancho lo mueve cada fotograma del video, y
            // animarlo lo dejaría siempre por detrás de la imagen.
            transition: "none",
          }}
        />
      </div>
    </div>
  );
}
