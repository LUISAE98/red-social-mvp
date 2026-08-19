"use client";

// Botón de seguir para el feed de reels, al estilo de Instagram.
//
// Alterna: si no sigues dice "Seguir", y en cuanto sigues pasa a "Siguiendo",
// desde donde se puede dejar de seguir con otro toque. Por eso sigue visible
// cuando ya sigues, al revés que el de los perfiles sugeridos del home, que
// desaparece una vez cumplida su función.
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
import { followUser, unfollowUser } from "@/lib/social/social-service";

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
  // Mientras no se sabe no se pinta, para que el botón no parpadee de un estado
  // al otro nada más aparecer la historia.
  if (following === null) return null;

  async function handleToggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy || !targetUserId || !currentUserId) return;

    // Se cambia ANTES de escribir y se revierte si falla. En un reel el dedo ya
    // va camino de la siguiente historia: esperar a la red para mover el botón
    // se siente como que el toque no registró.
    const antes = following;
    setFollowing(!antes);
    setBusy(true);
    try {
      if (antes) await unfollowUser({ currentUserId, targetUserId });
      else await followUser({ currentUserId, targetUserId });
    } catch {
      setFollowing(antes);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
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
