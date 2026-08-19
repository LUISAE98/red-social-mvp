"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import type { StoryType } from "@/lib/stories/types";

const VIBRA_GRADIENT = "linear-gradient(135deg, #ec4899 0%, #9333ea 52%, #3b82f6 100%)";

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
  const label = type === "saludo" ? tCommon("storySaludos") : tCommon("storyConsejos");

  return (
    <button
      type="button"
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
      {/* Gradient ring */}
      <div
        style={{
          width: borderSize,
          height: borderSize,
          borderRadius: "50%",
          background: VIBRA_GRADIENT,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 3,
          boxSizing: "border-box",
          flexShrink: 0,
        }}
      >
        {/* Inner circle */}
        <div
          style={{
            width: "100%",
            height: "100%",
            borderRadius: "50%",
            border: "2px solid rgb(10,10,14)",
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
            <Image
              src={thumbnailUrl}
              alt={label}
              fill
              style={{ objectFit: "cover" }}
            />
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
            fontWeight: 600,
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
