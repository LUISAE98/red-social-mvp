"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCreatorTodaySessions } from "@/lib/hooks/useCreatorTodaySessions";
import { useBuyerNextSession } from "@/lib/hooks/useBuyerNextSession";
import CreatorSessionCountdownBanner from "./CreatorSessionCountdownBanner";
import SessionCountdownBanner from "./SessionCountdownBanner";

const POS_KEY = "vibra:session-card-pos";
const CARD_W = 320;
const CARD_H = 420;
// px visible before triggering edge-tab snap
const EDGE_PEEK = 40;
const TAB_W = 52;
const TAB_H = 104;

type XY = { x: number; y: number };

function getDefaultPos(): XY {
  const isMobile = window.innerWidth < 768;
  return {
    x: 16,
    y: isMobile ? 80 : Math.max(80, window.innerHeight - 420),
  };
}

function loadSavedPos(): XY | null {
  try {
    const raw = localStorage.getItem(POS_KEY);
    return raw ? (JSON.parse(raw) as XY) : null;
  } catch {
    return null;
  }
}

function formatTabCountdown(ms: number): string {
  const abs = Math.max(0, ms);
  const totalSec = Math.floor(abs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function DraggableSessionCard({ uid }: { uid: string }) {
  const { nextSession: creatorNextSession, todaySessions, completedSession: creatorCompletedSession, loading: cl } = useCreatorTodaySessions(uid);
  const { session, completedSession, loading: bl } = useBuyerNextSession(uid);

  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<XY>({ x: 16, y: 300 });
  const posRef = useRef<XY>({ x: 16, y: 300 });
  const [dragging, setDragging] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ px: number; py: number; cx: number; cy: number } | null>(null);

  const [edgeMode, setEdgeMode] = useState<"left" | "right" | null>(null);
  const [edgeY, setEdgeY] = useState(120);
  const [slideInFrom, setSlideInFrom] = useState<"left" | "right" | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Prevents auto-snap from firing more than once per session
  const autoSnappedRef = useRef(false);

  // Computed before effects (not hooks, safe here)
  const sessionStartedAt = session?.startedAt ?? creatorNextSession?.startedAt ?? null;
  // Lock edge-tap while someone has clicked "Prepararse" but session hasn't started yet
  const isPreparationActive = !sessionStartedAt && (
    !!session?.preparingBuyerAt || !!session?.preparingCreatorAt ||
    !!creatorNextSession?.preparingBuyerAt || !!creatorNextSession?.preparingCreatorAt
  );

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const raw = loadSavedPos() ?? getDefaultPos();
    const clamped: XY = {
      x: Math.max(0, Math.min(window.innerWidth - Math.min(CARD_W, window.innerWidth - 16), raw.x)),
      y: Math.max(0, Math.min(window.innerHeight - CARD_H, raw.y)),
    };
    posRef.current = clamped;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPos(clamped);
    setMounted(true);
  }, []);

  // Auto-snap a pestaña cuando la sesión empieza — solo en móvil
  useEffect(() => {
    if (!mounted || !sessionStartedAt || autoSnappedRef.current || edgeMode !== null) return;
    if (window.innerWidth >= 768) return;
    autoSnappedRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEdgeMode("right");
    setEdgeY(Math.max(60, Math.min(window.innerHeight - TAB_H - 20, posRef.current.y)));
    try { localStorage.removeItem(POS_KEY); } catch { /* */ }
  }, [sessionStartedAt, mounted, edgeMode]);

  // Reset auto-snap flag when session ends so the next session can trigger again
  useEffect(() => {
    if (!sessionStartedAt) autoSnappedRef.current = false;
  }, [sessionStartedAt]);

  const hasCreator = !cl && (todaySessions.length > 0 || !!creatorCompletedSession);
  const hasBuyer = !bl && (!!session || !!completedSession);
  const visible = hasCreator || hasBuyer;

  if (!mounted || !visible) return null;

  // ── Drag handlers ──────────────────────────────────────────────────────────

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const t = e.target as HTMLElement;
    if (t.closest("button,textarea,input,a,select")) return;
    dragStart.current = {
      px: e.clientX,
      py: e.clientY,
      cx: posRef.current.x,
      cy: posRef.current.y,
    };
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragStart.current) return;
    const dx = e.clientX - dragStart.current.px;
    const dy = e.clientY - dragStart.current.py;
    if (!dragging && Math.abs(dx) <= 5 && Math.abs(dy) <= 5) return;
    if (!dragging) setDragging(true);

    const cardH = cardRef.current?.offsetHeight ?? CARD_H;
    const newX = dragStart.current.cx + dx;
    const newY = Math.max(0, Math.min(window.innerHeight - cardH, dragStart.current.cy + dy));
    const newPos = { x: newX, y: newY };
    posRef.current = newPos;
    setPos(newPos);
  }

  function handlePointerUp() {
    if (dragging) {
      const { x, y } = posRef.current;
      const cardW = cardRef.current?.offsetWidth ?? CARD_W;
      const cardH = cardRef.current?.offsetHeight ?? CARD_H;

      // Edge snap solo en móvil y fuera de countdown de preparación
      const canSnapEdge = !isPreparationActive && window.innerWidth < 768;

      if (canSnapEdge && x < -(cardW - EDGE_PEEK)) {
        setEdgeMode("left");
        setEdgeY(Math.max(60, Math.min(window.innerHeight - TAB_H - 20, y)));
        try { localStorage.removeItem(POS_KEY); } catch { /* */ }
      } else if (canSnapEdge && x > window.innerWidth - EDGE_PEEK) {
        setEdgeMode("right");
        setEdgeY(Math.max(60, Math.min(window.innerHeight - TAB_H - 20, y)));
        try { localStorage.removeItem(POS_KEY); } catch { /* */ }
      } else {
        // Clamp back into bounds and save
        const clampedX = Math.max(0, Math.min(window.innerWidth - Math.min(cardW, window.innerWidth - 16), x));
        const clampedY = Math.max(0, Math.min(window.innerHeight - cardH, y));
        const clamped = { x: clampedX, y: clampedY };
        posRef.current = clamped;
        setPos(clamped);
        try { localStorage.setItem(POS_KEY, JSON.stringify(clamped)); } catch { /* */ }
      }
    }
    dragStart.current = null;
    setDragging(false);
  }

  function restoreFromEdge() {
    const from = edgeMode!;
    const x = from === "left" ? 16 : window.innerWidth - CARD_W - 16;
    const y = Math.max(60, Math.min(window.innerHeight - CARD_H, edgeY));
    const newPos = { x, y };
    posRef.current = newPos;
    setPos(newPos);
    setEdgeMode(null);
    setSlideInFrom(from);
    setTimeout(() => setSlideInFrom(null), 420);
    try { localStorage.setItem(POS_KEY, JSON.stringify(newPos)); } catch { /* */ }
  }

  // ── Tab & card shared data ─────────────────────────────────────────────────
  const tabServiceKind = session?.serviceKind ?? creatorNextSession?.serviceKind ?? "meet_greet";
  const isMeetGreet = tabServiceKind === "meet_greet";

  const tabGradient = isMeetGreet
    ? "linear-gradient(160deg, #1e3a8a 0%, #2563eb 100%)"
    : "linear-gradient(160deg, #831843 0%, #be185d 100%)";
  const tabBorderColor = isMeetGreet
    ? "rgba(59,130,246,0.40)"
    : "rgba(236,72,153,0.40)";
  const tabShadow = isMeetGreet
    ? "4px 0 24px rgba(37,99,235,0.45)"
    : "4px 0 24px rgba(190,24,93,0.45)";

  const tabAvatarUrl = session?.creatorAvatarUrl ?? creatorNextSession?.buyerAvatarUrl ?? null;
  const tabName = session?.creatorDisplayName ?? creatorNextSession?.buyerDisplayName ?? null;

  let tabMs = 0;
  let tabInProgress = false;
  if (session) {
    if (session.startedAt && session.durationMinutes) {
      tabMs = session.startedAt.getTime() + session.durationMinutes * 60000 - now;
      tabInProgress = true;
    } else {
      tabMs = session.scheduledAt.getTime() - now;
    }
  } else if (creatorNextSession) {
    if (creatorNextSession.startedAt && creatorNextSession.durationMinutes) {
      tabMs = creatorNextSession.startedAt.getTime() + creatorNextSession.durationMinutes * 60000 - now;
      tabInProgress = true;
    } else {
      tabMs = creatorNextSession.scheduledAt.getTime() - now;
    }
  }

  const tabCountdown = formatTabCountdown(tabMs);
  // Orange while session is in progress, red when < 1 min, white while waiting
  const tabCountdownColor = tabInProgress
    ? (tabMs <= 60000 ? "#ef4444" : "#fb923c")
    : (tabMs < 0 ? "#fb923c" : "rgba(255,255,255,0.85)");

  // ── Edge tab ───────────────────────────────────────────────────────────────
  if (edgeMode) {
    const isLeft = edgeMode === "left";
    const shadowDir = isLeft ? tabShadow : tabShadow.replace("4px 0", "-4px 0");

    const tab = (
      <button
        type="button"
        onClick={restoreFromEdge}
        style={{
          position: "fixed",
          top: edgeY,
          ...(isLeft ? { insetInlineStart: 0 } : { insetInlineEnd: 0 }),
          width: TAB_W,
          height: TAB_H,
          background: tabGradient,
          border: `1px solid ${tabBorderColor}`,
          ...(isLeft
            ? { borderInlineStartWidth: 0, borderRadius: "0 14px 14px 0" }
            : { borderInlineEndWidth: 0, borderRadius: "14px 0 0 14px" }
          ),
          boxShadow: shadowDir,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          cursor: "pointer",
          zIndex: 10000,
          padding: "10px 0",
          boxSizing: "border-box",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        <div style={{
          width: 30,
          height: 30,
          borderRadius: "50%",
          overflow: "hidden",
          border: "1.5px solid rgba(255,255,255,0.30)",
          background: "rgba(255,255,255,0.12)",
          flexShrink: 0,
        }}>
          {tabAvatarUrl ? (
            <Image
              src={tabAvatarUrl}
              alt={tabName ?? ""}
              width={30}
              height={30}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <div style={{
              width: "100%", height: "100%",
              display: "grid", placeItems: "center",
              fontSize: 12, fontWeight: 700, color: "#fff", textTransform: "uppercase",
            }}>
              {tabName?.[0] ?? "•"}
            </div>
          )}
        </div>

        <span style={{
          fontSize: 11,
          fontWeight: 700,
          color: tabCountdownColor,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-0.01em",
          lineHeight: 1,
        }}>
          {tabCountdown}
        </span>
      </button>
    );
    return createPortal(tab, document.body);
  }

  // ── Full card ──────────────────────────────────────────────────────────────
  const card = (
    <>
      <style>{`
        /* El signo sale de --vb-dir (globals.css): en RTL "desde la izquierda"
           tiene que entrar por la derecha. translateX no es una propiedad logica
           y no se voltea solo. */
        @keyframes vibra-slide-from-left {
          from { transform: translateX(calc((-100% - 32px) * var(--vb-dir, 1))); opacity: 0.5; }
          to   { transform: translateX(0); opacity: 1; }
        }
        @keyframes vibra-slide-from-right {
          from { transform: translateX(calc((100% + 32px) * var(--vb-dir, 1))); opacity: 0.5; }
          to   { transform: translateX(0); opacity: 1; }
        }
      `}</style>
      <div
        ref={cardRef}
        style={{
          position: "fixed",
          insetInlineStart: pos.x,
          top: pos.y,
          width: CARD_W,
          maxWidth: "calc(100vw - 32px)",
          zIndex: 10000,
          userSelect: "none",
          touchAction: "none",
          cursor: dragging ? "grabbing" : "default",
          borderRadius: 12,
          overflow: "hidden",
          animation: slideInFrom
            ? `vibra-slide-from-${slideInFrom} 0.40s cubic-bezier(0.22, 1, 0.36, 1) both`
            : undefined,
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <CreatorSessionCountdownBanner uid={uid} />
        <SessionCountdownBanner uid={uid} />
      </div>
    </>
  );

  return createPortal(card, document.body);
}
