"use client";

/**
 * Botón de seguimiento para listas, con los cuatro estados del producto:
 *
 *   Seguir · Siguiendo · Te sigue · Ambos se siguen
 *
 * Es EL MISMO botón del perfil (`ProfileSocialActions` → `styles.followButton`),
 * solo que reducido: mismo degradado, mismo radio, mismo peso y el mismo
 * `letter-spacing`. Aquí no se inventa una estética nueva; únicamente bajan alto,
 * cuerpo de letra y padding para caber en un renglón.
 */

import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";

import { useSocialRelationship } from "@/lib/social/useSocialRelationship";

export default function FollowStateButton({
  viewerUid,
  targetUid,
  onUnfollow,
  onFollow,
}: {
  viewerUid: string | null;
  targetUid: string;
  /** Se avisa DESPUÉS de dejar de seguir, para que la lista decida qué hacer. */
  onUnfollow?: (targetUid: string) => void;
  onFollow?: (targetUid: string) => void;
}) {
  const tProfile = useTranslations("profile");
  const tCommon = useTranslations("common");

  const { relationship, loading, actionLoading, follow, unfollow } =
    useSocialRelationship(viewerUid, targetUid);

  /**
   * Los cuatro textos posibles, en el orden de los estados. Se pintan TODOS
   * apilados en la misma celda de rejilla y solo uno queda visible: así la
   * caja mide siempre lo que el más largo, y todos los botones de la lista
   * salen idénticos sin medir nada en JavaScript ni fijar un ancho en píxeles
   * que se rompería en alemán.
   */
  const labels = [
    tCommon("follow"),
    tProfile("followingLabel"),
    tProfile("followsYou"),
    tProfile("mutualFollow"),
  ];

  const activeLabel =
    relationship.isFollowing && relationship.isFollowedBy
      ? tProfile("mutualFollow")
      : relationship.isFollowing
        ? tProfile("followingLabel")
        : relationship.isFollowedBy
          ? tProfile("followsYou")
          : tCommon("follow");

  // Mismo botón del perfil, en pequeño. El degradado y el radio no se tocan.
  const buttonStyle: CSSProperties = {
    flexShrink: 0,
    minHeight: 30,
    borderRadius: 10,
    border: "none",
    background: "linear-gradient(135deg, #ec4899, #9333ea)",
    color: "#fff",
    fontFamily: "inherit",
    fontWeight: 600,
    fontSize: 12,
    letterSpacing: "-0.01em",
    cursor: actionLoading ? "not-allowed" : "pointer",
    WebkitTapHighlightColor: "transparent",
    transition: "opacity 150ms ease",
    // 14px a cada lado, como en el perfil: el estado más largo no debe verse
    // apretado contra los bordes.
    padding: "0 14px",
    opacity: actionLoading ? 0.65 : 1,
  };

  if (!viewerUid || viewerUid === targetUid) return null;

  // Mientras se resuelve la relación, un skeleton del MISMO tamaño que el botón
  // (base canónica de vibra_style.md). Así el renglón no salta cuando llega el
  // estado, y no se enseña un "Seguir" que quizá sea falso.
  if (loading) {
    return (
      <>
        <style jsx>{`
          .vb-skel {
            background: linear-gradient(
              100deg,
              rgba(255, 255, 255, 0.05) 30%,
              rgba(255, 255, 255, 0.11) 50%,
              rgba(255, 255, 255, 0.05) 70%
            );
            background-size: 300% 100%;
            animation: vbSkelWave 1.6s ease-in-out infinite;
          }

          @keyframes vbSkelWave {
            0% {
              background-position: 180% 0;
            }
            100% {
              background-position: -80% 0;
            }
          }

          @media (prefers-reduced-motion: reduce) {
            .vb-skel {
              animation: none;
              background: rgba(255, 255, 255, 0.07);
            }
          }
        `}</style>

        <span
          className="vb-skel"
          aria-hidden
          style={{
            ...buttonStyle,
            background: undefined,
            display: "grid",
            borderRadius: 10,
            // Mismo truco de apilado: el hueco mide lo que el botón real medirá.
            visibility: "visible",
          }}
        >
          {labels.map((label) => (
            <span
              key={label}
              style={{
                gridArea: "1 / 1",
                visibility: "hidden",
                whiteSpace: "nowrap",
                lineHeight: "30px",
              }}
            >
              {label}
            </span>
          ))}
        </span>
      </>
    );
  }

  return (
    <button
      type="button"
      disabled={actionLoading}
      style={{ ...buttonStyle, display: "grid", placeItems: "center" }}
      onClick={(e) => {
        // El renglón entero navega al perfil: el botón NO debe arrastrar con él.
        e.stopPropagation();
        if (actionLoading) return;

        if (relationship.isFollowing) {
          unfollow();
          onUnfollow?.(targetUid);
          return;
        }

        follow();
        onFollow?.(targetUid);
      }}
    >
      {labels.map((label) => (
        <span
          key={label}
          aria-hidden={label !== activeLabel}
          style={{
            gridArea: "1 / 1",
            visibility: label === activeLabel ? "visible" : "hidden",
            whiteSpace: "nowrap",
            lineHeight: "30px",
          }}
        >
          {label}
        </span>
      ))}
    </button>
  );
}
