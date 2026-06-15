"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/app/providers";
import { useLiveChat } from "@/lib/hooks/useLiveChat";

const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';

type Props = {
  liveId: string;
  chatEnabled?: boolean;
  liveEnded?: boolean;
  isMuted?: boolean;
  /** panel = full chat section; overlay = translucent overlay on top of video */
  mode?: "panel" | "overlay";
};

type SenderInfo = { username: string; avatarUrl: string | null };

export default function LiveChatViewer({ liveId, chatEnabled = true, liveEnded = false, isMuted = false, mode = "panel" }: Props) {
  const { user } = useAuth();
  const { messages, send } = useLiveChat(liveId);
  const [text, setText] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [senderInfo, setSenderInfo] = useState<SenderInfo | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  useEffect(() => {
    if (!user?.uid) { setSenderInfo(null); return; }
    // Inicializar desde auth inmediatamente para no bloquear el envío
    setSenderInfo({
      username: user.displayName ?? "Espectador",
      avatarUrl: user.photoURL ?? null,
    });
    // Enriquecer con datos de perfil en Firestore
    getDoc(doc(db, "users", user.uid))
      .then((snap) => {
        if (!snap.exists()) return;
        const d = snap.data();
        setSenderInfo({
          username: d?.displayName ?? d?.handle ?? user.displayName ?? "Espectador",
          avatarUrl: d?.photoURL ?? user.photoURL ?? null,
        });
      })
      .catch(() => {}); // se queda con el valor de auth
  }, [user?.uid]);

  useEffect(() => {
    if (isAtBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
  };

  const handleSend = useCallback(async () => {
    if (!user || !senderInfo || !text.trim()) return;
    const messageText = text.trim();
    // Limpiar input inmediatamente para no bloquear al usuario
    setText("");
    setSendError(null);
    isAtBottomRef.current = true;
    try {
      await send({
        userId: user.uid,
        username: senderInfo.username,
        avatarUrl: senderInfo.avatarUrl,
        text: messageText,
      });
    } catch {
      setSendError("No se pudo enviar.");
      setText(messageText); // restaurar si falló
    }
  }, [user, senderInfo, text, send]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  // ── Overlay mode (mobile portrait) — TikTok style, 1/3 de pantalla ─────────
  if (mode === "overlay") {
    return (
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 5,
          height: "33%",
          display: "flex", flexDirection: "column",
          background: "linear-gradient(to top, rgba(0,0,0,0.68) 50%, transparent 100%)",
        }}
      >
        <style>{`.lvc-msgs::-webkit-scrollbar{display:none}`}</style>

        {/* Mensajes — flotan desde abajo, scrollable */}
        <div
          className="lvc-msgs"
          onScroll={handleScroll}
          style={{
            flex: 1, overflowY: "auto",
            padding: "0 14px",
            display: "flex", flexDirection: "column",
            scrollbarWidth: "none",
          }}
        >
          <div style={{ flex: 1 }} />
          {messages.map((msg) => (
            <div key={msg.id} style={{
              display: "flex", alignItems: "flex-start", gap: 7,
              marginBottom: 5,
            }}>
              <Avatar url={msg.avatarUrl} name={msg.username} size={20} />
              <span style={{ fontSize: 12.5, fontFamily: FONT, lineHeight: 1.4, color: "rgba(255,255,255,0.92)" }}>
                <strong style={{ fontWeight: 700, color: "#fff", marginRight: 5 }}>{msg.username}</strong>
                {msg.text}
              </span>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input o estado */}
        {chatEnabled && !liveEnded && user ? (
          <div style={{
            padding: "7px 14px",
            paddingBottom: "calc(10px + env(safe-area-inset-bottom))",
            paddingRight: 84,
          }}>
            {isMuted ? (
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", fontFamily: FONT }}>
                Fuiste silenciado en este live
              </div>
            ) : (
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  maxLength={500}
                  placeholder="Escribe un mensaje..."
                  style={{
                    flex: 1, background: "rgba(255,255,255,0.13)",
                    border: "1px solid rgba(255,255,255,0.18)", borderRadius: 20,
                    padding: "8px 13px", color: "#fff", fontSize: 12.5,
                    fontFamily: FONT, outline: "none",
                  }}
                />
                <SendButton onClick={handleSend} active={!!text.trim()} />
              </div>
            )}
          </div>
        ) : (
          <div style={{ height: "calc(8px + env(safe-area-inset-bottom))" }} />
        )}
      </div>
    );
  }

  // ── Panel mode (mobile horizontal, desktop sidebar) ───────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        padding: "8px 12px 6px",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: "rgba(255,255,255,0.35)", fontFamily: FONT, letterSpacing: "0.05em", textTransform: "uppercase" }}>
          Chat en vivo
        </span>
      </div>

      {/* Messages */}
      <div
        onScroll={handleScroll}
        style={{ flex: 1, overflowY: "auto", padding: "6px 10px", display: "flex", flexDirection: "column", gap: 1 }}
      >
        {messages.length === 0 && (
          <div style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
            color: "rgba(255,255,255,0.2)", fontSize: 12, fontFamily: FONT, textAlign: "center", padding: "24px 0",
          }}>
            {liveEnded ? "El live ha terminado" : chatEnabled ? "Sé el primero en comentar" : "El chat está cerrado"}
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} style={{ display: "flex", gap: 6, padding: "3px 0", alignItems: "flex-start" }}>
            <Avatar url={msg.avatarUrl} name={msg.username} size={22} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <span style={{ fontFamily: FONT, fontSize: 11.5, fontWeight: 700, color: "rgba(255,255,255,0.85)", marginRight: 4 }}>
                {msg.username}
              </span>
              <span style={{ fontFamily: FONT, fontSize: 12, color: "rgba(255,255,255,0.7)", lineHeight: 1.4, wordBreak: "break-word" }}>
                {msg.text}
              </span>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{ padding: "8px 10px", borderTop: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
        {liveEnded ? (
          <div style={{ textAlign: "center", fontSize: 12, color: "rgba(255,255,255,0.25)", fontFamily: FONT, padding: "4px 0" }}>
            El live ha terminado
          </div>
        ) : !chatEnabled ? (
          <div style={{ textAlign: "center", fontSize: 12, color: "rgba(255,255,255,0.25)", fontFamily: FONT, padding: "4px 0" }}>
            El chat está cerrado
          </div>
        ) : !user ? (
          <div style={{ textAlign: "center", fontSize: 12, color: "rgba(255,255,255,0.25)", fontFamily: FONT, padding: "4px 0" }}>
            Inicia sesión para participar
          </div>
        ) : isMuted ? (
          <div style={{ textAlign: "center", fontSize: 12, color: "rgba(255,255,255,0.25)", fontFamily: FONT, padding: "4px 0" }}>
            Fuiste silenciado en este live
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                value={text}
                onChange={(e) => { setText(e.target.value); setSendError(null); }}
                onKeyDown={handleKeyDown}
                maxLength={500}
                placeholder="Escribe un mensaje..."
                style={{
                  flex: 1, background: "rgba(255,255,255,0.07)",
                  border: "1px solid rgba(255,255,255,0.09)", borderRadius: 18,
                  padding: "7px 12px", color: "#fff", fontSize: 12.5,
                  fontFamily: FONT, outline: "none",
                }}
              />
              <SendButton onClick={handleSend} active={!!text.trim()} />
            </div>
            {sendError && (
              <p style={{ margin: "4px 0 0", fontSize: 11, color: "#f87171", fontFamily: FONT }}>{sendError}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function Avatar({ url, name, size }: { url?: string | null; name: string; size: number }) {
  if (url) {
    return (
      <img
        src={url} alt=""
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
      />
    );
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: "rgba(168,85,247,0.5)", flexShrink: 0,
      display: "grid", placeItems: "center",
    }}>
      <span style={{ fontSize: size * 0.44, color: "#fff", fontFamily: FONT, fontWeight: 700 }}>
        {name.charAt(0).toUpperCase()}
      </span>
    </div>
  );
}

function SendButton({ onClick, active }: { onClick: () => void; active: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!active}
      style={{
        width: 32, height: 32, borderRadius: "50%", border: "none",
        background: active ? "#ef4444" : "rgba(255,255,255,0.07)",
        color: "#fff", cursor: active ? "pointer" : "default",
        display: "grid", placeItems: "center", flexShrink: 0,
        transition: "background 0.15s ease",
      }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="22" y1="2" x2="11" y2="13" />
        <polygon points="22 2 15 22 11 13 2 9 22 2" />
      </svg>
    </button>
  );
}
