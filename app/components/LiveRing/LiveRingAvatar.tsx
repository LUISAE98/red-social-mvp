"use client";

import Image from "next/image";
import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useLiveRingState } from "@/lib/live/useLiveRingState";
import StoryRingAvatar from "@/app/components/Stories/StoryRingAvatar";
import type { Post } from "@/lib/posts/types";
import dynamic from "next/dynamic";

const LiveViewerModal = dynamic(
  () => import("@/app/components/LiveViewerModal/LiveViewerModal"),
  { ssr: false }
);

const LIVE_RED = "#ef4444";
const GAP_COLOR = "rgb(10,10,14)";
const FONT =
  'inherit';

type Props = {
  entityId: string;
  entityType: "profile" | "group";
  currentUserId?: string | null;
  photoURL?: string | null;
  displayName: string;
  size?: number;
  onClick?: (e: React.MouseEvent) => void;
  style?: React.CSSProperties;
};

export default function LiveRingAvatar({
  entityId,
  entityType,
  currentUserId,
  photoURL,
  displayName,
  size = 40,
  onClick,
  style,
}: Props) {
  const tLive = useTranslations("live");
  const { isLive, livePostId } = useLiveRingState(entityId, entityType);
  const [livePost, setLivePost] = useState<Post | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [fetching, setFetching] = useState(false);

  const handleLiveClick = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!livePostId || fetching) return;
      setFetching(true);
      try {
        const snap = await getDoc(doc(db, "posts", livePostId));
        if (snap.exists()) {
          setLivePost({ id: snap.id, ...snap.data() } as Post);
          setViewerOpen(true);
        }
      } catch {
        // silencioso — el live puede haber terminado justo antes del clic
      } finally {
        setFetching(false);
      }
    },
    [livePostId, fetching]
  );

  // Sin live activo → delegar a StoryRingAvatar (historias o sin anillo)
  if (!isLive) {
    return (
      <StoryRingAvatar
        entityId={entityId}
        entityType={entityType}
        currentUserId={currentUserId}
        photoURL={photoURL}
        displayName={displayName}
        size={size}
        onClick={onClick}
        style={style}
      />
    );
  }

  const ringPad = 2.5;
  /**
   * Hueco entre el aro y el avatar. TRANSPARENTE.
   *
   * ⚠️ Antes era un borde de `GAP_COLOR` sobre un círculo rojo relleno, y encima
   * de una miniatura o de una tarjeta clara se leía como un segundo anillo negro.
   * Ahora el aro es un borde sobre una caja sin fondo, así que el hueco enseña lo
   * que haya detrás en vez de un color fijo que este componente no puede conocer.
   */
  const gapPad = 1.5;
  const initials = (() => {
    const parts = displayName.trim().split(/\s+/).filter(Boolean);
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
  })();

  // Dot pulsante: tamaño proporcional al avatar
  const outerDot = Math.max(10, Math.round(size * 0.28));
  const innerDot = Math.round(outerDot * 0.54);
  const dotShell = outerDot + 4; // borde oscuro para contraste

  return (
    <>
      <div
        style={{
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          width: size,
          height: size,
          paddingBottom: Math.round(outerDot / 2),
          boxSizing: "content-box",
          ...style,
        }}
      >
        <button
          type="button"
          onClick={handleLiveClick}
          disabled={fetching}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            margin: 0,
            cursor: fetching ? "wait" : "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
            width: size,
            height: size,
            WebkitTapHighlightColor: "transparent",
            flexShrink: 0,
          }}
          aria-label={tLive("watchLiveOf", { name: displayName })}
        >
          {/* Anillo rojo. Es un BORDE sobre una caja sin fondo, y el hueco hasta
              el avatar es su padding: dos capas, no tres, y la de en medio no
              pinta nada. */}
          <div
            style={{
              width: "100%",
              height: "100%",
              borderRadius: "50%",
              border: `${ringPad}px solid ${LIVE_RED}`,
              background: "transparent",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: gapPad,
              boxSizing: "border-box",
            }}
          >
            {/* Avatar */}
            <div
              style={{
                width: "100%",
                height: "100%",
                borderRadius: "50%",
                overflow: "hidden",
                background: "#1a1a2e",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxSizing: "border-box",
                position: "relative",
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
            </div>
          </div>

          {/* Dot pulsante — centro del aro en la parte inferior (6 en punto) */}
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: "50%",
              transform: `translate(-50%, calc(50% - ${ringPad / 2}px))`,
              width: dotShell,
              height: dotShell,
              borderRadius: "50%",
              background: GAP_COLOR,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
              zIndex: 2,
            }}
          >
            <div style={{
              position: "absolute",
              width: outerDot,
              height: outerDot,
              borderRadius: "50%",
              background: LIVE_RED,
              animation: "lraOuter 1.6s ease-in-out infinite",
            }} />
            <div style={{
              position: "absolute",
              width: innerDot,
              height: innerDot,
              borderRadius: "50%",
              background: LIVE_RED,
              animation: "lraInner 1.6s ease-in-out infinite",
            }} />
          </div>
        </button>

        <style>{`
          @keyframes lraOuter {
            0%, 100% { transform: scale(1); opacity: 0.5; }
            50% { transform: scale(1.5); opacity: 0.15; }
          }
          @keyframes lraInner {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(0.8); }
          }
        `}</style>
      </div>

      {viewerOpen && livePost && (
        <LiveViewerModal
          open={viewerOpen}
          onClose={() => {
            setViewerOpen(false);
            setLivePost(null);
          }}
          post={livePost}
        />
      )}
    </>
  );
}
