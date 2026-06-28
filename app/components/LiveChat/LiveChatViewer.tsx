"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/app/providers";
import { useLiveChat } from "@/lib/hooks/useLiveChat";
import SuperCommentModal from "./SuperCommentModal";
import { subscribeVisibleSuperComments } from "@/lib/liveChat/super-comment-service";
import { getOrCreateGuestId } from "@/lib/guest-id";
import type { SuperCommentConfig, SuperComment } from "@/lib/liveChat/types";
import { DEFAULT_SUPER_COMMENT_CONFIG } from "@/lib/liveChat/types";

const FONT = 'inherit';

type Props = {
  liveId: string;
  chatEnabled?: boolean;
  liveEnded?: boolean;
  isMuted?: boolean;
  /** panel = full chat section; overlay = translucent overlay on top of video */
  mode?: "panel" | "overlay";
  broadcastMode?: "direct" | "rtmp" | null;
  superCommentConfig?: SuperCommentConfig | null;
  onDonate?: () => void;
};

type SenderInfo = { username: string; avatarUrl: string | null };

export default function LiveChatViewer({
  liveId,
  chatEnabled = true,
  liveEnded = false,
  isMuted = false,
  mode = "panel",
  broadcastMode,
  superCommentConfig,
  onDonate,
}: Props) {
  const { user } = useAuth();
  const { messages, send } = useLiveChat(liveId);
  const [text, setText] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [senderInfo, setSenderInfo] = useState<SenderInfo | null>(null);
  const [superCommentOpen, setSuperCommentOpen] = useState(false);
  const [visibleSuperComments, setVisibleSuperComments] = useState<SuperComment[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const sendErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ID de invitado — solo se genera si no hay sesión activa
  const guestId = useMemo<string>(() => {
    if (user) return "";
    if (typeof window === "undefined") return "";
    return getOrCreateGuestId();
  }, [user]);

  // Si el creador nunca guardó config, usar defaults para que el botón esté disponible en direct y rtmp
  const effectiveConfig: SuperCommentConfig | null =
    (broadcastMode === "direct" || broadcastMode === "rtmp")
      ? (superCommentConfig ?? DEFAULT_SUPER_COMMENT_CONFIG)
      : (superCommentConfig ?? null);

  const scAvailable =
    (broadcastMode === "direct" || broadcastMode === "rtmp") &&
    effectiveConfig?.enabled === true &&
    (effectiveConfig?.tiers?.length ?? 0) > 0 &&
    chatEnabled &&
    !liveEnded;

  // Botón SC para usuarios autenticados (no muteados)
  const showSuperCommentBtn = !!user && scAvailable && !isMuted;

  // Botón SC para invitados (sin auth)
  const showGuestSCBtn = !user && scAvailable;

  useEffect(() => {
    if (!user?.uid) { setSenderInfo(null); return; }
    setSenderInfo({
      username: user.displayName ?? "Espectador",
      avatarUrl: user.photoURL ?? null,
    });
    getDoc(doc(db, "users", user.uid))
      .then((snap) => {
        if (!snap.exists()) return;
        const d = snap.data();
        setSenderInfo({
          username: d?.displayName ?? d?.handle ?? user.displayName ?? "Espectador",
          avatarUrl: d?.photoURL ?? user.photoURL ?? null,
        });
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  useEffect(() => {
    if ((broadcastMode !== "direct" && broadcastMode !== "rtmp") || !liveId) return;
    const unsub = subscribeVisibleSuperComments(liveId, setVisibleSuperComments);
    return unsub;
  }, [liveId, broadcastMode]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, visibleSuperComments]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
  };

  const handleSend = useCallback(async () => {
    if (!user || !senderInfo || !text.trim()) return;
    const messageText = text.trim();
    if (messageText.length > 50) {
      if (sendErrorTimerRef.current) clearTimeout(sendErrorTimerRef.current);
      setSendError("El mensaje no puede exceder 50 caracteres.");
      sendErrorTimerRef.current = setTimeout(() => setSendError(null), 3500);
      return;
    }
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
      setText(messageText);
    }
  }, [user, senderInfo, text, send]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  // Merge regular messages + super comments into a single time-sorted feed
  type FeedItem =
    | { kind: "msg"; id: string; username: string; avatarUrl?: string | null; text: string; ts: number }
    | { kind: "sc"; id: string; username: string; avatarUrl?: string | null; text: string; ts: number; tierName: string; color: string; amount: number };

  const feed: FeedItem[] = [
    ...messages.map((m) => ({
      kind: "msg" as const,
      id: m.id,
      username: m.username,
      avatarUrl: m.avatarUrl,
      text: m.text,
      ts: (m.createdAt as { seconds?: number })?.seconds ?? 0,
    })),
    ...visibleSuperComments.map((sc) => ({
      kind: "sc" as const,
      id: sc.id,
      username: sc.username,
      avatarUrl: sc.avatarUrl,
      text: sc.text,
      ts: (sc.createdAt as { seconds?: number })?.seconds ?? 0,
      tierName: sc.tierName,
      color: sc.color,
      amount: sc.amount,
    })),
  ].sort((a, b) => a.ts - b.ts);

  const superCommentModal = (showSuperCommentBtn || showGuestSCBtn) && effectiveConfig ? (
    <SuperCommentModal
      open={superCommentOpen}
      onClose={() => setSuperCommentOpen(false)}
      postId={liveId}
      userId={user?.uid}
      guestId={!user ? guestId : undefined}
      username={senderInfo?.username ?? user?.displayName ?? undefined}
      avatarUrl={senderInfo?.avatarUrl ?? user?.photoURL ?? null}
      config={effectiveConfig}
    />
  ) : null;

  if (liveEnded) return null;

  // ── Overlay mode (mobile portrait) — TikTok style, 1/3 de pantalla ─────────
  if (mode === "overlay") {
    return (
      <>
        <div
          className="lvc-overlay"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 5,
            display: "flex", flexDirection: "column",
            background: "linear-gradient(to top, rgba(0,0,0,0.68) 50%, transparent 100%)",
          }}
        >
          <style>{`
            .lvc-msgs::-webkit-scrollbar{display:none}
            .lvc-overlay{height:33vh;height:33dvh}
          `}</style>

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
            {feed.map((item) =>
              item.kind === "sc" ? (
                <div key={item.id} style={{
                  display: "flex", alignItems: "flex-start", gap: 8,
                  margin: "0 -14px 5px -14px", padding: "6px 14px",
                  background: "transparent",
                }}>
                  <Avatar url={item.avatarUrl} name={item.username} size={34} ringColor={item.color} />
                  <div style={{ flex: 1, minWidth: 0, fontFamily: FONT }}>
                    <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 4, marginBottom: 3 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{item.username}</span>
                      <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", fontWeight: 400 }}>donó</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#4ade80" }}>${item.amount.toFixed(2)} MXN</span>
                    </div>
                    <span style={{ fontSize: 12.5, color: "rgba(255,255,255,0.9)", lineHeight: 1.4, wordBreak: "break-word" }}>{item.text}</span>
                  </div>
                </div>
              ) : (
                <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
                  <Avatar url={item.avatarUrl} name={item.username} size={20} />
                  <span style={{ fontSize: 12.5, fontFamily: FONT, lineHeight: 1.4, color: "rgba(255,255,255,0.92)", alignSelf: "center" }}>
                    <strong style={{ fontWeight: 700, color: "#fff", marginRight: 5 }}>{item.username}</strong>
                    {item.text}
                  </span>
                </div>
              )
            )}
            <div ref={messagesEndRef} />
          </div>

          {chatEnabled && !liveEnded ? (
            user ? (
              <div style={{
                paddingTop: 7,
                paddingLeft: 14,
                paddingRight: 14,
                paddingBottom: "calc(10px + env(safe-area-inset-bottom))",
              }}>
                {isMuted ? (
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", fontFamily: FONT }}>
                    Fuiste silenciado en este live
                  </div>
                ) : (
                  <>
                    {sendError && (
                      <p style={{ margin: "0 0 5px", fontSize: 11, color: "#f87171", fontFamily: FONT, textAlign: "center" }}>{sendError}</p>
                    )}
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      {showSuperCommentBtn && (
                        <BillButton onClick={() => setSuperCommentOpen(true)} />
                      )}
                      <input
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Escribe un mensaje..."
                        style={{
                          flex: 1, background: "rgba(255,255,255,0.13)",
                          border: "1px solid rgba(255,255,255,0.18)", borderRadius: 20,
                          padding: "8px 13px", color: "#fff", fontSize: 12.5,
                          fontFamily: FONT, outline: "none",
                        }}
                      />
                      {onDonate && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onDonate(); }}
                          style={{
                            width: 34, height: 34, borderRadius: "50%", flexShrink: 0,
                            background: "#3b82f6", border: "none", color: "#fff",
                            fontSize: 20, fontWeight: 700, cursor: "pointer",
                            display: "flex", alignItems: "center", justifyContent: "center",
                          }}
                        >+</button>
                      )}
                      <SendButton onClick={handleSend} active={!!text.trim()} />
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div style={{
                paddingTop: 8, paddingBottom: "calc(8px + env(safe-area-inset-bottom))",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                paddingLeft: 14, paddingRight: 14,
              }}>
                {showGuestSCBtn && (
                  <BillButton onClick={() => setSuperCommentOpen(true)} />
                )}
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", fontFamily: FONT }}>
                  Inicia sesión para comentar
                </span>
              </div>
            )
          ) : (
            <div style={{ height: "calc(8px + env(safe-area-inset-bottom))" }} />
          )}
        </div>
        {superCommentModal}
      </>
    );
  }

  // ── Panel mode (mobile horizontal, desktop sidebar) ───────────────────────
  return (
    <>
      <style>{`.lvc-panel::-webkit-scrollbar{display:none}`}</style>
      <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>

        <div
          className="lvc-panel"
          onScroll={handleScroll}
          style={{ flex: 1, overflowY: "auto", padding: "6px 10px", display: "flex", flexDirection: "column", gap: 1, scrollbarWidth: "none" }}
        >
          {feed.length === 0 && (
            <div style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
              color: "rgba(255,255,255,0.2)", fontSize: 12, fontFamily: FONT, textAlign: "center", padding: "24px 0",
            }}>
              {liveEnded ? "El live ha terminado" : chatEnabled ? "Sé el primero en comentar" : "El chat está cerrado"}
            </div>
          )}
          {feed.map((item) =>
            item.kind === "sc" ? (
              <div key={item.id} style={{
                display: "flex", gap: 8, padding: "6px 10px", alignItems: "flex-start",
                margin: "2px -10px",
                background: "transparent",
              }}>
                <Avatar url={item.avatarUrl} name={item.username} size={34} ringColor={item.color} />
                <div style={{ minWidth: 0, flex: 1, fontFamily: FONT }}>
                  <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 4, marginBottom: 3 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{item.username}</span>
                    <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", fontWeight: 400 }}>donó</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#4ade80" }}>${item.amount.toFixed(2)} MXN</span>
                  </div>
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.9)", lineHeight: 1.4, wordBreak: "break-word" }}>
                    {item.text}
                  </span>
                </div>
              </div>
            ) : (
              <div key={item.id} style={{ display: "flex", gap: 6, padding: "3px 0", alignItems: "center" }}>
                <Avatar url={item.avatarUrl} name={item.username} size={22} />
                <div style={{ minWidth: 0, flex: 1, alignSelf: "center" }}>
                  <span style={{ fontFamily: FONT, fontSize: 11.5, fontWeight: 700, color: "rgba(255,255,255,0.85)", marginRight: 4 }}>
                    {item.username}
                  </span>
                  <span style={{ fontFamily: FONT, fontSize: 12, color: "rgba(255,255,255,0.7)", lineHeight: 1.4, wordBreak: "break-word" }}>
                    {item.text}
                  </span>
                </div>
              </div>
            )
          )}
          <div ref={messagesEndRef} />
        </div>

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
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "4px 0" }}>
              {showGuestSCBtn && (
                <BillButton onClick={() => setSuperCommentOpen(true)} />
              )}
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.25)", fontFamily: FONT }}>
                Inicia sesión para comentar
              </span>
            </div>
          ) : isMuted ? (
            <div style={{ textAlign: "center", fontSize: 12, color: "rgba(255,255,255,0.25)", fontFamily: FONT, padding: "4px 0" }}>
              Fuiste silenciado en este live
            </div>
          ) : (
            <>
              {sendError && (
                <p style={{ margin: "0 0 5px", fontSize: 11, color: "#f87171", fontFamily: FONT, textAlign: "center" }}>{sendError}</p>
              )}
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {showSuperCommentBtn && (
                  <BillButton onClick={() => setSuperCommentOpen(true)} />
                )}
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={handleKeyDown}
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
            </>
          )}
        </div>
      </div>
      {superCommentModal}
    </>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function Avatar({ url, name, size, ringColor }: { url?: string | null; name: string; size: number; ringColor?: string }) {
  const INSET = ringColor ? 3 : 0;
  const RING = 2;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      {url ? (
        <div style={{ position: "absolute", inset: INSET, borderRadius: "50%", overflow: "hidden" }}>
          <Image src={url} alt="" fill style={{ objectFit: "cover" }} />
        </div>
      ) : (
        <div style={{ position: "absolute", inset: INSET, borderRadius: "50%", background: "rgba(168,85,247,0.5)", display: "grid", placeItems: "center" }}>
          <span style={{ fontSize: size * 0.44, color: "#fff", fontFamily: FONT, fontWeight: 700 }}>
            {name.charAt(0).toUpperCase()}
          </span>
        </div>
      )}
      {ringColor && (
        <div style={{
          position: "absolute", inset: 0, borderRadius: "50%",
          background: ringColor,
          WebkitMaskImage: `radial-gradient(farthest-side, transparent calc(100% - ${RING}px), white calc(100% - ${RING}px))`,
          maskImage: `radial-gradient(farthest-side, transparent calc(100% - ${RING}px), white calc(100% - ${RING}px))`,
        }} />
      )}
    </div>
  );
}

function BillButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Supercomentario"
      style={{
        width: 32, height: 32, borderRadius: "50%", border: "none",
        background: "rgba(234,179,8,0.18)",
        color: "#eab308", cursor: "pointer",
        display: "grid", placeItems: "center", flexShrink: 0,
        transition: "background 0.15s ease",
      }}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="6" width="20" height="12" rx="2" />
        <path d="M6 10h.01M10 10h8M6 14h.01M10 14h8" />
      </svg>
    </button>
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
