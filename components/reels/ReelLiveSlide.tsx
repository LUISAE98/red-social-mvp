"use client";

// UN live a pantalla completa dentro del feed de reels.
//
// Es un ANTICIPO, no el live. Se ve y se oye lo que está pasando, pero el chat,
// las donaciones, los super comentarios y el conteo de espectadores viven en el
// visor, y ahí solo se entra tocando. Es el trato que hace TikTok: el feed
// enseña, no mete.
//
// El reproductor NO es propio. `LiveInlinePlayer` ya resuelve lo difícil —HLS con
// hls.js, WebRTC de Cloudflare, portada mientras carga, orientación del video y
// el reintento en silencio cuando el navegador bloquea el audio— y está probado
// en el feed de comunidades. Escribir un segundo reproductor aquí habría
// duplicado justo la parte que más cuesta mantener.

import { useEffect, useState } from "react";
import Image from "next/image";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { ReelLivePost } from "@/lib/reels/reelItems";
import FollowCreatorButton from "@/components/social/FollowCreatorButton";

/**
 * Aire bajo los botones de la última fila, en píxeles.
 *
 * Antes eran 8px fijos. Con el safe-area inferior a cero en toda la plataforma,
 * esos 8px son literalmente lo que separa un botón del canto de la pantalla, y
 * los controles se leen como si se salieran por abajo.
 *
 * Se SUMA a lo que llegue en `safeBottom` (en el reel, el alto de la barra
 * inferior), no lo sustituye: en el reel los botones tienen que quedar por
 * encima de la barra Y además respirar.
 */
const BOTTOM_BREATHING_PX = 20;


const LiveInlinePlayer = dynamic(
  () => import("@/app/components/LiveInlinePlayer/LiveInlinePlayer"),
  { ssr: false },
);

const FONT = "inherit";
const VIBRA_RING = "linear-gradient(135deg, #ec4899 0%, #9333ea 52%, #3b82f6 100%)";

type Props = {
  post: ReelLivePost;
  /** Fuera de pantalla. El reproductor suelta la conexión y deja de consumir. */
  paused?: boolean;
  muted?: boolean;
  onMutedChange?: (muted: boolean) => void;
  /** Entrar al visor del live. */
  onOpen: () => void;
  safeTop?: string | number;
  safeBottom?: string | number;
  /** Escala reducida, para el carrusel de escritorio. */
  compact?: boolean;
};

export default function ReelLiveSlide({
  post,
  paused = false,
  muted = true,
  onMutedChange,
  onOpen,
  safeTop = "0px",
  safeBottom = "0px",
  compact = false,
}: Props) {
  const tLive = useTranslations("live");

  const ld = post.liveData;
  const [creator, setCreator] = useState<{ name: string | null; photo: string | null }>({
    name: null,
    photo: null,
  });

  // La cara del live es la de quien transmite. En un live no hay la ambigüedad
  // de las historias entre quien graba y quien publica: el autor del post es el
  // que está en cámara.
  useEffect(() => {
    if (!post.authorId) return;
    let cancelled = false;
    getDoc(doc(db, "users", post.authorId))
      .then((snap) => {
        if (cancelled) return;
        const d = snap.data();
        setCreator({
          name: typeof d?.displayName === "string" ? d.displayName : null,
          photo: typeof d?.photoURL === "string" ? d.photoURL : null,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [post.authorId]);

  const avatarSz = compact ? 40 : 54;
  const avatarInset = compact ? 5 : 6;
  // Aire por debajo de los botones. Con `safeBottom` numérico (historias en el
  // visor de círculos) no hay barra que esquivar y basta con el aire; con string
  // (el reel, que pasa el alto real del nav) se suma al hueco de la barra.
  const btnPadBottom =
    typeof safeBottom === "string"
      ? `calc(${safeBottom} + ${BOTTOM_BREATHING_PX}px)`
      : `${safeBottom + BOTTOM_BREATHING_PX}px`;
  const topOffset = typeof safeTop === "number" ? safeTop + 36 : `calc(${safeTop} + 36px)`;

  return (
    <>
      {/* El reproductor ocupa todo y recibe el toque. Tocar en cualquier sitio
          entra al live, que es lo que la gente intenta hacer por instinto. */}
      <div style={{ position: "absolute", inset: 0, zIndex: 1 }}>
        <LiveInlinePlayer
          postId={post.id}
          hlsUrl={ld?.hlsUrl ?? null}
          playbackId={ld?.playbackId ?? null}
          coverUrl={ld?.coverUrl ?? null}
          title={ld?.title ?? null}
          streamProvider={ld?.streamProvider ?? null}
          broadcastMode={ld?.broadcastMode ?? null}
          portrait
          paused={paused}
          initialMuted={muted}
          onMutedChange={onMutedChange}
          onClick={onOpen}
        />
      </div>

      {/* Cabecera: quién transmite. Misma geometría y mismo aro que una
          historia, para que el feed no cambie de idioma visual al pasar de un
          saludo a un live. */}
      <div
        style={{
          position: "absolute",
          top: topOffset,
          insetInlineStart: 12,
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          gap: compact ? 6 : 8,
          pointerEvents: "none",
        }}
      >
        <div style={{ position: "relative", width: avatarSz, height: avatarSz, flexShrink: 0 }}>
          <div
            style={{
              position: "absolute",
              inset: avatarInset,
              borderRadius: "50%",
              overflow: "hidden",
              background: "rgba(255,255,255,0.1)",
            }}
          >
            {creator.photo ? (
              <Image src={creator.photo} alt="" fill style={{ objectFit: "cover" }} />
            ) : (
              <div style={{ width: "100%", height: "100%", background: "rgba(255,255,255,0.15)" }} />
            )}
          </div>
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              background: VIBRA_RING,
              WebkitMaskImage:
                "radial-gradient(farthest-side, transparent calc(100% - 3px), white calc(100% - 3px))",
              maskImage:
                "radial-gradient(farthest-side, transparent calc(100% - 3px), white calc(100% - 3px))",
            }}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
          <span
            style={{
              color: "#fff",
              fontSize: compact ? 13 : 17,
              fontWeight: 600,
              lineHeight: "1.2",
              fontFamily: FONT,
            }}
          >
            {creator.name ?? ""}
          </span>
          <span
            style={{
              color: "rgba(255,255,255,0.75)",
              fontSize: compact ? 11 : 13,
              fontWeight: 500,
              lineHeight: "1.2",
              fontFamily: FONT,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: compact ? 160 : 240,
            }}
          >
            {ld?.title?.trim() || tLive("statusLive")}
          </span>
        </div>
        <FollowCreatorButton targetUserId={post.authorId ?? null} compact={compact} />
      </div>

      {/* Entrar al live. En el mismo sitio que los botones de una historia, para
          que el pulgar no tenga que buscar. */}
      <div
        style={{
          position: "absolute",
          insetInline: 0,
          bottom: 0,
          zIndex: 10,
          display: "flex",
          gap: 10,
          padding: "0 14px",
          paddingBottom: btnPadBottom,
        }}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          style={{
            flex: 1,
            height: compact ? 38 : 44,
            borderRadius: 12,
            border: "none",
            background: VIBRA_RING,
            color: "#fff",
            fontSize: compact ? 13 : 15,
            fontWeight: 600,
            fontFamily: FONT,
            cursor: "pointer",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          {tLive("goToLive")}
        </button>
      </div>
    </>
  );
}
