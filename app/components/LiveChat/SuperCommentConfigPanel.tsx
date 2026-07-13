"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { getAuth } from "firebase/auth";
import {
  getSuperCommentConfig,
  saveSuperCommentConfig,
  copySuperCommentConfigToLive,
} from "@/lib/liveChat/super-comment-service";
import {
  DEFAULT_SUPER_COMMENT_CONFIG,
  DEFAULT_SUPER_COMMENT_TIERS,
  type SuperCommentConfig,
  type SuperCommentTier,
} from "@/lib/liveChat/types";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";

const FONT = "inherit";
const PANEL_CLOSE_THRESHOLD = 130;

type Props = {
  open: boolean;
  onClose: () => void;
  postId: string;
};

export default function SuperCommentConfigPanel({ open, onClose, postId }: Props) {
  const { format: formatMoney } = usePriceFormat();
  const [mounted, setMounted] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  const [scConfig, setScConfig] = useState<SuperCommentConfig>(DEFAULT_SUPER_COMMENT_CONFIG);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);

  const [panelOffsetY, setPanelOffsetY] = useState(0);
  const [isPanelDragging, setIsPanelDragging] = useState(false);
  const dragStartY = useRef(0);
  const dragStartOffset = useRef(0);
  const panelCloseOffsetRef = useRef(
    typeof window === "undefined" ? 900 : window.innerHeight,
  );

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const update = () => setIsDesktop(window.innerWidth >= 768);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    if (open) {
      setShouldRender(true);
      setConfigSaved(false);
      if (!isDesktop) {
        setIsPanelDragging(false);
        setPanelOffsetY(panelCloseOffsetRef.current);
        const f = window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => setPanelOffsetY(0));
        });
        return () => window.cancelAnimationFrame(f);
      }
      return;
    }
    if (!isDesktop) {
      setIsPanelDragging(false);
      setPanelOffsetY(panelCloseOffsetRef.current);
      const t = window.setTimeout(() => setShouldRender(false), 260);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(() => setShouldRender(false), 180);
    return () => window.clearTimeout(t);
  }, [open, isDesktop]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const uid = getAuth().currentUser?.uid;
    if (!uid) return;
    setLoadingConfig(true);
    getSuperCommentConfig(uid)
      .then((cfg) => {
        // Siempre aplicar los colores actuales del default por tier ID
        const colorMap = Object.fromEntries(DEFAULT_SUPER_COMMENT_TIERS.map((t) => [t.id, t.color]));
        setScConfig({
          ...cfg,
          tiers: cfg.tiers.map((t) => ({ ...t, color: colorMap[t.id] ?? t.color })),
        });
      })
      .catch(() => {})
      .finally(() => setLoadingConfig(false));
  }, [open]);

  function updateTierField(tierId: string, field: keyof SuperCommentTier, rawValue: string) {
    setScConfig((prev) => ({
      ...prev,
      tiers: prev.tiers.map((t) => {
        if (t.id !== tierId) return t;
        const numericFields: (keyof SuperCommentTier)[] = ["maxChars", "price", "displaySeconds"];
        return {
          ...t,
          [field]: numericFields.includes(field) ? (rawValue === "" ? 0 : Number(rawValue)) : rawValue,
        };
      }),
    }));
    setConfigSaved(false);
  }

  async function handleSaveConfig() {
    const uid = getAuth().currentUser?.uid;
    if (!uid) return;
    setSavingConfig(true);
    setConfigSaved(false);
    try {
      await saveSuperCommentConfig(uid, scConfig);
      await copySuperCommentConfigToLive(postId, scConfig);
      setConfigSaved(true);
      setTimeout(() => onClose(), 2000);
    } catch {
      // silencioso
    } finally {
      setSavingConfig(false);
    }
  }

  function applyPanelOffset(raw: number): number {
    if (raw >= 0) return Math.min(panelCloseOffsetRef.current, raw);
    return raw * 0.2;
  }

  function handleDragStart(e: React.PointerEvent) {
    setIsPanelDragging(true);
    dragStartY.current = e.clientY;
    dragStartOffset.current = panelOffsetY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function handleDragMove(e: React.PointerEvent) {
    if (!isPanelDragging) return;
    const delta = e.clientY - dragStartY.current;
    setPanelOffsetY(applyPanelOffset(dragStartOffset.current + delta));
  }

  function handleDragEnd() {
    if (!isPanelDragging) return;
    setIsPanelDragging(false);
    if (panelOffsetY >= PANEL_CLOSE_THRESHOLD) {
      onClose();
    } else {
      setPanelOffsetY(0);
    }
  }

  if (!mounted || !shouldRender) return null;

  const formContent = (
    <div style={{ padding: "20px 20px 28px", display: "flex", flexDirection: "column", gap: 0 }}>
      {/* Tiers */}
      {loadingConfig ? (
        <div style={{ textAlign: "center", padding: "16px 0", fontSize: 12, color: "rgba(255,255,255,0.35)", fontFamily: FONT }}>
          Cargando configuración...
        </div>
      ) : (
        <>
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10, padding: "0 2px" }}>
              {["Caracteres por msg.", "Fan paga (MXN)"].map((h) => (
                <span key={h} style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.05em", color: "rgba(255,255,255,0.35)", fontFamily: FONT, textAlign: "center" as const }}>
                  {h}
                </span>
              ))}
            </div>
            {scConfig.tiers.map((tier) => {
              const creatorEarns = formatMoney(tier.price * 0.77, { code: true });
              return (
                <div key={tier.id} style={{ marginBottom: 14 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, alignItems: "center" }}>
                    <input
                      type="number" min={10} max={600} value={tier.maxChars}
                      onChange={(e) => updateTierField(tier.id, "maxChars", e.target.value)}
                      style={{
                        width: "100%", padding: "9px 10px", borderRadius: 8,
                        border: "none",
                        background: `${tier.color}66`,
                        color: "#ffffff",
                        fontSize: 13, fontFamily: FONT, textAlign: "center" as const, outline: "none",
                        boxSizing: "border-box" as const,
                      }}
                    />
                    <input
                      type="number" min={1} value={tier.price}
                      onChange={(e) => updateTierField(tier.id, "price", e.target.value)}
                      style={{
                        width: "100%", padding: "9px 10px", borderRadius: 8,
                        border: "none",
                        background: `${tier.color}66`,
                        color: "#ffffff",
                        fontSize: 13, fontFamily: FONT, textAlign: "center" as const, outline: "none",
                        boxSizing: "border-box" as const,
                      }}
                    />
                  </div>
                  <p style={{ margin: "5px 0 0", fontSize: 10.5, color: tier.color, fontFamily: FONT, textAlign: "left" as const, lineHeight: 1.4 }}>
                    Por cada comentario que un fan pague tú cobrarás{" "}
                    <span style={{ color: "#86efac", fontWeight: 600 }}>{creatorEarns}</span>
                  </p>
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", fontFamily: FONT, marginBottom: 20, lineHeight: 1.5 }}>
            La configuración guardada se usará en todos tus próximos lives.
          </div>
        </>
      )}

      {/* Save */}
      <style>{`
        @keyframes scSaveCheckIn {
          from { transform: scale(0.3); opacity: 0; }
          to   { transform: scale(1);   opacity: 1; }
        }
      `}</style>
      {savingConfig ? (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: 44 }}>
          <div className="vibraPullRefreshSpinner refreshing" style={{ width: 32, height: 32 }} />
        </div>
      ) : configSaved ? (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: 44 }}>
          <svg
            width="36" height="36" viewBox="0 0 28 28" fill="none"
            style={{ animation: "scSaveCheckIn 0.35s cubic-bezier(0.34,1.56,0.64,1) forwards" }}
          >
            <circle cx="14" cy="14" r="14" fill="#22c55e" />
            <path d="M8 14l4.5 4.5 7.5-8" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleSaveConfig}
          style={{
            width: "100%", padding: "12px 16px", borderRadius: 10,
            background: "linear-gradient(135deg,rgba(168,85,255,0.9),rgba(124,58,237,0.9))",
            color: "#fff", fontSize: 14, fontWeight: 600, fontFamily: FONT,
            cursor: "pointer", border: "none",
          }}
        >
          Guardar configuración
        </button>
      )}
    </div>
  );

  if (isDesktop) {
    return createPortal(
      <div
        style={{
          position: "fixed", inset: 0, zIndex: 999999,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(0,0,0,0.72)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
        }}
        onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <section style={{
          width: "min(100%, 480px)", maxHeight: "min(88vh, 600px)",
          display: "flex", flexDirection: "column",
          borderRadius: 18, background: "#0a0a0a",
          boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 32px 72px rgba(0,0,0,0.9)",
          color: "#fff", overflow: "hidden",
          animation: open
            ? "scConfigIn 180ms ease-out"
            : "scConfigOut 180ms ease-in forwards",
        }}>
          <style>{`
            @keyframes scConfigIn {
              from { opacity: 0; transform: scale(0.94) translateY(10px); }
              to   { opacity: 1; transform: scale(1)    translateY(0); }
            }
            @keyframes scConfigOut {
              from { opacity: 1; transform: scale(1)    translateY(0); }
              to   { opacity: 0; transform: scale(0.94) translateY(10px); }
            }
          `}</style>
          <header style={{
            height: 56, display: "grid",
            gridTemplateColumns: "48px 1fr 48px",
            alignItems: "center", padding: "0 12px",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
            flexShrink: 0,
          }}>
            <div />
            <span style={{ fontSize: 17, fontWeight: 500, color: "#fff", textAlign: "center", letterSpacing: "-0.02em" }}>
              Supercomentarios
            </span>
            <button
              type="button"
              onClick={onClose}
              style={{ border: "none", background: "none", color: "#fff", cursor: "pointer", display: "grid", placeItems: "center", justifySelf: "end", padding: 4 }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </header>
          <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
            {formContent}
          </div>
        </section>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 999999,
        display: "flex", alignItems: "flex-end",
        background: "rgba(0,0,0,0.52)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* panel-outer */}
      <div style={{
        width: "100%", maxHeight: "calc(100vh - 72px)",
        display: "flex", flexDirection: "column",
        background: "rgba(8,9,11,0.96)",
        transform: open ? `translateY(${Math.max(0, panelOffsetY)}px)` : "translateY(100%)",
        transition: isPanelDragging ? "none" : "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
        willChange: "transform",
      }}>
        {/* section-wrapper */}
        <div style={{
          transform: `translateY(${Math.min(0, panelOffsetY)}px)`,
          transition: isPanelDragging ? "none" : "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}>
          <section style={{
            maxHeight: "calc(100vh - 72px)", borderRadius: "22px 22px 0 0",
            background: "rgba(8,9,11,0.96)", boxShadow: "0 -24px 80px rgba(0,0,0,0.56)",
            color: "#fff", overflow: "hidden", display: "flex", flexDirection: "column",
          }}>
            <header
              onPointerDown={handleDragStart}
              onPointerMove={handleDragMove}
              onPointerUp={handleDragEnd}
              onPointerCancel={handleDragEnd}
              style={{
                height: 56, display: "grid",
                gridTemplateColumns: "72px 1fr 72px",
                alignItems: "center", padding: "0 12px",
                borderBottom: "1px solid rgba(255,255,255,0.07)",
                flexShrink: 0, touchAction: "none",
                userSelect: "none", WebkitUserSelect: "none",
              }}
            >
              <div aria-hidden="true" />
              <h3 style={{ margin: 0, textAlign: "center", fontSize: 17, fontWeight: 500, letterSpacing: "-0.02em", lineHeight: 1.2, color: "#fff" }}>
                Supercomentarios
              </h3>
              <button
                type="button"
                onClick={onClose}
                style={{ width: 40, height: 40, border: "none", background: "transparent", color: "rgba(255,255,255,0.86)", cursor: "pointer", display: "grid", placeItems: "center", fontSize: 32, fontWeight: 300, lineHeight: 1, justifySelf: "end" }}
              >
                ×
              </button>
            </header>
            <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
              {formContent}
            </div>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
