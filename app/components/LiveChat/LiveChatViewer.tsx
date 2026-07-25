"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import VibraFlameIcon from "@/app/components/VibraServiceIcons/VibraFlameIcon";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/app/providers";
import { useLiveChat } from "@/lib/hooks/useLiveChat";
import SuperCommentModal from "./SuperCommentModal";
import { subscribeVisibleSuperComments } from "@/lib/liveChat/super-comment-service";
import { getOrCreateGuestId } from "@/lib/guest-id";
import type { SuperCommentConfig, SuperComment } from "@/lib/liveChat/types";
import { DEFAULT_SUPER_COMMENT_CONFIG } from "@/lib/liveChat/types";
import { useReport } from "@/lib/moderation/useReport";
import ReportModal from "@/app/components/ReportModal/ReportModal";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";

const FONT = 'inherit';

type Props = {
  liveId: string;
  authorId?: string | null;
  chatEnabled?: boolean;
  liveEnded?: boolean;
  isMuted?: boolean;
  /** panel = full chat section; overlay = translucent overlay on top of video */
  mode?: "panel" | "overlay";
  broadcastMode?: "direct" | "rtmp" | null;
  superCommentConfig?: SuperCommentConfig | null;
  onDonate?: () => void;
  /** Solo overlay mode: llamado al presionar "Seguir". Si undefined, no se muestra el botón. */
  onFollow?: () => void;
  /** Solo overlay mode: like del live (flama del post). Si undefined, no se muestra el botón. */
  onLike?: () => void;
  liked?: boolean;
  likesCount?: number;
};

type SenderInfo = { username: string; avatarUrl: string | null };

export default function LiveChatViewer({
  liveId,
  authorId,
  chatEnabled = true,
  liveEnded = false,
  isMuted = false,
  mode = "panel",
  broadcastMode,
  superCommentConfig,
  onDonate,
  onFollow,
  onLike,
  liked = false,
  likesCount = 0,
}: Props) {
  const tLive = useTranslations("live");
  const { format: formatMoney } = usePriceFormat();
  const { user } = useAuth();
  const { reportTarget, openReport, closeReport } = useReport();
  const { messages, send } = useLiveChat(liveId);
  const [text, setText] = useState("");
  const [senderInfo, setSenderInfo] = useState<SenderInfo | null>(null);
  const [superCommentOpen, setSuperCommentOpen] = useState(false);
  // Al enfocar el input, el botón de supercomentario se colapsa y el campo se estira.
  const [chatFocused, setChatFocused] = useState(false);
  const [visibleSuperComments, setVisibleSuperComments] = useState<SuperComment[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const { toast: chatToast, showToast: showChatToast } = useVibraToast();

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
      username: user.displayName ?? tLive("defaultViewer"),
      avatarUrl: user.photoURL ?? null,
    });
    getDoc(doc(db, "users", user.uid))
      .then((snap) => {
        if (!snap.exists()) return;
        const d = snap.data();
        setSenderInfo({
          username: d?.displayName ?? d?.handle ?? user.displayName ?? tLive("defaultViewer"),
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
      showChatToast(tLive("messageTooLong"), "error");
      return;
    }
    setText("");
    isAtBottomRef.current = true;
    try {
      await send({
        userId: user.uid,
        username: senderInfo.username,
        avatarUrl: senderInfo.avatarUrl,
        text: messageText,
      });
    } catch {
      showChatToast(tLive("sendError"), "error");
      setText(messageText);
    }
  }, [user, senderInfo, text, send]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  // Merge regular messages + super comments into a single time-sorted feed
  type FeedItem =
    | { kind: "msg"; id: string; userId: string; username: string; avatarUrl?: string | null; text: string; ts: number }
    | { kind: "sc"; id: string; userId: string; username: string; avatarUrl?: string | null; text: string; ts: number; tierName: string; color: string; amount: number };

  const feed: FeedItem[] = [
    ...messages.map((m) => ({
      kind: "msg" as const,
      id: m.id,
      userId: m.userId,
      username: m.username,
      avatarUrl: m.avatarUrl,
      text: m.text,
      ts: (m.createdAt as { seconds?: number })?.seconds ?? 0,
    })),
    ...visibleSuperComments.map((sc) => ({
      kind: "sc" as const,
      id: sc.id,
      userId: sc.userId,
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
      authorId={authorId}
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
        <VibraToast toast={chatToast} />
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
            {(onLike || onFollow) && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 8 }}>
                {onLike ? (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onLike(); }}
                    aria-label="Me gusta"
                    style={{
                      display: "flex", alignItems: "center", gap: 5,
                      background: "none", border: "none", padding: 0,
                      cursor: "pointer", flexShrink: 0,
                    }}
                  >
                    <VibraFlameIcon size={18} active={liked} />
                    {likesCount > 0 && (
                      <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.9)" }}>
                        {likesCount.toLocaleString("es-MX")}
                      </span>
                    )}
                  </button>
                ) : <span />}
                {onFollow && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onFollow(); }}
                    style={{
                      background: "rgba(255,255,255,0.92)", border: "none",
                      color: "#000", borderRadius: 20, padding: "5px 16px",
                      fontSize: 12, fontWeight: 700, cursor: "pointer",
                      letterSpacing: "0.01em",
                    }}
                  >
                    Seguir
                  </button>
                )}
              </div>
            )}
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
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#4ade80" }}>{formatMoney(item.amount, { code: true })}</span>
                    </div>
                    {item.text ? (
                      <span style={{ fontSize: 12.5, color: "rgba(255,255,255,0.9)", lineHeight: 1.4, wordBreak: "break-word" }}>{item.text}</span>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
                  <Avatar url={item.avatarUrl} name={item.username} size={20} />
                  <span style={{ fontSize: 12.5, fontFamily: FONT, lineHeight: 1.4, color: "rgba(255,255,255,0.92)", alignSelf: "center", flex: 1, minWidth: 0 }}>
                    <strong style={{ fontWeight: 700, color: "#fff", marginRight: 5 }}>{item.username}</strong>
                    {item.text}
                  </span>
                  {user && item.userId !== user.uid && (
                    <button
                      type="button"
                      onClick={() => openReport({ targetType: "live_chat_message", targetId: item.id, targetOwnerId: item.userId })}
                      style={{ background: "none", border: "none", color: "rgba(255,255,255,0.25)", fontSize: 14, cursor: "pointer", padding: "0 2px", flexShrink: 0, lineHeight: 1 }}
                      title={tLive("reportMessage")}
                    >
                      ⋯
                    </button>
                  )}
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
                    <div style={{ display: "flex", alignItems: "center" }}>
                      {/* Campo con la flecha de enviar DENTRO (mismo sistema que el panel) */}
                      <div style={{ position: "relative", flex: 1 }}>
                        <input
                          value={text}
                          onChange={(e) => setText(e.target.value)}
                          onKeyDown={handleKeyDown}
                          onFocus={() => setChatFocused(true)}
                          onBlur={() => setChatFocused(false)}
                          maxLength={50}
                          className="vibra-chat-ph"
                          placeholder={tLive("chatPlaceholder")}
                          style={{
                            width: "100%", boxSizing: "border-box",
                            background: "rgba(255,255,255,0.06)",
                            border: "none", borderRadius: 12,
                            padding: "10px 42px 10px 12px", color: "#fff", fontSize: 13,
                            fontFamily: FONT, lineHeight: 1.5, outline: "none",
                          }}
                        />
                        <div style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)" }}>
                          <SendButton onClick={handleSend} active={!!text.trim()} />
                        </div>
                      </div>
                      {/* Moneda + corazón — se colapsan al enfocar */}
                      {(showSuperCommentBtn || onDonate) && (() => {
                        const n = (showSuperCommentBtn ? 1 : 0) + (onDonate ? 1 : 0);
                        const w = n * 31 + (n - 1) * 8;
                        return (
                          <div style={{ overflow: "hidden", flexShrink: 0, width: chatFocused ? 0 : w, marginLeft: chatFocused ? 0 : 10, opacity: chatFocused ? 0 : 1, transition: "width 0.25s ease, margin 0.25s ease, opacity 0.2s ease" }}>
                            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                              {showSuperCommentBtn && <BillButton onClick={() => setSuperCommentOpen(true)} />}
                              {onDonate && <HeartButton onClick={onDonate} />}
                            </div>
                          </div>
                        );
                      })()}
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
      <VibraToast toast={chatToast} />
      <style>{`.lvc-panel::-webkit-scrollbar{display:none}.vibra-chat-ph::placeholder{color:rgba(255,255,255,0.32)}`}</style>
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
              {liveEnded ? tLive("liveEnded") : chatEnabled ? tLive("beFirstToComment") : tLive("chatClosed")}
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
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#4ade80" }}>{formatMoney(item.amount, { code: true })}</span>
                  </div>
                  {item.text ? (
                    <span style={{ fontSize: 12, color: "rgba(255,255,255,0.9)", lineHeight: 1.4, wordBreak: "break-word" }}>
                      {item.text}
                    </span>
                  ) : null}
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

        <div style={{ padding: "8px 10px", borderTop: "1px solid transparent", flexShrink: 0 }}>
          {liveEnded ? (
            <div style={{ textAlign: "center", fontSize: 12, color: "rgba(255,255,255,0.25)", fontFamily: FONT, padding: "4px 0" }}>
              {tLive("liveEnded")}
            </div>
          ) : !chatEnabled ? (
            <div style={{ textAlign: "center", fontSize: 12, color: "rgba(255,255,255,0.25)", fontFamily: FONT, padding: "4px 0" }}>
              {tLive("chatClosed")}
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
              <div style={{ display: "flex", alignItems: "center" }}>
                {/* Campo con la flecha de enviar DENTRO */}
                <div style={{ position: "relative", flex: 1 }}>
                  <input
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onFocus={() => setChatFocused(true)}
                    onBlur={() => setChatFocused(false)}
                    maxLength={50}
                    className="vibra-chat-ph"
                    placeholder={tLive("chatPlaceholder")}
                    style={{
                      width: "100%", boxSizing: "border-box",
                      background: "rgba(255,255,255,0.06)",
                      border: "none", borderRadius: 12,
                      padding: "10px 42px 10px 12px", color: "#fff", fontSize: 13,
                      fontFamily: FONT, lineHeight: 1.5, outline: "none",
                    }}
                  />
                  <div style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)" }}>
                    <SendButton onClick={handleSend} active={!!text.trim()} />
                  </div>
                </div>
                {/* Moneda (supercomentario) + corazón (aportación) — se colapsan al enfocar */}
                {(showSuperCommentBtn || onDonate) && (() => {
                  const n = (showSuperCommentBtn ? 1 : 0) + (onDonate ? 1 : 0);
                  const w = n * 31 + (n - 1) * 8;
                  return (
                    <div style={{ overflow: "hidden", flexShrink: 0, width: chatFocused ? 0 : w, marginLeft: chatFocused ? 0 : 10, opacity: chatFocused ? 0 : 1, transition: "width 0.25s ease, margin 0.25s ease, opacity 0.2s ease" }}>
                      <div style={{ display: "flex", gap: 8 }}>
                        {showSuperCommentBtn && <BillButton onClick={() => setSuperCommentOpen(true)} />}
                        {onDonate && <HeartButton onClick={onDonate} />}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </>
          )}
        </div>
      </div>
      {superCommentModal}
      {reportTarget && <ReportModal target={reportTarget} onClose={closeReport} />}
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
  const tLive = useTranslations("live");
  return (
    <button
      type="button"
      onClick={onClick}
      title={tLive("superComment")}
      style={{
        background: "none", border: "none", padding: 0,
        color: "#fff", cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}
    >
      <svg width="31" height="31" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="8.2" />
        <path d="M12 7.4v9.2" />
        <path d="M14.3 9.4c-.5-.7-1.3-1.1-2.3-1.1-1.4 0-2.4.7-2.4 1.8 0 2.5 4.9 1.2 4.9 3.8 0 1.1-1 1.8-2.5 1.8-1 0-1.9-.4-2.4-1.2" />
      </svg>
    </button>
  );
}

// Corazón (hacer aportación) — solo el ícono, sin contenedor.
function HeartButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Hacer aportación"
      style={{
        background: "none", border: "none", padding: 0,
        color: "#fff", cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}
    >
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
    </button>
  );
}

function SendButton({ onClick, active }: { onClick: () => void; active: boolean }) {
  // Flecha morada rellena y redondeada, sin contenedor. Se atenúa si no hay texto.
  const color = active ? "#a855f7" : "rgba(255,255,255,0.25)";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!active}
      aria-label="Enviar"
      style={{
        background: "none", border: "none", padding: 0,
        cursor: active ? "pointer" : "default",
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        transition: "opacity 0.15s ease",
      }}
    >
      <svg width="23" height="23" viewBox="0 0 24 24" fill={color} stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" style={{ transform: "rotate(-20deg)" }} aria-hidden="true">
        <path d="M3.4 20.4l17.45-7.48a1 1 0 0 0 0-1.84L3.4 3.6a.993.993 0 0 0-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z" />
      </svg>
    </button>
  );
}
