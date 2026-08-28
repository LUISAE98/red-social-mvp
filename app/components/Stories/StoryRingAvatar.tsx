"use client";

import Image from "next/image";
import { useCallback, useRef, useState } from "react";
import { recordStoryView } from "@/lib/stories/storyService";
import { useStoryRingState } from "@/lib/stories/useStoryRingState";
import StoryViewer from "./StoryViewer";

const VIBRA_GRADIENT =
  "linear-gradient(135deg, #ec4899 0%, #9333ea 52%, #3b82f6 100%)";

/** Grosor del aro. */
const RING_W = 2.4;
/** Hueco entre el aro y el avatar. Transparente: deja ver lo que haya detrás. */
const GAP_W = 1.5;

/**
 * Recorta el centro del aro para que sea un ANILLO, no un círculo relleno.
 *
 * ⚠️ El hueco entre el aro y el avatar era un borde de color fijo, `rgb(10,10,14)`.
 * Sobre el fondo oscuro del home colaba, pero este avatar se usa en veinte sitios
 * —encima de miniaturas, dentro de tarjetas, en el chat— y ahí se leía como un
 * segundo anillo negro pegado al de Vibra. Un separador no puede ser de un color
 * concreto cuando no sabes qué hay detrás: tiene que ser un agujero.
 *
 * `closest-side` en una caja cuadrada hace que el 100% sea el radio, así que el
 * corte cae justo a `RING_W` del borde. El medio píxel de más es para que el
 * canto quede suavizado y no dentado.
 */
const SOLO_ANILLO =
  `radial-gradient(circle closest-side, transparent calc(100% - ${RING_W}px), ` +
  `#000 calc(100% - ${RING_W}px + 0.5px))`;

type Props = {
  entityId: string;
  entityType: "profile" | "group";
  currentUserId?: string | null;
  photoURL?: string | null;
  displayName: string;
  /** Outer container size in px. Avatar image fills this when no ring; shrinks slightly when ring shows. */
  size?: number;
  /** Called when clicked and there are no stories (e.g. navigate to profile). */
  onClick?: (e: React.MouseEvent) => void;
  style?: React.CSSProperties;
};

export default function StoryRingAvatar({
  entityId,
  entityType,
  currentUserId,
  photoURL,
  displayName,
  size = 40,
  onClick,
  style,
}: Props) {
  const { ring, stories, startIndex } = useStoryRingState(
    entityId,
    entityType,
    currentUserId,
  );
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerSourceRect, setViewerSourceRect] = useState<DOMRect | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (ring !== "none" && stories.length > 0) {
        e.stopPropagation();
        setViewerSourceRect(buttonRef.current?.getBoundingClientRect() ?? null);
        setViewerOpen(true);
      } else {
        onClick?.(e);
      }
    },
    [ring, stories.length, onClick],
  );

  const handleStoryViewed = useCallback(
    (storyId: string) => {
      if (currentUserId) recordStoryView(currentUserId, storyId).catch(console.error);
    },
    [currentUserId],
  );

  // Se puede ABRIR mientras haya historias, vistas o no: el aro gris ya no está,
  // pero volver a ver lo de alguien sigue siendo legítimo.
  const hasStories = ring !== "none" && stories.length > 0;

  // ⚠️ El aro solo existe cuando hay algo NUEVO. El estado "visto" pintaba un
  // aro gris que no invitaba a nada y llenaba de anillos apagados cualquier
  // pantalla con varias filas de avatares. Sin nada nuevo, el avatar se enseña
  // tal cual, y el aro reaparece en cuanto suben una historia.
  const showRing = ring === "vibra";

  // El avatar cede lo que ocupan el aro y su hueco, para que el conjunto siga
  // midiendo `size` y no descuadre a quien lo coloca.
  const avatarSize = showRing ? size - 2 * (RING_W + GAP_W) : size;

  const initials = (() => {
    const parts = displayName.trim().split(/\s+/).filter(Boolean);
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
  })();

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleClick}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          margin: 0,
          cursor: hasStories || onClick ? "pointer" : "default",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          WebkitTapHighlightColor: "transparent",
          flexShrink: 0,
          width: size,
          height: size,
          // Ancla del aro, que va posicionado encima.
          position: "relative",
          ...style,
        }}
        aria-label={hasStories ? `Ver historias de ${displayName}` : displayName}
      >
        {/* El aro, recortado por dentro. Va SUELTO y no envolviendo al avatar:
            así el hueco que deja es transparente de verdad y no el color de un
            fondo que este componente no controla. */}
        {showRing && (
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              background: VIBRA_GRADIENT,
              WebkitMaskImage: SOLO_ANILLO,
              maskImage: SOLO_ANILLO,
              pointerEvents: "none",
            }}
          />
        )}
        <span
          style={{
            width: avatarSize,
            height: avatarSize,
            borderRadius: "50%",
            overflow: "hidden",
            background: "#1a1a2e",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxSizing: "border-box",
            position: "relative",
            flexShrink: 0,
          }}
        >
          {photoURL ? (
            <Image
              src={photoURL}
              alt={displayName}
              fill
              style={{ objectFit: "cover" }}
            />
          ) : (
            <span
              style={{
                color: "#fff",
                fontSize: Math.max(10, Math.floor(size * 0.32)),
                fontWeight: 600,
                lineHeight: 1,
                userSelect: "none",
              }}
            >
              {initials}
            </span>
          )}
        </span>
      </button>

      {viewerOpen && (
        <StoryViewer
          stories={stories}
          initialIndex={startIndex}
          onClose={() => setViewerOpen(false)}
          onStoryViewed={handleStoryViewed}
          sourceRect={viewerSourceRect}
        />
      )}
    </>
  );
}
