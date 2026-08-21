"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import VibraResponsivePanel from "@/components/ui/VibraResponsivePanel";
import {
  hideConversationForMe,
  setConversationMuted,
} from "@/lib/chat/chatService";

/**
 * Silenciar y quitar de la bandeja, para el menú del chat.
 *
 * Está partido en DOS piezas a propósito, y no por gusto: los renglones viven
 * dentro del portal del menú, y ese portal se desmonta al cerrarse el menú. Si
 * el panel de confirmación colgara de ahí, se iría con él — que es exactamente
 * lo que pasaba: el panel se abría y desaparecía solo a los pocos milisegundos.
 *
 * Por eso el panel lo monta el MARCO del chat (la pantalla de celular o la
 * pestaña de laptop), que sigue vivo cuando el menú ya no está.
 *
 * Ninguna de las dos acciones toca al otro lado: silenciar apaga TU aviso y
 * quitar despeja TU bandeja.
 */

export function ChatConversationMenuItems({
  conversationId,
  selfUid,
  muted,
  itemStyle,
  onCloseMenu,
  onRequestRemove,
}: {
  conversationId: string;
  selfUid: string;
  muted: boolean;
  /** Estilo de renglón que presta el menú, para no desentonar. */
  itemStyle: React.CSSProperties;
  onCloseMenu: () => void;
  onRequestRemove: () => void;
}) {
  const tChat = useTranslations("chat");

  async function handleToggleMute() {
    onCloseMenu();
    try {
      await setConversationMuted(conversationId, selfUid, !muted);
    } catch {
      // Silencioso: no cambia el aviso, pero el chat sigue funcionando igual.
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
          onRequestRemove();
        }}
        style={{ ...itemStyle, color: "#ff8a8a" }}
      >
        {tChat("removeConversation")}
      </button>
    </>
  );
}

export function ChatRemoveConversationDialog({
  open,
  conversationId,
  selfUid,
  onClose,
  onRemoved,
}: {
  open: boolean;
  conversationId: string;
  selfUid: string;
  onClose: () => void;
  /** Se dispara al quitar el hilo; el marco decide adónde ir después. */
  onRemoved?: () => void;
}) {
  const tChat = useTranslations("chat");
  const tCommon = useTranslations("common");
  const [busy, setBusy] = useState(false);

  async function handleRemove() {
    if (busy) return;
    setBusy(true);
    try {
      await hideConversationForMe(conversationId, selfUid);
      onClose();
      onRemoved?.();
    } finally {
      setBusy(false);
    }
  }

  const buttonBase: React.CSSProperties = {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    border: "none",
    fontSize: 14,
    fontFamily: "inherit",
    cursor: busy ? "not-allowed" : "pointer",
  };

  return (
    <VibraResponsivePanel
      open={open}
      onClose={onClose}
      title={tChat("removeConversationTitle")}
      mobileVariant="centered"
      maxWidthDesktop={420}
      footer={
        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={{
              ...buttonBase,
              background: "rgba(255,255,255,0.10)",
              color: "#fff",
              fontWeight: 500,
            }}
          >
            {tCommon("cancel")}
          </button>
          <button
            type="button"
            onClick={handleRemove}
            disabled={busy}
            style={{
              ...buttonBase,
              background: "#ef4444",
              color: "#fff",
              fontWeight: 600,
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
  );
}
