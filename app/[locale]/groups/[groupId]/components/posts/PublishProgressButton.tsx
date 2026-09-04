"use client";

import { useTranslations } from "next-intl";
import type { CSSProperties } from "react";

import { fontStack, type PublishProgress } from "./GroupPostComposer.parts";

/**
 * El botón de publicar, que se llena mientras publica.
 *
 * La barra es UNA sola de vacío a lleno, pase lo que pase por dentro: preparar
 * las imágenes, subir cada video a Mux y escribir la publicación son tramos del
 * mismo recorrido, no barras encadenadas. El reparto lo hace `repartirAvance`;
 * aquí solo se pinta lo que llega.
 *
 * ⚠️ El relleno va con `transform: scaleX`, NO con `width`. Animar el ancho
 * obliga al navegador a recalcular la maquetación en cada fotograma, y en un
 * celular subiendo un video —que ya va justo de trabajo— eso se ve a tirones.
 * `transform` lo resuelve la tarjeta gráfica sin tocar el layout.
 *
 * El texto cambia con la fase porque una espera larga sin explicación se lee
 * como algo colgado. Si hay un porcentaje de video, se dice: es el único tramo
 * que puede tardar de verdad y saber cuánto queda cambia la espera.
 */
export default function PublishProgressButton({
  progress,
  creating,
  success = false,
  disabled = false,
  isEditMode = false,
  onClick,
  style,
}: {
  progress: PublishProgress | null;
  creating: boolean;
  success?: boolean;
  disabled?: boolean;
  isEditMode?: boolean;
  onClick: () => void;
  style?: CSSProperties;
}) {
  const tCommon = useTranslations("common");

  const ratio = Math.max(0, Math.min(1, progress?.ratio ?? 0));
  const activo = creating || success;

  const etiqueta = success
    ? tCommon("done")
    : progress?.phase === "subiendoVideo" && typeof progress.videoPct === "number"
      ? tCommon("uploadingVideoPct", { progress: progress.videoPct })
      : creating
        ? tCommon("publishing")
        : isEditMode
          ? tCommon("save")
          : tCommon("publish");

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || activo}
      aria-label={etiqueta}
      // Se anuncia el avance para quien navega con lector de pantalla, que no
      // ve el relleno.
      aria-busy={creating || undefined}
      style={{
        position: "relative",
        overflow: "hidden",
        width: "100%",
        height: 46,
        border: "none",
        borderRadius: 12,
        background: success
          ? "#22c55e"
          : disabled && !activo
            ? "rgba(255,255,255,0.1)"
            : // Con la publicación en marcha el fondo baja de tono: es el
              // carril por el que corre el relleno, no el botón vivo.
              activo
              ? "rgba(168,85,247,0.28)"
              : "#a855f7",
        color:
          disabled && !activo ? "rgba(255,255,255,0.36)" : "rgba(255,255,255,0.98)",
        fontSize: 16,
        fontWeight: 550,
        fontFamily: fontStack,
        letterSpacing: "-0.02em",
        cursor: disabled || activo ? "default" : "pointer",
        display: "grid",
        placeItems: "center",
        boxSizing: "border-box",
        transition: "background-color 180ms ease, color 180ms ease",
        ...style,
      }}
    >
      {activo && !success ? (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            background: "#a855f7",
            transformOrigin: "left center",
            transform: `scaleX(${ratio})`,
            // Largo a propósito: los reportes de Mux llegan a saltos, y sin un
            // suavizado generoso la barra da tirones en vez de correr.
            transition: "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        />
      ) : null}

      <span style={{ position: "relative", zIndex: 1 }}>{etiqueta}</span>
    </button>
  );
}
