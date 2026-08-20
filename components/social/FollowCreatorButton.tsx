"use client";

// Botón de seguir para el feed de reels.
//
// Solo aparece si NO sigues a esa persona. Al pulsarlo pasa a "Siguiendo" un
// momento —para que el toque tenga respuesta— y se retira. Ya seguida, no hay
// nada que ofrecer ahí, y un botón permanente sobre el video estorba.
//
// Para dejar de seguir está el perfil. En un reel se pasa el dedo por encima de
// la cabecera todo el rato, y un botón que alterne acaba desactivando follows
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

  // null = todavía no se sabe.
  const [following, setFollowing] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  // Recién seguida: se enseña "Siguiendo" y acto seguido se va.
  const [justFollowed, setJustFollowed] = useState(false);

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
        // Sin saberlo no se pinta nada: ofrecer "Seguir" a quien ya sigues, o
        // "Siguiendo" a quien no, es peor que no ofrecer nada.
        if (!cancelled) setFollowing(null);
      });
    return () => {
      cancelled = true;
    };
  }, [invalid, targetUserId, currentUserId]);

  if (invalid) return null;
  // Mientras no se sabe no se pinta, para que no parpadee un "Seguir" en alguien
  // a quien ya sigues.
  if (following === null) return null;
  // Ya seguida de antes: no hay nada que ofrecer.
  if (following && !justFollowed) return null;

  async function handleFollow(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy || following || !targetUserId || !currentUserId) return;

    // Se marca ANTES de escribir y se revierte si falla. En un reel el dedo ya
    // va camino de la siguiente historia: esperar a la red para mover el botón
    // se siente como que el toque no registró.
    setFollowing(true);
    setJustFollowed(true);
    setBusy(true);
    try {
      await followUser({ currentUserId, targetUserId });
      // Un respiro para que se lea "Siguiendo", y fuera.
      setTimeout(() => setJustFollowed(false), 1400);
    } catch {
      setFollowing(false);
      setJustFollowed(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleFollow}
      disabled={busy}
      style={{
        flexShrink: 0,
        boxSizing: "border-box",
        padding: compact ? "3px 10px" : "5px 14px",
        borderRadius: 8,
        // Transparente con perímetro blanco. Sobre el video, un botón sólido
        // pesa demasiado para lo que es: un secundario.
        background: "transparent",
        border: `1px solid rgba(255,255,255,${following ? 0.55 : 0.9})`,
        color: following ? "rgba(255,255,255,0.8)" : "#fff",
        fontSize: compact ? 11 : 13,
        fontWeight: 600,
        lineHeight: 1.4,
        letterSpacing: "-0.01em",
        whiteSpace: "nowrap",
        fontFamily: "inherit",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        marginInlineStart: compact ? 6 : 8,
        cursor: busy ? "default" : "pointer",
        opacity: busy ? 0.6 : 1,
        transition: "border-color 160ms ease, color 160ms ease, opacity 160ms ease",
        WebkitTapHighlightColor: "transparent",
        // El botón vive junto al enlace al perfil, dentro de una cabecera que en
        // el live tiene los clics apagados.
        pointerEvents: "auto",
      }}
    >
      {following ? tFeed("followingCta") : tFeed("followCta")}
    </button>
  );
}
