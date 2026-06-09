"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { GreetingRequestDoc } from "./OwnerSidebar";

const fontStack =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

const containerBase: React.CSSProperties = {
  background: "linear-gradient(145deg, rgb(6,3,12) 0%, rgb(10,5,20) 100%)",
  border: "1px solid rgba(168,85,255,0.15)",
  borderRadius: 20,
  boxShadow: "0 -10px 40px rgba(0,0,0,0.55)",
  padding: 20,
  boxSizing: "border-box",
  fontFamily: fontStack,
  color: "#fff",
};

function formatDateDisplay(date: Date): string {
  try {
    return new Intl.DateTimeFormat("es-MX", {
      day: "numeric", month: "long", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    }).format(date);
  } catch {
    return date.toLocaleString("es-MX");
  }
}

function getRelativeTime(ts?: { toDate: () => Date } | null): string {
  if (!ts) return "Hace un momento";
  const diffMs = Date.now() - ts.toDate().getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays >= 1) return `Hace ${diffDays} ${diffDays === 1 ? "día" : "días"}`;
  if (diffHours >= 1) return `Hace ${diffHours} ${diffHours === 1 ? "hora" : "horas"}`;
  if (diffMins >= 1) return `Hace ${diffMins} ${diffMins === 1 ? "minuto" : "minutos"}`;
  return "Hace un momento";
}

function getStatusLabel(status: string): string {
  if (status === "accepted") return "En proceso";
  if (status === "delivered") return "Entregado";
  if (status === "rejected") return "Rechazado";
  return "Pendiente";
}

function getStatusStyle(status: string): React.CSSProperties {
  if (status === "delivered") return { background: "rgba(34,197,94,0.14)", color: "#86efac", border: "1px solid rgba(34,197,94,0.22)" };
  if (status === "rejected") return { background: "rgba(244,63,94,0.14)", color: "#fda4af", border: "1px solid rgba(244,63,94,0.22)" };
  if (status === "accepted") return { background: "rgba(59,130,246,0.14)", color: "#93c5fd", border: "1px solid rgba(59,130,246,0.22)" };
  return { background: "rgba(168,85,255,0.14)", color: "#d8b4fe", border: "1px solid rgba(168,85,255,0.22)" };
}

function getTypeLabel(type: string): string {
  if (type === "consejo") return "Consejo";
  if (type === "mensaje") return "Mensaje";
  return "Saludo";
}

type Props = {
  item: { id: string; data: GreetingRequestDoc };
  sourceName: string;
  sourceAvatar: string | null;
  onClose: () => void;
};

export default function BuyerGreetingRequestOverlay({ item, sourceName, sourceAvatar, onClose }: Props) {
  const [mounted, setMounted] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [sheetTransform, setSheetTransform] = useState("translateY(100%)");
  const [dragging, setDragging] = useState(false);
  const dragStartRef = useRef({ y: 0 });

  const req = item.data;
  const sourceInitial = sourceName.charAt(0).toUpperCase();
  const typeLabel = getTypeLabel(req.type);
  const createdAt = req.createdAt as { toDate: () => Date } | undefined;

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const t = setTimeout(() => setSheetTransform("translateY(0)"), 16);
    return () => clearTimeout(t);
  }, [mounted]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handleTouchStart(e: React.TouchEvent) {
    dragStartRef.current = { y: e.touches[0].clientY };
    setDragging(true);
  }

  function handleTouchMove(e: React.TouchEvent) {
    const dy = e.touches[0].clientY - dragStartRef.current.y;
    if (dy > 0) setSheetTransform(`translateY(${dy}px)`);
  }

  function handleTouchEnd(e: React.TouchEvent) {
    setDragging(false);
    const dy = e.changedTouches[0].clientY - dragStartRef.current.y;
    if (dy > 90) { onClose(); } else { setSheetTransform("translateY(0)"); }
  }

  if (!mounted) return null;

  const divider = <div style={{ height: 1, background: "rgba(255,255,255,0.06)" }} />;

  const sourceRow = (
    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
      {sourceAvatar ? (
        <img
          src={sourceAvatar}
          alt={sourceName}
          style={{ width: 38, height: 38, borderRadius: "50%", objectFit: "cover", border: "1px solid rgba(255,255,255,0.12)", flexShrink: 0 }}
        />
      ) : (
        <div style={{
          width: 38, height: 38, borderRadius: "50%", background: "rgba(255,255,255,0.07)",
          border: "1px solid rgba(255,255,255,0.12)", display: "flex", alignItems: "center",
          justifyContent: "center", fontWeight: 700, fontSize: 13, color: "#fff", flexShrink: 0,
        }}>
          {sourceInitial}
        </div>
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        <span style={{ color: "#fff", fontWeight: 600, fontSize: 13, lineHeight: 1.2, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {sourceName}
        </span>
        <span style={{ display: "block", color: "rgba(255,255,255,0.42)", fontSize: 11, lineHeight: 1.3 }}>
          {getRelativeTime(createdAt)}
        </span>
      </div>
      <span style={{
        ...getStatusStyle(req.status),
        borderRadius: 8, padding: "3px 9px",
        fontSize: 11, fontWeight: 600, flexShrink: 0,
      }}>
        {getStatusLabel(req.status)}
      </span>
    </div>
  );

  const infoSection = (
    <>
      <div style={{ display: "grid", gap: 2 }}>
        <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>Tipo de servicio</span>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          color: "#d8b4fe", fontWeight: 600, fontSize: 13,
        }}>
          {typeLabel}
        </span>
      </div>

      {req.toName ? (
        <div style={{ display: "grid", gap: 2 }}>
          <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>¿Para quién es?</span>
          <span style={{ color: "#fff", fontWeight: 600, fontSize: 13 }}>{req.toName}</span>
        </div>
      ) : null}

      {req.instructions ? (
        <div style={{ display: "grid", gap: 4 }}>
          <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>
            {req.type === "consejo" ? "¿Cuál es el contexto del consejo?" : "¿Cuál es el contexto del saludo?"}
          </span>
          <span style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.5, color: "rgba(255,255,255,0.82)" }}>
            {req.instructions}
          </span>
        </div>
      ) : null}

      {createdAt ? (
        <div style={{ display: "grid", gap: 2 }}>
          <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>Solicitado el</span>
          <span style={{ color: "#fff", fontWeight: 600, fontSize: 13 }}>
            {formatDateDisplay(createdAt.toDate())}
          </span>
        </div>
      ) : null}
    </>
  );

  // ── MOBILE ────────────────────────────────────────────────────────────────
  if (isMobile) {
    return createPortal(
      <>
        <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 10050, background: "rgba(0,0,0,0.62)" }} />
        <div style={{
          position: "fixed", bottom: 0, left: 0, right: 0,
          zIndex: 10051,
          height: "60vh",
          overflowY: "auto",
          ...containerBase,
          borderRadius: "20px 20px 0 0",
          borderBottom: "none",
          transform: sheetTransform,
          transition: dragging ? "none" : "transform 320ms cubic-bezier(0.4,0,0.2,1)",
          willChange: "transform",
          padding: 0,
        }}>
          <div
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            style={{ padding: "10px 16px 14px", userSelect: "none", touchAction: "none", display: "flex", flexDirection: "column", gap: 14 }}
          >
            <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.22)", margin: "0 auto" }} />
            <span style={{ color: "#fff", fontWeight: 500, fontSize: 17, letterSpacing: "-0.02em" }}>
              {typeLabel} solicitado
            </span>
            {sourceRow}
          </div>

          <div style={{ overflowY: "auto", padding: "0 16px", paddingBottom: "calc(20px + env(safe-area-inset-bottom))" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {divider}
              {infoSection}
              {divider}
              <button type="button" onClick={onClose} style={{
                width: "100%", height: 42, borderRadius: 12,
                border: "none", background: "transparent",
                color: "rgba(255,255,255,0.45)", fontWeight: 500, fontSize: 14,
                cursor: "pointer", fontFamily: fontStack,
              }}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      </>,
      document.body
    );
  }

  // ── DESKTOP ───────────────────────────────────────────────────────────────
  return createPortal(
    <div style={{
      position: "fixed", inset: 0, zIndex: 10050,
      background: "rgba(0,0,0,0.75)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 16, boxSizing: "border-box", fontFamily: fontStack,
    }}
      onClick={onClose}
    >
      <div style={{ ...containerBase, width: "100%", maxWidth: 380, display: "grid", gap: 16 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ color: "#fff", fontWeight: 500, fontSize: 17, letterSpacing: "-0.02em" }}>
            {typeLabel} solicitado
          </span>
          <button type="button" onClick={onClose} style={{
            background: "transparent", border: "none", color: "rgba(255,255,255,0.45)",
            cursor: "pointer", padding: "4px 6px", fontSize: 16, lineHeight: 1, borderRadius: 8,
          }}>
            ✕
          </button>
        </div>

        <div style={{ display: "grid", gap: 16 }}>
          {sourceRow}
          {divider}
          {infoSection}
        </div>

        <button type="button" onClick={onClose} style={{
          width: "100%", height: 38, borderRadius: 10,
          border: "none", background: "transparent",
          color: "rgba(255,255,255,0.38)", fontWeight: 500, fontSize: 13,
          cursor: "pointer", fontFamily: fontStack,
        }}>
          Cerrar
        </button>
      </div>
    </div>,
    document.body
  );
}
