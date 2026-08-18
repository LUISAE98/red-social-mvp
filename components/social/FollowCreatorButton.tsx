"use client";

// Botón de seguir para el feed de reels.
//
// Mismo comportamiento que el de los perfiles sugeridos del home: solo aparece
// si NO sigues a esa persona, y al pulsarlo se queda como texto en vez de
// ofrecer dejar de seguir. El reel no es sitio para dejar de seguir a nadie: se
// pasa el dedo por encima y un botón que alterna acabaría desactivando follows
// por accidente.
//
// A QUIÉN se sigue lo decide quien lo monta, y no es negociable en un caso: en
// un saludo o consejo republicado por el comprador, se sigue a quien lo GRABÓ.
// Es su trabajo, es su cara la que sale arriba, y es a quien se le encarga uno
// nuevo desde el botón de comprar.

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/app/providers";
import { followUser } from "@/lib/social/social-service";

type Props = {
  /** A quién se sigue. En una historia, quien grabó el video. */
  targetUserId: string | null;
  /** Escala reducida, para el carrusel de escritorio. */
  compact?: boolean;
};

export default function FollowCreatorButton({ targetUserId, compact = false }: Props) {
  const tFeed = useTranslations("feed");
  const { user } = useAuth();
  const currentUserId = user?.uid ?? null;

  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  // null = todavía no se sabe.
  const [following, setFollowing] = useState<boolean | null>(null);

  // Una cuenta anónima no puede seguir a nadie: sus escrituras no pasarían las
  // reglas, así que ni se ofrece.
  const invalid =
    !targetUserId || !currentUserId || targetUserId === currentUserId || !!user?.isAnonymous;

  useEffect(() => {
    if (invalid || !targetUserId || !currentUserId) return;
    let cancelled = false;
    getDoc(doc(db, "users", currentUserId, "following", targetUserId))
      .then((snap) => {
        if (!cancelled) setFollowing(snap.exists());
      })
      .catch(() => {
        // Sin saberlo, no se enseña: prometer "Seguir" a quien ya sigues es peor
        // que no ofrecer nada.
        if (!cancelled) setFollowing(true);
      });
    return () => {
      cancelled = true;
    };
  }, [invalid, targetUserId, currentUserId]);

  if (invalid) return null;
  // Mientras no se sabe no se pinta nada, para que no parpadee un "Seguir" en
  // alguien a quien ya sigues.
  if (following === null && state === "idle") return null;
  if (following === true) return null;

  async function handleFollow(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (state !== "idle" || !targetUserId || !currentUserId) return;
    setState("loading");
    try {
      await followUser({ currentUserId, targetUserId });
      setState("done");
    } catch {
      setState("idle");
    }
  }

  const base: React.CSSProperties = {
    flexShrink: 0,
    boxSizing: "border-box",
    padding: compact ? "3px 9px" : "4px 12px",
    borderRadius: 6,
    border: "none",
    fontSize: compact ? 10 : 12,
    fontWeight: 700,
    lineHeight: 1.4,
    letterSpacing: "-0.01em",
    whiteSpace: "nowrap",
    fontFamily: "inherit",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    marginInlineStart: compact ? 6 : 8,
  };

  if (state === "done") {
    return (
      <span style={{ ...base, background: "transparent", color: "#a855f7", cursor: "default" }}>
        {tFeed("followingCta")}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={handleFollow}
      disabled={state !== "idle"}
      style={{
        ...base,
        background: "#a855f7",
        color: "#fff",
        cursor: state === "idle" ? "pointer" : "default",
        opacity: state === "loading" ? 0.7 : 1,
        // El botón vive dentro del enlace al perfil, así que necesita recibir
        // sus propios clics aunque la cabecera los tenga apagados.
        pointerEvents: "auto",
      }}
    >
      {state === "loading" ? "…" : tFeed("followCta")}
    </button>
  );
}
