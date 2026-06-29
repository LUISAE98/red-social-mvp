"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";

const fontStack = "inherit";
const CLOSE_THRESHOLD = 100;

type Props = {
  open: boolean;
  onSelect: (portrait: boolean) => void;
  onClose: () => void;
};

export default function LiveCFOrientationPicker({ open, onSelect, onClose }: Props) {
  const [mounted, setMounted] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const [offsetY, setOffsetY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startY = useRef(0);
  const startOffset = useRef(0);
  const maxClose = useRef(400);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (open) { setShouldRender(true); setOffsetY(0); }
    else {
      const t = setTimeout(() => setShouldRender(false), 280);
      return () => clearTimeout(t);
    }
  }, [open]);

  const clamp = (raw: number) => raw >= 0 ? Math.min(maxClose.current, raw) : raw * 0.2;

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    setDragging(true);
    startY.current = e.clientY;
    startOffset.current = offsetY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [offsetY]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging) return;
    setOffsetY(clamp(startOffset.current + (e.clientY - startY.current)));
  }, [dragging]); // eslint-disable-line react-hooks/exhaustive-deps

  const onPointerUp = useCallback(() => {
    if (!dragging) return;
    setDragging(false);
    if (offsetY >= CLOSE_THRESHOLD) {
      setOffsetY(maxClose.current);
      setTimeout(() => { onClose(); setOffsetY(0); }, 260);
    } else {
      setOffsetY(0);
    }
  }, [dragging, offsetY, onClose]);

  if (!shouldRender || !mounted) return null;

  const overlay = open && offsetY < CLOSE_THRESHOLD;

  return createPortal(
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 10010,
        background: overlay ? "rgba(0,0,0,0.6)" : "rgba(0,0,0,0)",
        transition: open ? "background 200ms" : "background 260ms",
        display: "flex", alignItems: "flex-end",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          width: "100%", maxWidth: 520, margin: "0 auto",
          background: "#111118",
          borderRadius: "18px 18px 0 0",
          border: "1px solid rgba(255,255,255,0.09)",
          borderBottom: "none",
          paddingBottom: "env(safe-area-inset-bottom, 20px)",
          transform: `translateY(${offsetY}px)`,
          transition: dragging ? "none" : "transform 280ms cubic-bezier(0.22,1,0.36,1)",
          touchAction: "none",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* Handle */}
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 10, paddingBottom: 4 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.18)" }} />
        </div>

        {/* Título */}
        <div style={{
          padding: "14px 20px 18px",
          fontSize: 16, fontWeight: 700, color: "#fff",
          fontFamily: fontStack, textAlign: "center",
        }}>
          ¿Cómo quieres hacer el live?
        </div>

        {/* Opciones */}
        <div style={{ display: "flex", gap: 14, padding: "0 20px 28px" }}>

          {/* Vertical */}
          <button
            type="button"
            onClick={() => onSelect(true)}
            style={{
              flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 14,
              padding: "22px 10px 18px", borderRadius: 16,
              border: "1.5px solid rgba(168,85,255,0.4)",
              background: "rgba(168,85,255,0.07)",
              cursor: "pointer", color: "#fff", fontFamily: fontStack,
              WebkitTapHighlightColor: "transparent",
            }}
          >
            {/* Ícono teléfono vertical */}
            <svg width="40" height="64" viewBox="0 0 40 64" fill="none">
              <rect x="2" y="2" width="36" height="60" rx="7" stroke="rgba(168,85,255,0.85)" strokeWidth="2.2" />
              <rect x="13" y="7" width="14" height="2.5" rx="1.25" fill="rgba(255,255,255,0.25)" />
              <circle cx="20" cy="53" r="3.5" fill="rgba(168,85,255,0.65)" />
            </svg>
            <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: "0.01em" }}>Vertical</div>
          </button>

          {/* Horizontal */}
          <button
            type="button"
            onClick={() => onSelect(false)}
            style={{
              flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 14,
              padding: "22px 10px 18px", borderRadius: 16,
              border: "1.5px solid rgba(59,130,246,0.4)",
              background: "rgba(59,130,246,0.07)",
              cursor: "pointer", color: "#fff", fontFamily: fontStack,
              WebkitTapHighlightColor: "transparent",
            }}
          >
            {/* Ícono teléfono horizontal */}
            <svg width="64" height="40" viewBox="0 0 64 40" fill="none">
              <rect x="2" y="2" width="60" height="36" rx="7" stroke="rgba(59,130,246,0.85)" strokeWidth="2.2" />
              <rect x="7" y="13" width="2.5" height="14" rx="1.25" fill="rgba(255,255,255,0.25)" />
              <circle cx="53" cy="20" r="3.5" fill="rgba(59,130,246,0.65)" />
            </svg>
            <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: "0.01em" }}>Horizontal</div>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
