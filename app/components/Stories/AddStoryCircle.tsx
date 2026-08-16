"use client";

// Círculo gris con un `+` para publicar historias.
//
// Existe para romper un círculo vicioso: el rail solo se pintaba cuando ya había
// historias publicadas, y el panel para publicarlas solo se abría desde el rail.
// Quien no había publicado nunca no tenía por dónde empezar.
//
// Aparece únicamente cuando hay algo que publicar de verdad, así que si no has
// vendido ni comprado saludos no lo verás, y si solo tienes saludos no saldrá el
// de consejos.

import type { StoryType } from "@/lib/stories/types";

const CIRCLE_SIZE = 72;

type Props = {
  type: StoryType;
  label: string;
  ariaLabel: string;
  onClick: () => void;
};

export default function AddStoryCircle({ type, label, ariaLabel, onClick }: Props) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
      <button
        type="button"
        aria-label={ariaLabel}
        title={ariaLabel}
        onClick={onClick}
        style={{
          width: CIRCLE_SIZE,
          height: CIRCLE_SIZE,
          borderRadius: "50%",
          // Discontinuo y apagado: se lee como hueco por llenar, no como una
          // historia más del rail.
          border: "1.5px dashed rgba(255,255,255,0.28)",
          background: "rgba(255,255,255,0.05)",
          color: "rgba(255,255,255,0.6)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          padding: 0,
          WebkitTapHighlightColor: "transparent",
          transition: "background 150ms ease, border-color 150ms ease",
        }}
      >
        <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
      <span
        style={{
          marginTop: 6,
          fontSize: 11,
          fontWeight: 500,
          lineHeight: 1.3,
          color: "rgba(255,255,255,0.55)",
          maxWidth: CIRCLE_SIZE + 16,
          textAlign: "center",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.32)", lineHeight: 1.3 }}>
        {type === "saludo" ? "👋" : "💡"}
      </span>
    </div>
  );
}
