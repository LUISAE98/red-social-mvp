"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import VibraResponsivePanel from "@/components/ui/VibraResponsivePanel";
import {
  hideConversationForMe,
  setConversationMuted,
} from "@/lib/chat/chatService";

/**
 * Silenciar y quitar de la bandeja, para el menú ⋮ del chat.
 *
 * Vive aparte porque lo montan los DOS marcos del chat — la pestaña de laptop y
 * la pantalla completa de celular — y el panel de confirmación tiene bastante
 * cuerpo como para duplicarlo.
 *
 * Ninguna de las dos toca al otro lado: silenciar solo apaga TU aviso, y quitar
 * solo despeja TU bandeja.
 */
export default function ChatConversationActions({
  conversationId,
  selfUid,
  muted,
  itemStyle,
  onCloseMenu,
  onRemoved,
}: {
  conversationId: string;
  selfUid: string;
  muted: boolean;
  /** Estilo de renglón que presta el menú, para no desentonar. */
  itemStyle: React.CSSProperties;
  onCloseMenu: () => void;
  /** Se dispara al quitar el hilo; el marco decide adónde ir después. */
  onRemoved?: () => void;
}) {
  const tChat = useTranslations("chat");
  const tCommon = useTranslations("common");

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleToggleMute() {
    onCloseMenu();
    try {
      await setConversationMuted(conversationId, selfUid, !muted);
    } catch {
      // Silencioso: no llega el aviso pero el chat sigue funcionando igual.
    }
  }

  async function handleRemove() {
    if (busy) return;
    setBusy(true);
    try {
      await hideConversationForMe(conversationId, selfUid);
      setConfirmOpen(false);
      onRemoved?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" role="menuitem" onClick={handleToggleMute} style={itemStyle}>
        {muted ? tChat("unmute") : tChat("mute")}
      </button>

      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onCloseMenu();
          setConfirmOpen(true);
        }}
        style={{ ...itemStyle, color: "#ff8a8a" }}
      >
        {tChat("removeConversation")}
      </button>

      <VibraResponsivePanel
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={tChat("removeConversationTitle")}
        mobileVariant="centered"
        maxWidthDesktop={420}
        footer={
          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              disabled={busy}
              style={{
                flex: 1,
                minHeight: 44,
                borderRadius: 10,
                border: "none",
                background: "rgba(255,255,255,0.10)",
                color: "#fff",
                fontSize: 14,
                fontWeight: 500,
                fontFamily: "inherit",
                cursor: busy ? "not-allowed" : "pointer",
              }}
            >
              {tCommon("cancel")}
            </button>
            <button
              type="button"
              onClick={handleRemove}
              disabled={busy}
              style={{
                flex: 1,
                minHeight: 44,
                borderRadius: 10,
                border: "none",
                background: "#ef4444",
                color: "#fff",
                fontSize: 14,
                fontWeight: 600,
                fontFamily: "inherit",
                cursor: busy ? "not-allowed" : "pointer",
                opacity: busy ? 0.7 : 1,
              }}
            >
              {tChat("removeConversation")}
            </button>
          </div>
        }
      >
        <p
          style={{
            margin: 0,
            fontSize: 13.5,
            lineHeight: 1.5,
            color: "rgba(255,255,255,0.7)",
          }}
        >
          {tChat("removeConversationBody")}
        </p>
      </VibraResponsivePanel>
    </>
  );
}
