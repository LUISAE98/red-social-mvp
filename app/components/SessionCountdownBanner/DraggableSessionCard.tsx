"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCreatorTodaySessions } from "@/lib/hooks/useCreatorTodaySessions";
import { useBuyerNextSession } from "@/lib/hooks/useBuyerNextSession";
import CreatorSessionCountdownBanner from "./CreatorSessionCountdownBanner";
import SessionCountdownBanner from "./SessionCountdownBanner";

const POS_KEY = "vibra:session-card-pos";

type XY = { x: number; y: number };

function getDefaultPos(): XY {
  return {
    x: 16,
    y: Math.max(80, window.innerHeight - 420),
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

export default function DraggableSessionCard({ uid }: { uid: string }) {
  const { todaySessions, loading: cl } = useCreatorTodaySessions(uid);
  const { session, completedSession, loading: bl } = useBuyerNextSession(uid);

  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<XY>({ x: 16, y: 300 });
  const posRef = useRef<XY>({ x: 16, y: 300 });
  const [dragging, setDragging] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ px: number; py: number; cx: number; cy: number } | null>(null);

  useEffect(() => {
    const raw = loadSavedPos() ?? getDefaultPos();
    // Clamp to current viewport — a position saved on a wider screen can be off-screen on mobile
    const CARD_W = 320;
    const clamped: XY = {
      x: Math.max(0, Math.min(window.innerWidth - Math.min(CARD_W, window.innerWidth - 16), raw.x)),
      y: Math.max(0, Math.min(window.innerHeight - 120, raw.y)),
    };
    posRef.current = clamped;
    setPos(clamped);
    setMounted(true);
  }, []);

  const hasCreator = !cl && todaySessions.length > 0;
  const hasBuyer = !bl && (!!session || !!completedSession);
  const visible = hasCreator || hasBuyer;

  if (!mounted || !visible) return null;

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

    const cardW = cardRef.current?.offsetWidth ?? 320;
    const cardH = cardRef.current?.offsetHeight ?? 300;
    const newX = Math.max(0, Math.min(window.innerWidth - cardW, dragStart.current.cx + dx));
    const newY = Math.max(0, Math.min(window.innerHeight - cardH, dragStart.current.cy + dy));
    const newPos = { x: newX, y: newY };
    posRef.current = newPos;
    setPos(newPos);
  }

  function handlePointerUp() {
    if (dragging) {
      try { localStorage.setItem(POS_KEY, JSON.stringify(posRef.current)); } catch { /* */ }
    }
    dragStart.current = null;
    setDragging(false);
  }

  const card = (
    <div
      ref={cardRef}
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        width: 320,
        maxWidth: "calc(100vw - 32px)",
        zIndex: 10000,
        userSelect: "none",
        touchAction: "none",
        cursor: dragging ? "grabbing" : "default",
        borderRadius: 12,
        boxShadow: "0 8px 40px rgba(0,0,0,0.70)",
        overflow: "hidden",
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <CreatorSessionCountdownBanner uid={uid} />
      <SessionCountdownBanner uid={uid} />
    </div>
  );

  return createPortal(card, document.body);
}
