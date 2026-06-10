"use client";

import type { StoryType } from "@/lib/stories/types";

const GRADIENTS: Record<StoryType, string> = {
  saludo: "linear-gradient(135deg, #a855f7 0%, #ec4899 60%, #f97316 100%)",
  consejo: "linear-gradient(135deg, #f59e0b 0%, #f97316 60%, #ef4444 100%)",
};

const LABELS: Record<StoryType, string> = {
  saludo: "Saludos",
  consejo: "Consejos",
};

type Props = {
  type: StoryType;
  thumbnailUrl: string | null;
  onClick: () => void;
  size?: number;
};

export default function StoryCircle({ type, thumbnailUrl, onClick, size = 60 }: Props) {
  const borderSize = size + 6;
  const label = LABELS[type];
  const gradient = GRADIENTS[type];

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
          background: gradient,
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
          }}
        >
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt={label}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <span style={{ fontSize: Math.round(size * 0.35), lineHeight: 1 }}>
              {type === "saludo" ? "👋" : "💡"}
            </span>
          )}
        </div>
      </div>

      <span
        style={{
          color: "rgba(255,255,255,0.72)",
          fontSize: 10.5,
          fontWeight: 500,
          lineHeight: 1,
          letterSpacing: "-0.01em",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
        }}
      >
        {label}
      </span>
    </button>
  );
}
