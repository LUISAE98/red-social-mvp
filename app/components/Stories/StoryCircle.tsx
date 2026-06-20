"use client";

import Image from "next/image";
import type { StoryType } from "@/lib/stories/types";

const VIBRA_GRADIENT = "linear-gradient(135deg, #ec4899 0%, #9333ea 52%, #3b82f6 100%)";

const LABELS: Record<StoryType, string> = {
  saludo: "Saludos",
  consejo: "Consejos",
};

type Props = {
  type: StoryType;
  thumbnailUrl: string | null;
  onClick: () => void;
  size?: number;
  sublabel?: string;
};

export default function StoryCircle({ type, thumbnailUrl, onClick, size = 74, sublabel }: Props) {
  const borderSize = size + 6;
  const label = LABELS[type];

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Ver historias de ${label}`}
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
          padding: 2.5,
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
          {thumbnailUrl ? (
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

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
        <span
          style={{
            color: "rgba(255,255,255,0.72)",
            fontSize: 10.5,
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
              color: "rgba(255,255,255,0.40)",
              fontSize: 9.5,
              fontWeight: 400,
              lineHeight: 1,
              letterSpacing: "-0.01em",
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
