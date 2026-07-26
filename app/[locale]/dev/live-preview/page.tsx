"use client";

// ─────────────────────────────────────────────────────────────────────────────
// PÁGINA DEV TEMPORAL — vista previa del LiveViewerModal REAL sin transmisión.
//
// Monta el LiveViewerModal de producción con un `post` de live SIMULADO y "activo"
// (chat + supercomentario + donación habilitados, sin ticket) para poder ITERAR los
// paneles reales (panel 1 supercomentario, pasarela, donación, chat) sin necesidad
// de una transmisión en curso. El video no reproducirá (no hay stream real): solo
// sirve para diseñar los paneles.
//
// ⚠️ BORRAR esta carpeta (app/[locale]/dev/live-preview) cuando terminemos de
//    modelar los paneles. No forma parte del flujo de producción.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import LiveViewerModal from "@/app/components/LiveViewerModal/LiveViewerModal";
import { DEFAULT_SUPER_COMMENT_CONFIG } from "@/lib/liveChat/types";
import type { Post } from "@/lib/posts/types";

// Live simulado "en vivo". `as unknown as Post`: es un mock de dev, no llenamos
// todos los campos del tipo (solo los que el modal necesita para renderizar).
const MOCK_LIVE_POST = {
  id: "dev-live-preview",
  text: "",
  authorId: "dev-creator-preview",
  authorName: "Creador Demo",
  authorUsername: "creador_demo",
  authorAvatarUrl: null,
  isDeleted: false,
  postType: "live",
  requiresPayment: false,
  counts: { likes: 128, comments: 0, saves: 0, shares: 0 },
  liveData: {
    status: "live",
    title: "Live de prueba (dev)",
    description: "Panel de diseño — sin transmisión real.",
    broadcastMode: "direct",
    chatEnabled: true,
    accessType: "free",
    paidAccessMode: "everyone_pays",
    currency: "MXN",
    superCommentConfig: DEFAULT_SUPER_COMMENT_CONFIG,
  },
} as unknown as Post;

export default function LivePreviewDevPage() {
  const [open, setOpen] = useState(true);

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "#0a0a0a",
        display: "grid",
        placeItems: "center",
        gap: 16,
        color: "#fff",
        fontFamily: "inherit",
        padding: 24,
        textAlign: "center",
      }}
    >
      <div style={{ maxWidth: 360 }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>
          Vista previa del live (dev)
        </div>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", lineHeight: 1.5 }}>
          Monta el <strong>LiveViewerModal real</strong> con un live simulado para
          diseñar los paneles (supercomentario, donación, chat). El video no
          reproduce: es solo para modelar. Toca la moneda / el corazón.
        </p>
      </div>

      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            padding: "12px 22px",
            borderRadius: 12,
            border: "none",
            background: "#a855f7",
            color: "#fff",
            fontSize: 14,
            fontWeight: 700,
            fontFamily: "inherit",
            cursor: "pointer",
          }}
        >
          Abrir live de prueba
        </button>
      )}

      <LiveViewerModal open={open} post={MOCK_LIVE_POST} onClose={() => setOpen(false)} />
    </div>
  );
}
