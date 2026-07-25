"use client";

import { useEffect, useState } from "react";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { useTranslations } from "next-intl";
import { createPortal } from "react-dom";
import { submitReport } from "@/lib/moderation/reportService";
import {
  REPORT_REASONS,
  REPORT_REASON_LABELS,
  type ReportReason,
} from "@/lib/moderation/types";
import type { ReportTarget } from "@/lib/moderation/useReport";

type Props = {
  target: ReportTarget;
  onClose: () => void;
  /** Se llama tras un envío exitoso (o duplicado). Lo usa el descubrimiento para
   *  ocultar el post reportado y alimentar el algoritmo con la señal negativa. */
  onReported?: () => void;
};

type Step = "select" | "confirm" | "done";

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 10050,
  background: "rgba(0,0,0,0.78)",
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "center",
  padding: "0 0 env(safe-area-inset-bottom)",
  boxSizing: "border-box",
  backdropFilter: "blur(6px)",
  WebkitBackdropFilter: "blur(6px)",
};

const cardStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 480,
  maxHeight: "85dvh",
  borderRadius: "18px 18px 0 0",
  border: "1px solid rgba(255,255,255,0.08)",
  borderBottom: "none",
  background:
    "radial-gradient(circle at top, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.018) 18%, #0a0a0a 52%)",
  color: "#fff",
  boxShadow: "0 -8px 40px rgba(0,0,0,0.55)",
  overflowY: "auto",
  padding: "20px 20px 32px",
  boxSizing: "border-box",
};

export default function ReportModal({ target, onClose, onReported }: Props) {
  const tCommon = useTranslations("common");
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState<Step>("select");
  const [selectedReason, setSelectedReason] = useState<ReportReason | null>(null);
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useBodyScrollLock(true);

  async function handleSubmit() {
    if (!selectedReason) return;
    setLoading(true);
    setError(null);

    try {
      const result = await submitReport({
        targetType: target.targetType,
        targetId: target.targetId,
        parentId: target.parentId,
        targetOwnerId: target.targetOwnerId,
        reason: selectedReason,
        description: description.trim() || undefined,
      });

      if (result.duplicate) {
        setStep("done");
        onReported?.();
        return;
      }

      setStep("done");
      onReported?.();
    } catch {
      setError(tCommon("reportSubmitError"));
    } finally {
      setLoading(false);
    }
  }

  if (!mounted) return null;

  const content = (
    <div style={overlayStyle} onClick={onClose}>
      <div style={cardStyle} onClick={(e) => e.stopPropagation()}>

        {/* Handle de arrastre */}
        <div
          style={{
            width: 36,
            height: 4,
            borderRadius: 2,
            background: "rgba(255,255,255,0.18)",
            margin: "0 auto 20px",
          }}
        />

        {step === "select" && (
          <>
            <p style={{ fontSize: 17, fontWeight: 700, margin: "0 0 4px" }}>
              {tCommon("reportContentTitle")}
            </p>
            <p style={{ fontSize: 13, color: "#888", margin: "0 0 20px" }}>
              {tCommon("reportContentSubtitle")}
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {REPORT_REASONS.map((reason) => (
                <button
                  key={reason}
                  onClick={() => setSelectedReason(reason)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "13px 16px",
                    borderRadius: 12,
                    border: `1.5px solid ${selectedReason === reason ? "#a855ff" : "rgba(255,255,255,0.08)"}`,
                    background:
                      selectedReason === reason
                        ? "rgba(168,85,255,0.12)"
                        : "rgba(255,255,255,0.03)",
                    color: "#fff",
                    fontSize: 14,
                    fontWeight: 500,
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "border-color 120ms, background 120ms",
                  }}
                >
                  {REPORT_REASON_LABELS[reason]}
                  {selectedReason === reason && (
                    <span style={{ color: "#a855ff", fontSize: 16 }}>✓</span>
                  )}
                </button>
              ))}
            </div>

            {selectedReason && (
              <textarea
                placeholder={tCommon("reportAdditionalDesc")}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={500}
                rows={3}
                style={{
                  marginTop: 14,
                  width: "100%",
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: "1.5px solid rgba(255,255,255,0.1)",
                  background: "rgba(255,255,255,0.04)",
                  color: "#fff",
                  fontSize: 13,
                  resize: "none",
                  boxSizing: "border-box",
                  outline: "none",
                  fontFamily: "inherit",
                }}
              />
            )}

            {error && (
              <p style={{ fontSize: 13, color: "#f87171", margin: "12px 0 0" }}>
                {error}
              </p>
            )}

            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button
                onClick={onClose}
                style={{
                  flex: 1,
                  padding: "13px 0",
                  borderRadius: 12,
                  border: "1.5px solid rgba(255,255,255,0.12)",
                  background: "transparent",
                  color: "#aaa",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {tCommon("cancel")}
              </button>
              <button
                onClick={handleSubmit}
                disabled={!selectedReason || loading}
                style={{
                  flex: 2,
                  padding: "13px 0",
                  borderRadius: 12,
                  border: "none",
                  background:
                    !selectedReason || loading
                      ? "rgba(168,85,255,0.3)"
                      : "#a855ff",
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: !selectedReason || loading ? "not-allowed" : "pointer",
                  transition: "background 150ms",
                }}
              >
                {loading ? tCommon("sending") : tCommon("reportSubmit")}
              </button>
            </div>
          </>
        )}

        {step === "done" && (
          <div style={{ textAlign: "center", padding: "20px 0 8px" }}>
            <div style={{ fontSize: 44, marginBottom: 16 }}>🛡️</div>
            <p style={{ fontSize: 17, fontWeight: 700, margin: "0 0 8px" }}>
              {tCommon("reportSentTitle")}
            </p>
            <p style={{ fontSize: 13, color: "#888", margin: "0 0 24px", lineHeight: 1.5 }}>
              {tCommon("reportSentDesc")}
            </p>
            <button
              onClick={onClose}
              style={{
                padding: "13px 32px",
                borderRadius: 12,
                border: "none",
                background: "#a855ff",
                color: "#fff",
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {tCommon("close")}
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
