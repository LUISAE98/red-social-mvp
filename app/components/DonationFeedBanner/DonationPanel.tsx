"use client";

import { useEffect, useRef, useState } from "react";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { createPortal } from "react-dom";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import { formatCurrency } from "@/lib/currency/format";

type Props = {
  open: boolean;
  onClose: () => void;
  creatorName?: string | null;
  suggestedAmounts?: number[] | null;
  currency?: string | null;
  /** Se dispara con el monto al concretar la contribución (para persistirla). */
  onContribute?: (amount: number) => void;
};

const DEFAULT_AMOUNTS = [50, 100, 200, 500];
const CLOSE_THRESHOLD = 130;

function applyOffset(raw: number): number {
  if (raw >= 0) return Math.min(window.innerHeight, raw);
  return raw * 0.2;
}

export default function DonationPanel({ open, onClose, creatorName, suggestedAmounts, onContribute }: Props) {
  // Los montos de la donación se muestran directo en la moneda del espectador
  // (los elige/teclea en esa moneda); no se convierten desde MXN ni llevan "≈".
  const { currency: displayCurrency, locale } = usePriceFormat();
  const amounts = suggestedAmounts?.length ? suggestedAmounts : DEFAULT_AMOUNTS;
  const currencyLabel = displayCurrency;

  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [animOut, setAnimOut] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [offsetY, setOffsetY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const pointerStartY = useRef<number>(0);
  const pointerStartOffset = useRef<number>(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const mql = window.matchMedia("(pointer: fine)");
    setIsDesktop(mql.matches);
    const h = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener("change", h);
    return () => mql.removeEventListener("change", h);
  }, []);

  useBodyScrollLock(open);

  useEffect(() => {
    if (open) {
      setAnimOut(false);
      setVisible(true);
      setSelectedAmount(null);
      setCustomAmount("");
      setSuccess(false);
      setSubmitting(false);
    } else if (visible) {
      setAnimOut(true);
      const t = setTimeout(() => {
        setVisible(false);
        setAnimOut(false);
        setOffsetY(0);
      }, isDesktop ? 180 : 260);
      timers.current.push(t);
    }
    return () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleClose = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    onClose();
  };

  const effectiveAmount = selectedAmount !== null
    ? selectedAmount
    : customAmount.trim()
      ? (parseFloat(customAmount.replace(/[^0-9.]/g, "")) || null)
      : null;

  const canSubmit = effectiveAmount !== null && effectiveAmount > 0 && !submitting && !success;

  const handleSubmit = () => {
    if (!canSubmit) return;
    if (effectiveAmount !== null && effectiveAmount > 0) {
      onContribute?.(effectiveAmount);
    }
    setSubmitting(true);
    const t1 = setTimeout(() => {
      setSubmitting(false);
      setSuccess(true);
      const t2 = setTimeout(handleClose, 1800);
      timers.current.push(t2);
    }, 600);
    timers.current.push(t1);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (isDesktop) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointerStartY.current = e.clientY;
    pointerStartOffset.current = offsetY;
    setDragging(true);
  };
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    setOffsetY(applyOffset(pointerStartOffset.current + (e.clientY - pointerStartY.current)));
  };
  const handlePointerUp = (e: React.PointerEvent) => {
    if (!dragging) return;
    setDragging(false);
    const final = pointerStartOffset.current + (e.clientY - pointerStartY.current);
    if (final >= CLOSE_THRESHOLD) { setOffsetY(0); handleClose(); }
    else setOffsetY(0);
  };

  if (!mounted || !visible) return null;

  // ── Shared content ─────────────────────────────────────────────────────────
  const contentBlock = success ? (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: "32px 20px" }}>
      <div style={{ width: 56, height: 56, borderRadius: "50%", background: "rgba(168,85,247,0.18)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#a855f7" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <p style={{ margin: 0, fontSize: 17, fontWeight: 500, color: "#fff", textAlign: "center", letterSpacing: "-0.02em" }}>
        ¡Contribución enviada!
      </p>
      {creatorName && (
        <p style={{ margin: 0, fontSize: 13, color: "rgba(255,255,255,0.55)", textAlign: "center" }}>
          Gracias por apoyar a {creatorName}
        </p>
      )}
    </div>
  ) : (
    <div style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "18px 20px 8px" }}>
      {creatorName && (
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "rgba(255,255,255,0.55)", textAlign: "center" }}>
          Elige cuánto quieres contribuir a {creatorName}
        </p>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        {amounts.map((amt) => {
          const active = selectedAmount === amt;
          return (
            <button
              key={amt}
              type="button"
              onClick={() => { setSelectedAmount(active ? null : amt); setCustomAmount(""); }}
              style={{
                flex: "1 1 calc(25% - 6px)",
                minWidth: 64,
                padding: "10px 4px",
                borderRadius: 10,
                border: active ? "1.5px solid #a855f7" : "1.5px solid rgba(255,255,255,0.12)",
                background: active ? "rgba(168,85,247,0.14)" : "rgba(255,255,255,0.04)",
                color: active ? "#a855f7" : "rgba(255,255,255,0.85)",
                fontSize: 15,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
                textAlign: "center",
              }}
            >
              {formatCurrency(amt, displayCurrency, locale)}
            </button>
          );
        })}
      </div>
      <div style={{ position: "relative" }}>
        <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 15, color: "rgba(255,255,255,0.55)", pointerEvents: "none" }}>
          $
        </span>
        <input
          type="number"
          inputMode="decimal"
          min="1"
          placeholder="Otro monto"
          value={customAmount}
          onChange={(e) => { setCustomAmount(e.target.value); setSelectedAmount(null); }}
          style={{
            width: "100%",
            boxSizing: "border-box",
            background: "rgba(255,255,255,0.06)",
            border: customAmount ? "1.5px solid rgba(168,85,247,0.5)" : "1.5px solid rgba(255,255,255,0.10)",
            borderRadius: 12,
            padding: "10px 12px 10px 24px",
            color: "#fff",
            fontSize: 15,
            fontFamily: "inherit",
            lineHeight: 1.5,
            outline: "none",
          }}
        />
      </div>
      <p style={{ margin: "8px 0 0", fontSize: 11, color: "rgba(255,255,255,0.36)", textAlign: "center" }}>
        {currencyLabel} · Contribución voluntaria
      </p>
    </div>
  );

  const actionBtn = !success ? (
    <button
      type="button"
      disabled={!canSubmit}
      onClick={handleSubmit}
      style={{
        width: "100%", height: 42, borderRadius: 5, border: "none",
        background: !canSubmit ? "rgba(255,255,255,0.1)" : "#a855f7",
        color: !canSubmit ? "rgba(255,255,255,0.36)" : "rgba(255,255,255,0.98)",
        fontSize: 17, fontWeight: 500, fontFamily: "inherit",
        cursor: !canSubmit ? "not-allowed" : "pointer",
        letterSpacing: "-0.02em",
        display: "grid", placeItems: "center",
      }}
    >
      {submitting
        ? "Procesando..."
        : effectiveAmount && effectiveAmount > 0
          ? `Contribuir ${formatCurrency(effectiveAmount, displayCurrency, locale, { code: true })}`
          : "Contribuir"}
    </button>
  ) : null;

  // ── Desktop ────────────────────────────────────────────────────────────────
  if (isDesktop) {
    return createPortal(
      <>
        <style>{`
          @keyframes vibraDonationPanelIn  { from { opacity:0; transform:scale(0.94) translateY(10px); } to { opacity:1; transform:scale(1) translateY(0); } }
          @keyframes vibraDonationPanelOut { from { opacity:1; transform:scale(1) translateY(0); } to { opacity:0; transform:scale(0.94) translateY(10px); } }
        `}</style>
        <div
          style={{ position: "fixed", inset: 0, width: "100vw", height: "100dvh", zIndex: 1000000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "rgba(0,0,0,0.88)", fontFamily: "inherit" }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) handleClose(); }}
        >
          <section style={{
            width: "min(100%, 540px)", maxHeight: "min(88vh, 680px)", display: "flex", flexDirection: "column",
            borderRadius: 18, background: "#0a0a0a",
            boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 32px 72px rgba(0,0,0,0.9)",
            color: "#fff", overflow: "hidden",
            animation: animOut ? "vibraDonationPanelOut 180ms ease-in forwards" : "vibraDonationPanelIn 180ms ease-out",
          }}>
            {/* Header */}
            <div style={{ height: 56, display: "grid", gridTemplateColumns: "48px 1fr 48px", alignItems: "center", padding: "0 12px", borderBottom: "1px solid rgba(255,255,255,0.12)", flexShrink: 0 }}>
              <div aria-hidden="true" />
              <span style={{ fontSize: 17, fontWeight: 500, color: "#fff", lineHeight: 1.2, textAlign: "center", letterSpacing: "-0.02em" }}>
                Contribución
              </span>
              <button type="button" onClick={handleClose} aria-label="Cerrar" style={{ border: "none", background: "none", color: "#fff", cursor: "pointer", display: "grid", placeItems: "center", justifySelf: "end", padding: 4 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            {contentBlock}
            {actionBtn && (
              <div style={{ padding: "14px 20px 18px", borderTop: "1px solid rgba(255,255,255,0.12)", flexShrink: 0 }}>
                {actionBtn}
              </div>
            )}
          </section>
        </div>
      </>,
      document.body,
    );
  }

  // ── Mobile bottom sheet ────────────────────────────────────────────────────
  return createPortal(
    <div
      style={{ position: "fixed", inset: 0, width: "100vw", height: "100dvh", zIndex: 1000000, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 0, background: "rgba(0,0,0,0.52)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", fontFamily: "inherit" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      {/* panel-outer — handles entry/exit animation + close drag */}
      <div style={{
        width: "100%", maxHeight: "calc(100dvh - 72px)", display: "flex", flexDirection: "column",
        background: "rgba(8,9,11,0.96)",
        paddingBottom: "var(--vb-safe-bottom, 0px)",
        transform: animOut ? "translateY(100%)" : `translateY(${Math.max(0, applyOffset(offsetY))}px)`,
        transition: dragging ? "none" : "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
        willChange: "transform",
      }}>
        {/* section-wrapper — rubber band upward only */}
        <div style={{
          transform: `translateY(${Math.min(0, applyOffset(offsetY))}px)`,
          transition: dragging ? "none" : "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}>
          <div style={{ maxHeight: "calc(100dvh - 140px)", borderRadius: "22px 22px 0 0", background: "rgba(8,9,11,0.96)", boxShadow: "0 -24px 80px rgba(0,0,0,0.56)", color: "#fff", overflow: "hidden", display: "flex", flexDirection: "column" }}>
            {/* Mobile header — drag handle */}
            <header
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              style={{ height: 56, display: "grid", gridTemplateColumns: "72px 1fr 72px", alignItems: "center", padding: "0 12px", borderBottom: "1px solid rgba(255,255,255,0.07)", flexShrink: 0, touchAction: "none", userSelect: "none", WebkitUserSelect: "none" }}
            >
              <div aria-hidden="true" />
              <h3 style={{ margin: 0, textAlign: "center", fontSize: 17, fontWeight: 500, letterSpacing: "-0.02em", lineHeight: 1.2, color: "#fff" }}>
                Contribución
              </h3>
              <button type="button" onClick={handleClose} style={{ width: 40, height: 40, border: "none", background: "transparent", color: "rgba(255,255,255,0.86)", cursor: "pointer", display: "grid", placeItems: "center", fontSize: 32, fontWeight: 300, lineHeight: 1, justifySelf: "end" }}>
                ×
              </button>
            </header>
            {contentBlock}
          </div>
        </div>
        {/* Footer — anchored outside section-wrapper, no rubber band */}
        {actionBtn && (
          <div style={{ flexShrink: 0, borderTop: "1px solid rgba(255,255,255,0.07)", padding: "10px 14px 14px" }}>
            {actionBtn}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
