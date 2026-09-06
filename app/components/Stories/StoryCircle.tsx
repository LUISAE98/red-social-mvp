"use client";

import FillImage from "@/components/ui/FillImage";
import { useTranslations } from "next-intl";
import { AvatarRing, medidaAroEnCaja } from "@/components/ui/AvatarRing";
import type { StoryType } from "@/lib/stories/types";

type Props = {
  type: StoryType;
  thumbnailUrl: string | null;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  size?: number;
  sublabel?: string;
  /**
   * Hay contenido publicable pero todavía ninguna historia. Se pinta idéntico,
   * con su aro y sus letras, y dentro un "+" en lugar de la portada: el hueco
   * ocupa el mismo sitio que ocupará la historia cuando exista.
   */
  empty?: boolean;
};

export default function StoryCircle({ type, thumbnailUrl, onClick, size = 74, sublabel, empty = false }: Props) {
  const tCommon = useTranslations("common");
  const borderSize = size + 6;
  // La caja manda: la foto es la que cede el sitio del aro.
  const { foto } = medidaAroEnCaja(borderSize);
  const label = type === "saludo" ? tCommon("storySaludos") : tCommon("storyConsejos");

  return (
    <button type="button"
      onClick={onClick}
      aria-label={empty ? tCommon("storyAddStories") : tCommon("storyViewLabel", { label })}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 5,
        background: "none",
        border: "none",
        padding: 0,
        cursor: "pointer",
        WebkitTapHighlightColor: "transparent",
        flexShrink: 0,
      }}
    >
      {/* El aro. El hueco hasta la foto es un agujero, no un borde de color:
          este círculo se coloca sobre fondos que no controla. */}
      <div
        style={{
          width: borderSize,
          height: borderSize,
          borderRadius: "50%",
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <AvatarRing foto={foto} />
        <div
          style={{
            width: foto,
            height: foto,
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
          {empty ? (
            // Un "+" a secas. Sin borde punteado: el aro de Vibra ya delimita
            // el círculo y el punteado lo haría parecer otra cosa.
            <svg
              width={Math.round(size * 0.34)} height={Math.round(size * 0.34)}
              viewBox="0 0 24 24" fill="none" aria-hidden="true"
            >
              <path
                d="M12 5V19M5 12H19"
                stroke="rgba(255,255,255,0.72)" strokeWidth="2" strokeLinecap="round"
              />
            </svg>
          ) : thumbnailUrl ? (
            <FillImage src={thumbnailUrl} alt={label} />
          ) : (
            <span style={{ fontSize: Math.round(size * 0.35), lineHeight: 1 }}>
              {type === "saludo" ? "👋" : "💡"}
            </span>
          )}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
        <span
          style={{
            color: "rgba(255,255,255,0.82)",
            fontSize: 11,
            fontWeight: 500,
            lineHeight: 1,
            letterSpacing: "-0.01em",
            fontFamily: 'inherit',
          }}
        >
          {label}
        </span>
        {sublabel && (
          <span
            style={{
              color: "rgba(255,255,255,0.38)",
              fontSize: 9.5,
              fontWeight: 500,
              lineHeight: 1,
              letterSpacing: "0em",
              fontFamily: 'inherit',
            }}
          >
            {sublabel}
          </span>
        )}
      </div>
    </button>
  );
}
