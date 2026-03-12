"use client";

import { CSSProperties } from "react";

export default function GroupFeedTab() {
  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

  const cardStyle: CSSProperties = {
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.03)",
    padding: 16,
    color: "#fff",
    boxShadow: "0 18px 48px rgba(0,0,0,0.35)",
    backdropFilter: "blur(10px)",
    fontFamily: fontStack,
  };

  const titleStyle: CSSProperties = {
    margin: 0,
    fontSize: 16,
    fontWeight: 600,
    lineHeight: 1.2,
    color: "#fff",
  };

  const textStyle: CSSProperties = {
    marginTop: 8,
    marginBottom: 0,
    fontSize: 13,
    lineHeight: 1.5,
    color: "rgba(255,255,255,0.78)",
  };

  return (
    <section style={cardStyle}>
      <h2 style={titleStyle}>Publicaciones del grupo</h2>

      <p style={textStyle}>
        Aquí irá el feed del grupo. Por ahora esta sección queda como placeholder
        para mantener la estructura limpia del Hito 1, sin mezclar todavía la
        implementación real de posts del Hito 2.
      </p>
    </section>
  );
}