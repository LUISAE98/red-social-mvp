// PostImageViewer.components.tsx
// Subcomponentes presentacionales extraídos de PostImageViewer.tsx.
// Definidos a nivel de módulo: reciben todo por props, sin estado del padre.

"use client";

import Image from "next/image";
import { getInitials } from "./PostImageViewer.utils";

export function Avatar({
  name,
  avatarUrl,
  size = 36,
}: {
  name: string;
  avatarUrl?: string | null;
  size?: number;
}) {
  if (avatarUrl) {
    return (
      <Image
        src={avatarUrl}
        alt={name}
        width={size}
        height={size}
        style={{
          borderRadius: "50%",
          objectFit: "cover",
          display: "block",
          border: "1px solid rgba(255,255,255,0.10)",
          background: "rgba(255,255,255,0.06)",
          flexShrink: 0,
        }}
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        display: "grid",
        placeItems: "center",
        background: "rgba(255,255,255,0.08)",
        border: "1px solid rgba(255,255,255,0.10)",
        color: "#fff",
        fontSize: Math.max(11, Math.floor(size * 0.32)),
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      {getInitials(name)}
    </div>
  );
}
