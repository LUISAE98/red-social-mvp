"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import type { Post } from "@/lib/posts/types";
import type { LiveChatMessage } from "@/lib/liveChat/types";
import { useLiveChat } from "@/lib/hooks/useLiveChat";
import {
  updateLiveChatEnabled,
  muteLiveChatUser,
  unmuteLiveChatUser,
  banLiveChatUser,
  unbanLiveChatUser,
} from "@/lib/liveChat/live-chat-service";
import { useAuth } from "@/app/providers";

const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';

const STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  scheduled: "Programado",
  upcoming: "Por comenzar",
  live: "En vivo",
  ended: "Finalizado",
  cancelled: "Cancelado",
  error: "Error",
};

type Props = {
  open: boolean;
  onClose: () => void;
  post: Post;
};

export default function LiveCreatorPanel({ open, onClose, post }: Props) {
  const { user } = useAuth();
  const { messages, deleteMessage } = useLiveChat(open ? post.id : null);
  const [togglingChat, setTogglingChat] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [optimisticChatEnabled, setOptimisticChatEnabled] = useState<boolean | null>(null);

  const liveData = post.liveData;
  const liveStatus = liveData?.status;
  const chatEnabledFromFirestore = liveData?.chatEnabled !== false;
  const chatEnabled = optimisticChatEnabled ?? chatEnabledFromFirestore;

  const hlsUrl =
    post.playback?.hlsUrl ??
    (liveData?.playbackId ? `https://stream.mux.com/${liveData.playbackId}.m3u8` : null);
  const showVideo = liveStatus === "live" && !!hlsUrl;

  useEffect(() => {
    setOptimisticChatEnabled(null);
  }, [liveData?.chatEnabled]);

  // ── Toggle chat ───────────────────────────────────────────────────────────
  const handleToggleChat = useCallback(async () => {
    if (togglingChat || !user) return;
    const newValue = !chatEnabled;
    setTogglingChat(true);
    setToggleError(null);
    setOptimisticChatEnabled(newValue);
    try {
      await updateLiveChatEnabled(post.id, newValue);
    } catch (err) {
      console.error("[LiveCreatorPanel] toggle chat error", err);
      setOptimisticChatEnabled(null);
      setToggleError("Error al cambiar estado del chat.");
    } finally {
      setTogglingChat(false);
    }
  }, [togglingChat, user, post.id, chatEnabled]);

  // ── Mute/ban/delete ───────────────────────────────────────────────────────
  const handleMuteToggle = useCallback(async (userId: string) => {
    const isMuted = liveData?.mutedUsers?.includes(userId) ?? false;
    try {
      if (isMuted) await unmuteLiveChatUser(post.id, userId);
      else await muteLiveChatUser(post.id, userId);
    } catch (err) {
      console.error("[LiveCreatorPanel] mute error", err);
    }
  }, [post.id, liveData]);

  const handleBanToggle = useCallback(async (userId: string) => {
    const isBanned = liveData?.bannedUsers?.includes(userId) ?? false;
    try {
      if (isBanned) await unbanLiveChatUser(post.id, userId);
      else await banLiveChatUser(post.id, userId);
    } catch (err) {
      console.error("[LiveCreatorPanel] ban error", err);
    }
  }, [post.id, liveData]);

  const handleDeleteMessage = useCallback(async (msgId: string) => {
    if (!user) return;
    await deleteMessage(msgId, user.uid);
  }, [user, deleteMessage]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 10001,
        background: "#0a0a0a",
        display: "flex", flexDirection: "column",
        fontFamily: FONT,
      }}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        paddingTop: "max(14px, env(safe-area-inset-top, 0px))",
        paddingBottom: 14,
        paddingLeft: 16,
        paddingRight: 16,
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              width: 32, height: 32, borderRadius: "50%",
              border: "none", background: "rgba(255,255,255,0.08)",
              color: "#fff", cursor: "pointer", display: "grid", placeItems: "center",
            }}
            aria-label="Cerrar"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
            </svg>
          </button>
          <span style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>Gestionar Live</span>
        </div>

        <div style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          padding: "4px 10px", borderRadius: 999,
          fontSize: 11, fontWeight: 700,
          background: liveStatus === "live" ? "rgba(239,68,68,0.12)" : "rgba(255,255,255,0.06)",
          color: liveStatus === "live" ? "#ef4444" : "rgba(255,255,255,0.45)",
          border: `1px solid ${liveStatus === "live" ? "rgba(239,68,68,0.3)" : "rgba(255,255,255,0.1)"}`,
        }}>
          {liveStatus === "live" && (
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#ef4444", animation: "lcPulse 1.4s ease-in-out infinite" }} />
          )}
          {liveStatus ? (STATUS_LABELS[liveStatus] ?? liveStatus) : "—"}
        </div>
      </div>

      {/* ── Video ──────────────────────────────────────────────────────────── */}
      {showVideo && (
        <div style={{ flexShrink: 0, background: "#000" }}>
          <VideoPreview hlsUrl={hlsUrl!} />
        </div>
      )}

      {/* ── Bottom: chat (izquierda) + panel reservado (derecha) ───────────── */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>

        {/* LEFT — Chat en vivo */}
        <div style={{
          flex: 1, display: "flex", flexDirection: "column", overflow: "hidden",
          borderRight: "1px solid rgba(255,255,255,0.06)",
        }}>
          {/* Chat section header */}
          <div style={{
            flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "9px 12px", borderBottom: "1px solid rgba(255,255,255,0.05)",
          }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.28)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
              Chat · {messages.length}
            </span>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
              <button
                type="button"
                onClick={handleToggleChat}
                disabled={togglingChat}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  padding: "4px 10px", borderRadius: 999,
                  border: chatEnabled ? "1px solid rgba(34,197,94,0.35)" : "1px solid rgba(255,255,255,0.1)",
                  background: chatEnabled ? "rgba(34,197,94,0.08)" : "rgba(255,255,255,0.04)",
                  color: chatEnabled ? "#4ade80" : "rgba(255,255,255,0.3)",
                  cursor: togglingChat ? "not-allowed" : "pointer",
                  fontSize: 10, fontWeight: 600,
                  opacity: togglingChat ? 0.6 : 1,
                  transition: "all 0.15s",
                }}
              >
                Chat {chatEnabled ? "activo" : "cerrado"}
              </button>
              {toggleError && (
                <span style={{ fontSize: 9, color: "#f87171" }}>{toggleError}</span>
              )}
            </div>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {messages.length === 0 ? (
              <div style={{
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                height: "100%", gap: 8, color: "rgba(255,255,255,0.15)", textAlign: "center", padding: 20,
              }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                <span style={{ fontSize: 12 }}>
                  {liveStatus === "live" ? "Esperando mensajes..." : "Sin mensajes aún"}
                </span>
              </div>
            ) : (
              messages.map((msg) => (
                <ChatMessageRow
                  key={msg.id}
                  msg={msg}
                  isMuted={liveData?.mutedUsers?.includes(msg.userId) ?? false}
                  isBanned={liveData?.bannedUsers?.includes(msg.userId) ?? false}
                  onMute={() => handleMuteToggle(msg.userId)}
                  onBan={() => handleBanToggle(msg.userId)}
                  onDelete={() => handleDeleteMessage(msg.id)}
                />
              ))
            )}
          </div>
        </div>

        {/* RIGHT — Panel reservado */}
        <div style={{
          width: "clamp(150px, 38%, 240px)", flexShrink: 0,
          display: "flex", flexDirection: "column",
        }}>
          <div style={{
            padding: "9px 12px", borderBottom: "1px solid rgba(255,255,255,0.05)", flexShrink: 0,
          }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.18)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
              Control
            </span>
          </div>
          <div style={{
            flex: 1, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            gap: 6, padding: 16,
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14" />
            </svg>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.12)", textAlign: "center", lineHeight: 1.4 }}>
              Próximas funciones
            </span>
          </div>
        </div>
      </div>

      <style>{`@keyframes lcPulse { 0%,100%{opacity:1}50%{opacity:0.35} }`}</style>
    </div>,
    document.body
  );
}

// ── ChatMessageRow ─────────────────────────────────────────────────────────

type MessageRowProps = {
  msg: LiveChatMessage;
  isMuted: boolean;
  isBanned: boolean;
  onMute: () => void;
  onBan: () => void;
  onDelete: () => void;
};

function ChatMessageRow({ msg, isMuted, isBanned, onMute, onBan, onDelete }: MessageRowProps) {
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 8,
      padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.03)",
      opacity: isBanned ? 0.38 : 1,
    }}>
      {/* Avatar */}
      {msg.avatarUrl ? (
        <img src={msg.avatarUrl} alt="" style={{ width: 26, height: 26, borderRadius: "50%", objectFit: "cover", flexShrink: 0, marginTop: 1 }} />
      ) : (
        <div style={{
          width: 26, height: 26, borderRadius: "50%", background: "rgba(168,85,247,0.35)",
          display: "grid", placeItems: "center", flexShrink: 0, marginTop: 1,
        }}>
          <span style={{ fontSize: 10, color: "#fff", fontWeight: 700 }}>{msg.username.charAt(0).toUpperCase()}</span>
        </div>
      )}

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 1, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.75)" }}>{msg.username}</span>
          {isMuted && !isBanned && (
            <span style={{ fontSize: 9, fontWeight: 700, color: "#f59e0b", background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: 3, padding: "0px 4px" }}>
              MUTE
            </span>
          )}
          {isBanned && (
            <span style={{ fontSize: 9, fontWeight: 700, color: "#ef4444", background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 3, padding: "0px 4px" }}>
              BAN
            </span>
          )}
        </div>
        <span style={{ fontSize: 11.5, color: "rgba(255,255,255,0.5)", lineHeight: 1.4, wordBreak: "break-word" }}>
          {msg.text}
        </span>
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 2, flexShrink: 0, alignItems: "flex-start", marginTop: 1 }}>
        {/* Mute toggle */}
        <ModActionBtn
          onClick={onMute}
          active={isMuted}
          activeColor="#f59e0b"
          title={isMuted ? "Desmutear" : "Mutear"}
        >
          {isMuted ? (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" />
            </svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            </svg>
          )}
        </ModActionBtn>

        {/* Ban toggle */}
        <ModActionBtn
          onClick={onBan}
          active={isBanned}
          activeColor="#ef4444"
          title={isBanned ? "Desbanear" : "Banear del live"}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
          </svg>
        </ModActionBtn>

        {/* Delete message */}
        <ModActionBtn onClick={onDelete} active={false} activeColor="#ef4444" title="Eliminar mensaje">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14H6L5 6" />
            <path d="M10 11v6" /><path d="M14 11v6" />
            <path d="M9 6V4h6v2" />
          </svg>
        </ModActionBtn>
      </div>
    </div>
  );
}

function ModActionBtn({
  onClick, active, activeColor, title, children,
}: {
  onClick: () => void;
  active: boolean;
  activeColor: string;
  title: string;
  children: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 24, height: 24, borderRadius: 5, border: "none",
        background: active
          ? `${activeColor}22`
          : hovered ? "rgba(255,255,255,0.08)" : "transparent",
        color: active ? activeColor : hovered ? "#fff" : "rgba(255,255,255,0.22)",
        cursor: "pointer", display: "grid", placeItems: "center",
        transition: "background 0.12s, color 0.12s",
      }}
    >
      {children}
    </button>
  );
}

// ── VideoPreview ───────────────────────────────────────────────────────────

function VideoPreview({ hlsUrl }: { hlsUrl: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !hlsUrl) return;

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = hlsUrl;
      video.play().catch(() => {});
      return;
    }

    if (!Hls.isSupported()) return;

    const hls = new Hls({ autoStartLoad: true, startLevel: -1 });
    hls.loadSource(hlsUrl);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      video.play().catch(() => {});
    });

    return () => { hls.destroy(); };
  }, [hlsUrl]);

  return (
    <div style={{ position: "relative", width: "100%", aspectRatio: "16/9", maxHeight: 220, background: "#000", overflow: "hidden" }}>
      <video
        ref={videoRef}
        autoPlay
        muted={muted}
        playsInline
        style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
      />
      <button
        type="button"
        onClick={() => setMuted((m) => !m)}
        style={{
          position: "absolute", bottom: 8, right: 8,
          width: 28, height: 28, borderRadius: "50%",
          border: "none", background: "rgba(0,0,0,0.55)",
          color: "#fff", cursor: "pointer", display: "grid", placeItems: "center",
        }}
        title={muted ? "Activar audio" : "Silenciar"}
      >
        {muted ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" />
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          </svg>
        )}
      </button>
    </div>
  );
}
