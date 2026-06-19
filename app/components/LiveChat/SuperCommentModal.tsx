"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { submitSuperComment } from "@/lib/liveChat/super-comment-service";
import type { SuperCommentConfig, SuperCommentTier } from "@/lib/liveChat/types";

const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';

type Props = {
  open: boolean;
  onClose: () => void;
  postId: string;
  userId: string;
  username: string;
  avatarUrl: string | null;
  config: SuperCommentConfig;
};

export default function SuperCommentModal({
  open,
  onClose,
  postId,
  userId,
  username,
  avatarUrl,
  config,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [shouldRender, setShouldRender] = useState(open);
  const [selectedTier, setSelectedTier] = useState<SuperCommentTier | null>(null);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (open) {
      setShouldRender(true);
      setSent(false);
      setError(null);
    } else {
      const t = window.setTimeout(() => setShouldRender(false), 200);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  // Reset al cambiar tier
  useEffect(() => {
    if (selectedTier) {
      setText((prev) => prev.slice(0, selectedTier.maxChars));
    }
  }, [selectedTier]);

  // Pre-seleccionar tier más barato al abrir
  useEffect(() => {
    if (open && config.tiers.length > 0 && !selectedTier) {
      setSelectedTier(config.tiers[0]);
    }
    if (!open) {
      setSelectedTier(null);
      setText("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleSubmit() {
    if (!selectedTier || !text.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitSuperComment({
        postId,
        userId,
        username,
        avatarUrl,
        text: text.trim(),
        tier: selectedTier,
      });
      setSent(true);
      setTimeout(() => {
        onClose();
        setSent(false);
        setText("");
        setSelectedTier(null);
      }, 1800);
    } catch {
      setError("No se pudo enviar el supercomentario. Intenta de nuevo.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!shouldRender || !mounted) return null;

  const maxChars = selectedTier?.maxChars ?? 120;
  const remaining = maxChars - text.length;

  return createPortal(
    <>
      <style>{`
        @keyframes scFadeIn { from { opacity:0 } to { opacity:1 } }
        @keyframes scFadeOut { from { opacity:1 } to { opacity:0 } }
        @keyframes scSlideUp { from { transform:translateY(100%) } to { transform:translateY(0) } }
        @keyframes scSlideDown { from { transform:translateY(0) } to { transform:translateY(100%) } }
      `}</style>

      {/* Overlay */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 10000,
          background: "rgba(0,0,0,0.65)",
          display: "flex", alignItems: "flex-end", justifyContent: "center",
          padding: "0 0 env(safe-area-inset-bottom,0)",
          animation: open ? "scFadeIn 0.18s ease" : "scFadeOut 0.18s ease forwards",
        }}
      >
        {/* Panel */}
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            width: "100%", maxWidth: 480,
            maxHeight: "85vh", overflowY: "auto",
            borderRadius: "16px 16px 0 0",
            background: "rgba(10,5,20,0.98)",
            border: "1px solid rgba(168,85,255,0.25)",
            borderBottom: "none",
            padding: "20px 20px 32px",
            animation: open ? "scSlideUp 0.2s ease" : "scSlideDown 0.2s ease forwards",
          }}
        >
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 30, height: 30, borderRadius: 8,
                background: "rgba(234,179,8,0.15)",
                border: "1px solid rgba(234,179,8,0.3)",
                display: "grid", placeItems: "center",
              }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#eab308" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="6" width="20" height="12" rx="2" />
                  <path d="M6 10h.01M10 10h8M6 14h.01M10 14h8" />
                </svg>
              </div>
              <span style={{ fontSize: 15, fontWeight: 600, color: "#fff", fontFamily: FONT }}>
                Supercomentario
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              style={{
                width: 28, height: 28, borderRadius: "50%", border: "none",
                background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.5)",
                cursor: "pointer", fontSize: 16, display: "grid", placeItems: "center",
                fontFamily: FONT,
              }}
            >
              ×
            </button>
          </div>

          {sent ? (
            <div style={{ textAlign: "center", padding: "32px 0" }}>
              <div style={{
                width: 52, height: 52, borderRadius: "50%",
                background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.3)",
                display: "grid", placeItems: "center", margin: "0 auto 16px",
              }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#fff", fontFamily: FONT }}>
                ¡Supercomentario enviado!
              </div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", fontFamily: FONT, marginTop: 6 }}>
                El creador lo leerá en cualquier momento.
              </div>
            </div>
          ) : (
            <>
              {/* Selección de tier */}
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "rgba(255,255,255,0.35)", fontFamily: FONT, marginBottom: 10 }}>
                  Elige tu nivel
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {config.tiers.map((tier) => {
                    const isSelected = selectedTier?.id === tier.id;
                    return (
                      <button
                        key={tier.id}
                        type="button"
                        onClick={() => setSelectedTier(tier)}
                        style={{
                          display: "flex", alignItems: "center", gap: 12,
                          padding: "10px 14px", borderRadius: 10,
                          border: `1px solid ${isSelected ? tier.color + "80" : "rgba(255,255,255,0.08)"}`,
                          background: isSelected ? tier.color + "18" : "rgba(255,255,255,0.03)",
                          cursor: "pointer", textAlign: "left",
                          transition: "all 0.15s",
                        }}
                      >
                        <div style={{
                          width: 10, height: 10, borderRadius: "50%",
                          background: tier.color, flexShrink: 0,
                          boxShadow: isSelected ? `0 0 8px ${tier.color}` : "none",
                        }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: isSelected ? "#fff" : "rgba(255,255,255,0.7)", fontFamily: FONT }}>
                            {tier.name}
                          </span>
                          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", fontFamily: FONT, marginLeft: 8 }}>
                            hasta {tier.maxChars} caracteres
                          </span>
                        </div>
                        <span style={{
                          fontSize: 14, fontWeight: 700,
                          color: isSelected ? tier.color : "rgba(255,255,255,0.5)",
                          fontFamily: FONT, flexShrink: 0,
                        }}>
                          ${tier.price} MXN
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Input de texto */}
              {selectedTier && (
                <div style={{ marginBottom: 18 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "rgba(255,255,255,0.35)", fontFamily: FONT }}>
                      Tu mensaje
                    </div>
                    <span style={{ fontSize: 11, fontFamily: FONT, color: remaining < 20 ? "#f87171" : "rgba(255,255,255,0.3)" }}>
                      {remaining} restantes
                    </span>
                  </div>
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value.slice(0, maxChars))}
                    placeholder={`Escribe tu supercomentario (máx. ${maxChars} caracteres)...`}
                    rows={3}
                    style={{
                      width: "100%", boxSizing: "border-box",
                      background: "rgba(255,255,255,0.05)",
                      border: `1px solid ${text.trim() ? selectedTier.color + "50" : "rgba(255,255,255,0.1)"}`,
                      borderRadius: 10, padding: "10px 12px",
                      color: "#fff", fontSize: 13, fontFamily: FONT,
                      resize: "none", outline: "none", lineHeight: 1.5,
                      transition: "border-color 0.15s",
                    }}
                  />
                </div>
              )}

              {/* Error */}
              {error && (
                <p style={{ margin: "0 0 12px", fontSize: 12, color: "#f87171", fontFamily: FONT }}>
                  {error}
                </p>
              )}

              {/* Botón de pago */}
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting || !text.trim() || !selectedTier}
                style={{
                  width: "100%", padding: "12px 20px", borderRadius: 10, border: "none",
                  background: selectedTier && text.trim() && !submitting
                    ? `linear-gradient(135deg,${selectedTier.color}cc,${selectedTier.color}99)`
                    : "rgba(255,255,255,0.07)",
                  color: "#fff", fontSize: 14, fontWeight: 700, fontFamily: FONT,
                  cursor: submitting || !text.trim() || !selectedTier ? "not-allowed" : "pointer",
                  transition: "all 0.2s",
                }}
              >
                {submitting
                  ? "Enviando..."
                  : selectedTier
                  ? `Pagar $${selectedTier.price} MXN y enviar`
                  : "Selecciona un nivel"}
              </button>

              <p style={{ margin: "10px 0 0", fontSize: 11, color: "rgba(255,255,255,0.25)", fontFamily: FONT, textAlign: "center" }}>
                El creador recibirá el 77% del monto.
              </p>
            </>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
