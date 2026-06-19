"use client";

import Image from "next/image";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState, memo } from "react";
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
import LiveDirectBroadcast from "@/app/components/LiveDirectBroadcast/LiveDirectBroadcast";
import { subscribeToViewerCount, updatePeakViewers } from "@/lib/liveKit/liveViewers";

const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';
const DIV = "1px solid rgba(255,255,255,0.12)";

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
  portrait?: boolean;
};

export default function LiveCreatorPanel({ open, onClose, post, portrait = false }: Props) {
  const { user } = useAuth();
  const { messages, deleteMessage } = useLiveChat(open ? post.id : null, 50);
  const [isDesktop, setIsDesktop] = useState(false);
  const [mobileTab, setMobileTab] = useState<"supercomentarios" | "estadisticas">("supercomentarios");
  const [panelRatio, setPanelRatio] = useState(0.52);
  const bodyContainerRef = useRef<HTMLDivElement>(null);
  const videoAreaRef = useRef<HTMLDivElement>(null);
  const panelDragRef = useRef<HTMLDivElement>(null);
  const isDraggingPanel = useRef(false);
  const panelDragStartY = useRef(0);
  const panelDragStartRatio = useRef(0.52);
  const panelRatioRef = useRef(0.52);
  panelRatioRef.current = panelRatio;
  const PANEL_SNAPS = [0.28, 0.52, 0.72] as const;
  const [togglingChat, setTogglingChat] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [optimisticChatEnabled, setOptimisticChatEnabled] = useState<boolean | null>(null);
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  // Ref so the resize handler always reads the latest value without stale closure
  const isBroadcastingRef = useRef(false);
  isBroadcastingRef.current = isBroadcasting;
  const [viewerCount, setViewerCount] = useState(0);
  const [peakViewerCount, setPeakViewerCount] = useState(post.liveData?.peakViewers ?? 0);
  const peakViewerCountRef = useRef(post.liveData?.peakViewers ?? 0);
  peakViewerCountRef.current = peakViewerCount;

  // Freeze the effective layout orientation during a broadcast. The `portrait`
  // prop can change mid-broadcast (e.g. LiveInlinePlayer detects stream orientation)
  // which would switch layout branches and unmount LiveDirectBroadcast.
  const [layoutPortrait, setLayoutPortrait] = useState(portrait);
  useEffect(() => {
    if (!isBroadcastingRef.current) setLayoutPortrait(portrait);
  }, [portrait]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const liveData = post.liveData;
  const liveStatus = liveData?.status;
  const chatEnabledFromFirestore = liveData?.chatEnabled !== false;
  const chatEnabled = optimisticChatEnabled ?? chatEnabledFromFirestore;

  const hlsUrl =
    post.playback?.hlsUrl ??
    (liveData?.playbackId ? `https://stream.mux.com/${liveData.playbackId}.m3u8` : null);
  const isEnded = liveStatus === "ended";
  const broadcastMode = liveData?.broadcastMode ?? null;
  const showDirectBroadcast = broadcastMode === "direct" && !isEnded;
  const showVideo = (liveStatus === "live" || isEnded) && !!hlsUrl && !showDirectBroadcast;

  useEffect(() => {
    const update = () => {
      // Freeze layout while a broadcast is active — changing branches would
      // unmount LiveDirectBroadcast and its cleanup disconnects the room.
      if (isBroadcastingRef.current) return;
      setIsDesktop(window.innerWidth >= 768);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    console.log("[LiveCreatorPanel] liveData.chatEnabled changed to:", liveData?.chatEnabled, "→ resetting optimistic");
    setOptimisticChatEnabled(null);
  }, [liveData?.chatEnabled]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!open || isEnded || !post.id) return;
    return subscribeToViewerCount(post.id, (count) => {
      setViewerCount(count);
      if (count > peakViewerCountRef.current) {
        setPeakViewerCount(count);
        updatePeakViewers(post.id, count).catch(console.warn);
      }
    });
  }, [open, isEnded, post.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggleChat = useCallback(async () => {
    if (togglingChat || !user) return;
    const newValue = !chatEnabled;
    console.log("[toggleChat] current:", chatEnabled, "→ newValue:", newValue, "postId:", post.id);
    setTogglingChat(true);
    setToggleError(null);
    setOptimisticChatEnabled(newValue);
    try {
      await updateLiveChatEnabled(post.id, newValue);
      console.log("[toggleChat] write ok, chatEnabled now:", newValue);
      // Re-assert optimistic after confirmed write to guard against the
      // Firestore listener resetting it before the snapshot arrives.
      setOptimisticChatEnabled(newValue);
    } catch (err) {
      console.error("[LiveCreatorPanel] toggleChat error:", err);
      setOptimisticChatEnabled(null);
      const msg = err instanceof Error ? err.message : String(err);
      setToggleError(msg.includes("permission") ? "Sin permiso para cambiar el chat." : "Error al cambiar el chat.");
    } finally {
      setTogglingChat(false);
    }
  }, [togglingChat, user, post.id, chatEnabled]);

  const handleMuteToggle = useCallback(async (userId: string) => {
    const isMuted = liveData?.mutedUsers?.includes(userId) ?? false;
    try {
      if (isMuted) await unmuteLiveChatUser(post.id, userId);
      else await muteLiveChatUser(post.id, userId);
    } catch { /* noop */ }
  }, [post.id, liveData]);

  const handleBanToggle = useCallback(async (userId: string) => {
    const isBanned = liveData?.bannedUsers?.includes(userId) ?? false;
    try {
      if (isBanned) await unbanLiveChatUser(post.id, userId);
      else await banLiveChatUser(post.id, userId);
    } catch { /* noop */ }
  }, [post.id, liveData]);

  const handleDeleteMessage = useCallback(async (msgId: string) => {
    if (!user) return;
    await deleteMessage(msgId, user.uid);
  }, [user, deleteMessage]);

  // ── Drag handlers para panel portrait mobile ─────────────────────────────
  const onPanelTouchStart = (e: React.TouchEvent) => {
    isDraggingPanel.current = true;
    panelDragStartY.current = e.touches[0].clientY;
    panelDragStartRatio.current = panelRatioRef.current;
  };

  const onPanelTouchMove = (e: React.TouchEvent) => {
    if (!isDraggingPanel.current) return;
    const totalH = bodyContainerRef.current?.offsetHeight ?? window.innerHeight;
    const deltaY = panelDragStartY.current - e.touches[0].clientY; // positivo = arriba
    const newRatio = Math.max(0.15, Math.min(0.85, panelDragStartRatio.current + deltaY / totalH));
    if (panelDragRef.current) panelDragRef.current.style.height = `${newRatio * 100}%`;
    if (videoAreaRef.current) videoAreaRef.current.style.height = `${(1 - newRatio) * 100}%`;
  };

  const onPanelTouchEnd = () => {
    if (!isDraggingPanel.current) return;
    isDraggingPanel.current = false;
    const totalH = bodyContainerRef.current?.offsetHeight ?? window.innerHeight;
    const cur = (panelDragRef.current?.offsetHeight ?? totalH * 0.52) / totalH;
    const snapped = [...PANEL_SNAPS].reduce((a, b) => Math.abs(b - cur) < Math.abs(a - cur) ? b : a);
    // Fijar en valor snap antes de que React re-renderice (sin flash)
    if (panelDragRef.current) panelDragRef.current.style.height = `${snapped * 100}%`;
    if (videoAreaRef.current) videoAreaRef.current.style.height = `${(1 - snapped) * 100}%`;
    setPanelRatio(snapped);
  };

  if (!open || typeof document === "undefined") return null;

  // ── Helpers ───────────────────────────────────────────────────────────────
  function sectionHeader(label: string, extra?: React.ReactNode) {
    return (
      <div style={{
        flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "9px 12px", borderBottom: DIV,
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.06em", textTransform: "uppercase" as const }}>
          {label}
        </span>
        {extra}
      </div>
    );
  }

  function comingSoon() {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.12)", fontFamily: FONT }}>Próximamente</span>
      </div>
    );
  }

  function renderStatsSection() {
    return (
      <div style={{ flex: 1, overflow: "auto", scrollbarWidth: "none", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
        {/* Espectadores actuales */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 12px", borderRadius: 10,
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, flexShrink: 0,
            background: "rgba(168,85,247,0.15)",
            display: "grid", placeItems: "center",
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a855f7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: "#fff", lineHeight: 1 }}>
              {viewerCount.toLocaleString("es-MX")}
            </span>
            <span style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>
              Espectadores ahora
            </span>
          </div>
          {liveStatus === "live" && (
            <span style={{
              marginLeft: "auto", fontSize: 9, fontWeight: 700, letterSpacing: "0.06em",
              color: "#a855f7", background: "rgba(168,85,247,0.12)",
              border: "1px solid rgba(168,85,247,0.25)", borderRadius: 4, padding: "2px 6px",
            }}>
              EN VIVO
            </span>
          )}
        </div>

        {/* Pico de espectadores */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 12px", borderRadius: 10,
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, flexShrink: 0,
            background: "rgba(251,146,60,0.15)",
            display: "grid", placeItems: "center",
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fb923c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
              <polyline points="16 7 22 7 22 13" />
            </svg>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: "#fff", lineHeight: 1 }}>
              {peakViewerCount.toLocaleString("es-MX")}
            </span>
            <span style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>
              Pico máximo simultáneo
            </span>
          </div>
        </div>
      </div>
    );
  }

  function renderEndedOverlay() {
    return (
      <div style={{
        position: "absolute", inset: 0, zIndex: 4,
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(3px)",
        WebkitBackdropFilter: "blur(3px)",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 10,
        fontFamily: FONT,
      }}>
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none"
          stroke="rgba(255,255,255,0.75)" strokeWidth="1.5"
          strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        <span style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.85)", letterSpacing: "0.01em" }}>
          Transmisión finalizada
        </span>
      </div>
    );
  }

  function renderChatSection() {
    return (
      <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", flex: 1, minHeight: 0 }}>
        {sectionHeader(
          `Chat · ${messages.length}`,
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
                fontSize: 10, fontWeight: 600, opacity: togglingChat ? 0.6 : 1, transition: "all 0.15s",
              }}
            >
              Chat {chatEnabled ? "activo" : "cerrado"}
            </button>
            {toggleError && <span style={{ fontSize: 11, color: "#f87171", fontWeight: 600 }}>{toggleError}</span>}
          </div>
        )}
        <div className="lcp-chat" style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none" }}>
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
          <div ref={messagesEndRef} />
        </div>
      </div>
    );
  }

  return createPortal(
    <div style={{
      position: "fixed", inset: 0, zIndex: 10001,
      background: "#0a0a0a", display: "flex", flexDirection: "column", fontFamily: FONT,
    }}>
      <style>{`
        @keyframes lcPulse { 0%,100%{opacity:1}50%{opacity:0.35} }
        .lcp-chat::-webkit-scrollbar{display:none}
      `}</style>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        paddingTop: "max(14px, env(safe-area-inset-top, 0px))",
        paddingBottom: 14,
        paddingLeft: "max(16px, env(safe-area-inset-left))",
        paddingRight: "max(16px, env(safe-area-inset-right))",
        borderBottom: DIV,
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
            <button
              type="button"
              onClick={isBroadcasting ? undefined : onClose}
              disabled={isBroadcasting}
              title={isBroadcasting ? "Detén la transmisión antes de salir" : "Cerrar"}
              style={{
                width: 32, height: 32, borderRadius: "50%",
                border: isBroadcasting ? "1px solid rgba(239,68,68,0.4)" : "none",
                background: isBroadcasting ? "rgba(239,68,68,0.1)" : "rgba(255,255,255,0.08)",
                color: isBroadcasting ? "rgba(239,68,68,0.5)" : "#fff",
                cursor: isBroadcasting ? "not-allowed" : "pointer",
                display: "grid", placeItems: "center",
              }}
              aria-label={isBroadcasting ? "Detén la transmisión antes de salir" : "Cerrar"}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
              </svg>
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "#fff", lineHeight: 1 }}>Centro de control</span>
            {isBroadcasting && (
              <span style={{ fontSize: 10, color: "rgba(239,68,68,0.75)", fontWeight: 500, lineHeight: 1 }}>
                Detén la transmisión para salir
              </span>
            )}
          </div>
        </div>

        <div style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          padding: "4px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700,
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

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      {isDesktop && layoutPortrait ? (
        /* ── Desktop + Portrait live ──────────────────────────────────────── */
        <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>

          {/* Left area */}
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>

            {/* Top half: Supercomentarios | Chat */}
            <div style={{ flex: 1, display: "flex", overflow: "hidden", borderBottom: DIV }}>

              {/* Supercomentarios */}
              <div style={{ flex: 1, display: "flex", flexDirection: "column", borderRight: DIV, overflow: "hidden" }}>
                {sectionHeader("Supercomentarios")}
                {comingSoon()}
              </div>

              {/* Chat en vivo */}
              {renderChatSection()}
            </div>

            {/* Bottom half: Estadísticas */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              {sectionHeader("Estadísticas")}
              {renderStatsSection()}
            </div>
          </div>

          {/* Right column: Live video portrait (story shape) */}
          {(showVideo || showDirectBroadcast) && (
            <div style={{
              flexShrink: 0, display: "flex",
              alignItems: "center", justifyContent: "center",
              padding: "16px", borderLeft: DIV,
            }}>
              <div style={{
                position: "relative",
                height: "clamp(220px, calc(100dvh - 100px), 540px)",
                aspectRatio: "9 / 16",
                borderRadius: 18,
                overflow: "hidden",
                background: "#000",
              }}>
                {showDirectBroadcast ? (
                  <LiveDirectBroadcast postId={post.id} onBroadcastingChange={setIsBroadcasting} />
                ) : (
                  <VideoPreview hlsUrl={hlsUrl!} fill />
                )}
                {isEnded && renderEndedOverlay()}
              </div>
            </div>
          )}
        </div>

      ) : isDesktop && !layoutPortrait ? (
        /* ── Desktop + Horizontal live ────────────────────────────────────── */
        showDirectBroadcast ? (
          /* Direct broadcast: cámara grande a la izquierda + chat a la derecha */
          <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>
            <div style={{ flex: 3, position: "relative", overflow: "hidden", background: "#000", minWidth: 0 }}>
              <LiveDirectBroadcast postId={post.id} onBroadcastingChange={setIsBroadcasting} />
            </div>
            <div style={{ flex: 2, display: "flex", flexDirection: "column", overflow: "hidden", borderLeft: DIV, minWidth: 0 }}>
              {renderChatSection()}
            </div>
          </div>
        ) : (
          /* Grid 2×2 para RTMP / HLS */
          <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>

            {/* Top row */}
            <div style={{ flex: 1, display: "flex", overflow: "hidden", borderBottom: DIV }}>

              {/* Top-left: Chat en vivo */}
              <div style={{ flex: 2, display: "flex", flexDirection: "column", overflow: "hidden", borderRight: DIV }}>
                {renderChatSection()}
              </div>

              {/* Top-right: Video en vivo */}
              <div style={{ flex: 3, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                {sectionHeader("En vivo")}
                {showVideo ? (
                  <div style={{
                    flex: 1, margin: "12px 16px 16px",
                    position: "relative", borderRadius: 14,
                    overflow: "hidden", background: "#000",
                  }}>
                    <VideoPreview hlsUrl={hlsUrl!} fill objectFit="contain" />
                    {isEnded && renderEndedOverlay()}
                  </div>
                ) : comingSoon()}
              </div>
            </div>

            {/* Bottom row */}
            <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

              {/* Bottom-left: Supercomentarios */}
              <div style={{ flex: 2, display: "flex", flexDirection: "column", overflow: "hidden", borderRight: DIV }}>
                {sectionHeader("Supercomentarios")}
                {comingSoon()}
              </div>

              {/* Bottom-right: Estadísticas */}
              <div style={{ flex: 3, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                {sectionHeader("Estadísticas")}
                {renderStatsSection()}
              </div>
            </div>
          </div>
        )

      ) : !isDesktop && !layoutPortrait ? (
        /* ── Mobile + Horizontal live ─────────────────────────────────────── */
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>

          {/* Video 16:9 — debajo del header que ya respeta safe-area-top */}
          {(showVideo || showDirectBroadcast) && (
            <div style={{
              flexShrink: 0, width: "100%", aspectRatio: "16/9",
              position: "relative", background: "#000",
            }}>
              {showDirectBroadcast ? (
                <LiveDirectBroadcast postId={post.id} onBroadcastingChange={setIsBroadcasting} />
              ) : (
                <VideoPreview hlsUrl={hlsUrl!} fill objectFit="contain" />
              )}
              {isEnded && renderEndedOverlay()}
            </div>
          )}

          {/* Chat en vivo — ocupa la mitad superior del espacio restante */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", borderBottom: DIV }}>
            {renderChatSection()}
          </div>

          {/* Tabs: Supercomentarios | Estadísticas — mitad inferior */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>

            {/* Tab bar */}
            <div style={{
              flexShrink: 0, display: "flex",
              borderBottom: DIV,
              padding: "0 4px",
            }}>
              {(["supercomentarios", "estadisticas"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setMobileTab(tab)}
                  style={{
                    flex: 1, padding: "10px 4px",
                    border: "none", background: "transparent",
                    color: mobileTab === tab ? "#fff" : "rgba(255,255,255,0.3)",
                    fontSize: 11, fontWeight: 700, fontFamily: FONT,
                    cursor: "pointer", letterSpacing: "0.04em", textTransform: "uppercase",
                    borderBottom: mobileTab === tab ? "2px solid #fff" : "2px solid transparent",
                    marginBottom: -1,
                    transition: "color 0.15s",
                  }}
                >
                  {tab === "supercomentarios" ? "Supercomentarios" : "Estadísticas"}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
              {mobileTab === "estadisticas" ? renderStatsSection() : comingSoon()}
            </div>
          </div>
        </div>

      ) : !isDesktop && layoutPortrait ? (
        /* ── Mobile + Portrait live: panel deslizable ────────────────────── */
        <div ref={bodyContainerRef} style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>

          {/* Área de video — crece/encoge según posición del panel */}
          <div
            ref={videoAreaRef}
            style={{
              height: `${(1 - panelRatio) * 100}%`,
              flexShrink: 0, overflow: "hidden",
              background: "#000",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            {showDirectBroadcast ? (
              <div style={{ width: "100%", height: "100%", position: "relative" }}>
                <LiveDirectBroadcast postId={post.id} onBroadcastingChange={setIsBroadcasting} />
              </div>
            ) : showVideo ? (
              <div style={{ width: "100%", height: "100%", position: "relative" }}>
                <VideoPreview hlsUrl={hlsUrl!} fill objectFit="contain" />
                {isEnded && renderEndedOverlay()}
              </div>
            ) : (
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.2)", fontFamily: FONT }}>Sin transmisión activa</span>
            )}
          </div>

          {/* Panel deslizable */}
          <div
            ref={panelDragRef}
            style={{ height: `${panelRatio * 100}%`, flexShrink: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}
          >
            {/* Handle de arrastre */}
            <div
              onTouchStart={onPanelTouchStart}
              onTouchMove={onPanelTouchMove}
              onTouchEnd={onPanelTouchEnd}
              style={{
                flexShrink: 0, paddingTop: 10, paddingBottom: 8,
                display: "flex", justifyContent: "center", alignItems: "center",
                touchAction: "none", cursor: "grab",
                borderBottom: DIV, background: "#0a0a0a",
              }}
            >
              <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.25)" }} />
            </div>

            {/* Chat en vivo */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", borderBottom: DIV }}>
              {renderChatSection()}
            </div>

            {/* Tabs: Supercomentarios | Estadísticas */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
              <div style={{ flexShrink: 0, display: "flex", padding: "0 4px", borderBottom: DIV }}>
                {(["supercomentarios", "estadisticas"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setMobileTab(tab)}
                    style={{
                      flex: 1, padding: "10px 4px",
                      border: "none", background: "transparent",
                      color: mobileTab === tab ? "#fff" : "rgba(255,255,255,0.3)",
                      fontSize: 11, fontWeight: 700, fontFamily: FONT,
                      cursor: "pointer", letterSpacing: "0.04em", textTransform: "uppercase",
                      borderBottom: mobileTab === tab ? "2px solid #fff" : "2px solid transparent",
                      marginBottom: -1, transition: "color 0.15s",
                    }}
                  >
                    {tab === "supercomentarios" ? "Supercomentarios" : "Estadísticas"}
                  </button>
                ))}
              </div>
              <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                {mobileTab === "estadisticas" ? renderStatsSection() : comingSoon()}
              </div>
            </div>
          </div>
        </div>

      ) : (
        /* ── Fallback: mobile portrait (próximamente) ─────────────────────── */
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {(showVideo || showDirectBroadcast) && (
            <div style={{ flexShrink: 0, background: "#000", position: "relative" }}>
              {showDirectBroadcast ? (
                <div style={{ width: "100%", aspectRatio: "9/16", position: "relative" }}>
                  <LiveDirectBroadcast postId={post.id} onBroadcastingChange={setIsBroadcasting} />
                </div>
              ) : (
                <>
                  <VideoPreview hlsUrl={hlsUrl!} />
                  {isEnded && renderEndedOverlay()}
                </>
              )}
            </div>
          )}
          <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", borderRight: DIV }}>
              {renderChatSection()}
            </div>
            <div style={{ width: "clamp(150px, 38%, 240px)", flexShrink: 0, display: "flex", flexDirection: "column" }}>
              {sectionHeader("Control")}
              {comingSoon()}
            </div>
          </div>
        </div>
      )}
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
      padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.04)",
      opacity: isBanned ? 0.38 : 1,
    }}>
      {msg.avatarUrl ? (
        <Image src={msg.avatarUrl} alt="" width={26} height={26} style={{ borderRadius: "50%", objectFit: "cover", flexShrink: 0, marginTop: 1 }} />
      ) : (
        <div style={{
          width: 26, height: 26, borderRadius: "50%", background: "rgba(168,85,247,0.35)",
          display: "grid", placeItems: "center", flexShrink: 0, marginTop: 1,
        }}>
          <span style={{ fontSize: 10, color: "#fff", fontWeight: 700 }}>{msg.username.charAt(0).toUpperCase()}</span>
        </div>
      )}

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

      <div style={{ display: "flex", gap: 2, flexShrink: 0, alignItems: "flex-start", marginTop: 1 }}>
        <ModActionBtn onClick={onMute} active={isMuted} activeColor="#f59e0b" title={isMuted ? "Desmutear" : "Mutear"}>
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

        <ModActionBtn onClick={onBan} active={isBanned} activeColor="#ef4444" title={isBanned ? "Desbanear" : "Banear del live"}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
          </svg>
        </ModActionBtn>

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
        background: active ? `${activeColor}22` : hovered ? "rgba(255,255,255,0.08)" : "transparent",
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
// memo: evita re-renders por cambios de estado del panel (chat, viewers, etc.)

const VideoPreview = memo(function VideoPreview({ hlsUrl, fill, objectFit = "cover" }: { hlsUrl: string; fill?: boolean; objectFit?: "cover" | "contain" }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
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

    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
      startLevel: -1,
      autoStartLoad: true,
      liveSyncDurationCount: 3,
      liveMaxLatencyDurationCount: 8,
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
      liveDurationInfinity: true,
      abrEwmaFastLive: 3.0,
      abrEwmaSlowLive: 9.0,
      nudgeOffset: 0.1,
      nudgeMaxRetry: 5,
      fragLoadingMaxRetry: 8,
      manifestLoadingMaxRetry: 6,
      levelLoadingMaxRetry: 6,
      backBufferLength: 30,
    });
    hlsRef.current = hls;
    hls.loadSource(hlsUrl);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => {}); });

    // Recuperación automática de errores — sin esto el player para silenciosamente
    hls.on(Hls.Events.ERROR, (_, data) => {
      if (!data.fatal) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        hls.startLoad();
      } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        hls.recoverMediaError();
      } else {
        hls.destroy();
        hlsRef.current = null;
      }
    });

    return () => { hls.destroy(); hlsRef.current = null; };
  }, [hlsUrl]);

  const muteBtn = (size: number, bottom: number, right: number, bordered: boolean) => (
    <button
      type="button"
      onClick={() => setMuted((m) => !m)}
      title={muted ? "Activar audio" : "Silenciar"}
      style={{
        position: "absolute", bottom, right,
        width: bordered ? 32 : 28, height: bordered ? 32 : 28, borderRadius: "50%",
        border: bordered ? "1px solid rgba(255,255,255,0.18)" : "none",
        background: "rgba(0,0,0,0.55)",
        color: "#fff", cursor: "pointer", display: "grid", placeItems: "center",
        backdropFilter: bordered ? "blur(4px)" : undefined,
        WebkitBackdropFilter: bordered ? "blur(4px)" : undefined,
      }}
    >
      {muted ? (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" />
        </svg>
      ) : (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        </svg>
      )}
    </button>
  );

  // fill mode: parent provides container size (portrait story card or landscape rounded card)
  if (fill) {
    return (
      <>
        <video
          ref={videoRef}
          autoPlay muted={muted} playsInline
          style={{ width: "100%", height: "100%", objectFit: objectFit, display: "block" }}
        />
        {muteBtn(13, 12, 12, true)}
      </>
    );
  }

  // compact mode: self-contained with maxHeight 220 (mobile fallback)
  return (
    <div style={{ position: "relative", width: "100%", aspectRatio: "16/9", maxHeight: 220, background: "#000", overflow: "hidden" }}>
      <video
        ref={videoRef}
        autoPlay muted={muted} playsInline
        style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
      />
      {muteBtn(13, 8, 8, false)}
    </div>
  );
});
