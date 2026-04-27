"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type DonationMode = "none" | "general" | "wedding";
type Currency = "MXN" | "USD";

export type DonationEntryDonation = {
  mode: DonationMode;
  enabled?: boolean;
  visible?: boolean;
  currency?: Currency | null;
  suggestedAmounts?: number[] | null;
  goalLabel?: string | null;
};

type Props = {
  donation: DonationEntryDonation | null;
  isLoggedIn: boolean;
  onRequireLogin: () => void;
  viewerCanDonate?: boolean;
  videoEnabled?: boolean;
  videoUrl?: string | null;
  onDonateIntent?: (payload: {
    mode: DonationMode;
    amount: number;
    currency: Currency;
  }) => void;
  buttonStyle?: React.CSSProperties;
};

type DonationAmountMode = "minimum" | "custom";

function formatMoney(value: number, currency: Currency) {
  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function normalizeCurrency(value: unknown): Currency {
  return value === "USD" ? "USD" : "MXN";
}

function normalizeSuggestedAmounts(value: unknown): number[] {
  if (!Array.isArray(value)) return [];

  return Array.from(
    new Set(
      value
        .map((item) => Number(item))
        .filter((n) => Number.isFinite(n) && n > 0)
        .slice(0, 12)
    )
  );
}

export default function DonationEntryPoint({
  donation,
  isLoggedIn,
  onRequireLogin,
  viewerCanDonate = true,
  videoEnabled = false,
  videoUrl = null,
  onDonateIntent,
  buttonStyle,
}: Props) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [amountMode, setAmountMode] = useState<DonationAmountMode>("minimum");
  const [customAmount, setCustomAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const normalized = useMemo(() => {
    if (!donation) return null;

    const mode: DonationMode =
      donation.mode === "general" || donation.mode === "wedding"
        ? donation.mode
        : "none";

    const enabled = donation.enabled === true;
    const visible = donation.visible !== false;
    const currency = normalizeCurrency(donation.currency);
    const suggestedAmounts = normalizeSuggestedAmounts(
      donation.suggestedAmounts
    );
    const goalLabel =
      typeof donation.goalLabel === "string" && donation.goalLabel.trim()
        ? donation.goalLabel.trim()
        : null;

    return {
      mode,
      enabled,
      visible,
      currency,
      suggestedAmounts,
      goalLabel,
    };
  }, [donation]);

  const minimumAmount =
    normalized && normalized.suggestedAmounts.length > 0
      ? normalized.suggestedAmounts[0]
      : null;

  const shouldRenderButton =
    normalized != null &&
    normalized.enabled &&
    normalized.visible &&
    (normalized.mode === "general" || normalized.mode === "wedding") &&
    minimumAmount != null;

  if (!shouldRenderButton || !normalized || minimumAmount == null) {
    return null;
  }

  const resolvedNormalized = normalized;
  const resolvedMinimumAmount = minimumAmount;

  const buttonLabel =
    resolvedNormalized.mode === "wedding" ? "Apoyar boda" : "Apoyar";

  const buttonEmoji = resolvedNormalized.mode === "wedding" ? "💍" : "💗";

  const buttonAccent =
    resolvedNormalized.mode === "wedding" ? "#C084FC" : "#FB7185";

  function closePanel() {
    setOpen(false);
    setAmountMode("minimum");
    setCustomAmount("");
    setError(null);
    setSuccess(null);
    setSubmitting(false);
  }

  function handleOpen() {
    if (!viewerCanDonate) return;

    if (!isLoggedIn) {
      onRequireLogin();
      return;
    }

    setError(null);
    setSuccess(null);
    setAmountMode("minimum");
    setCustomAmount("");
    setOpen(true);
  }

  async function handleDonate() {
    if (!viewerCanDonate) return;

    if (!isLoggedIn) {
      onRequireLogin();
      return;
    }

    let finalAmount = resolvedMinimumAmount;

    if (amountMode === "custom") {
      const parsed = Number(customAmount);

      if (!Number.isFinite(parsed) || parsed < resolvedMinimumAmount) {
        setError(
          `❌ El monto debe ser igual o mayor a ${formatMoney(
            resolvedMinimumAmount,
            resolvedNormalized.currency
          )}.`
        );
        return;
      }

      finalAmount = parsed;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      onDonateIntent?.({
        mode: resolvedNormalized.mode,
        amount: finalAmount,
        currency: resolvedNormalized.currency,
      });

      setSuccess(
        `✅ Donación preparada por ${formatMoney(
          finalAmount,
          resolvedNormalized.currency
        )}. El pago real se conectará en el siguiente paso.`
      );
    } catch (e: any) {
      setError(e?.message ?? "❌ No se pudo preparar la donación.");
    } finally {
      setSubmitting(false);
    }
  }

  const overlayStyle: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    width: "100vw",
    height: "100dvh",
    background: "rgba(0,0,0,0.72)",
    zIndex: 2147483647,
    display: "grid",
    placeItems: "center",
    padding: 16,
    boxSizing: "border-box",
  };

  const modalStyle: React.CSSProperties = {
    width: "min(520px, 94vw)",
    maxHeight: "88dvh",
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(12,12,12,0.98)",
    color: "#fff",
    boxShadow: "0 18px 48px rgba(0,0,0,0.55)",
    overflow: "auto",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif',
  };

  const sectionStyle: React.CSSProperties = {
    padding: 16,
    display: "grid",
    gap: 12,
  };

  const titleStyle: React.CSSProperties = {
    fontSize: 17,
    fontWeight: 700,
    lineHeight: 1.2,
  };

  const textStyle: React.CSSProperties = {
    fontSize: 13,
    color: "rgba(255,255,255,0.82)",
    lineHeight: 1.45,
  };

  const buttonBaseStyle: React.CSSProperties = {
    minHeight: 42,
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
  };

  const primaryButtonStyle: React.CSSProperties = {
    ...buttonBaseStyle,
    background: "#fff",
    color: "#000",
    border: "1px solid rgba(255,255,255,0.92)",
  };

  const fieldStyle: React.CSSProperties = {
    width: "100%",
    minHeight: 42,
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.05)",
    color: "#fff",
    outline: "none",
    boxSizing: "border-box",
    fontSize: 13,
  };

  const infoBoxStyle: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.04)",
    fontSize: 12,
    lineHeight: 1.45,
    color: "rgba(255,255,255,0.88)",
  };

  const previewBoxStyle: React.CSSProperties = {
    width: "100%",
    aspectRatio: "16 / 9",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.04)",
    overflow: "hidden",
    display: "grid",
    placeItems: "center",
  };

  const modal = (
    <div style={overlayStyle} onClick={closePanel}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            padding: "14px 16px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            borderBottom: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <div style={titleStyle}>{buttonLabel}</div>

          <button
            type="button"
            onClick={closePanel}
            disabled={submitting}
            style={buttonBaseStyle}
          >
            Cerrar
          </button>
        </div>

        <div style={sectionStyle}>
          <div style={previewBoxStyle}>
            {videoEnabled && videoUrl ? (
              <video
                src={videoUrl}
                controls
                playsInline
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  background: "#000",
                }}
              />
            ) : (
              <div
                style={{
                  padding: 20,
                  textAlign: "center",
                  color: "rgba(255,255,255,0.72)",
                  fontSize: 13,
                  lineHeight: 1.45,
                }}
              >
                Aquí irá el video del creador en el siguiente paso.
              </div>
            )}
          </div>

          <div style={infoBoxStyle}>
            {resolvedNormalized.mode === "wedding"
              ? resolvedNormalized.goalLabel || "Apoyo para boda"
              : "Apoya directamente a este creador o institución."}
          </div>

          <div style={textStyle}>
            Elige tu aporte. El monto mínimo configurado es{" "}
            <strong style={{ color: "#fff" }}>
              {formatMoney(resolvedMinimumAmount, resolvedNormalized.currency)}
            </strong>
            .
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => setAmountMode("minimum")}
              style={{
                ...buttonBaseStyle,
                border:
                  amountMode === "minimum"
                    ? "1px solid rgba(255,255,255,0.92)"
                    : "1px solid rgba(255,255,255,0.18)",
              }}
            >
              Donar mínimo{" "}
              {formatMoney(resolvedMinimumAmount, resolvedNormalized.currency)}
            </button>

            <button
              type="button"
              onClick={() => setAmountMode("custom")}
              style={{
                ...buttonBaseStyle,
                border:
                  amountMode === "custom"
                    ? "1px solid rgba(255,255,255,0.92)"
                    : "1px solid rgba(255,255,255,0.18)",
              }}
            >
              Donar otro monto
            </button>
          </div>

          {amountMode === "custom" && (
            <input
              type="number"
              min={resolvedMinimumAmount}
              step="0.01"
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value)}
              placeholder="Escribe tu monto"
              disabled={submitting}
              style={fieldStyle}
            />
          )}

          {error ? <div style={infoBoxStyle}>{error}</div> : null}
          {success ? <div style={infoBoxStyle}>{success}</div> : null}

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={handleDonate}
              disabled={submitting}
              style={{
                ...primaryButtonStyle,
                opacity: submitting ? 0.75 : 1,
                cursor: submitting ? "not-allowed" : "pointer",
              }}
            >
              {submitting ? "Procesando..." : "Donar"}
            </button>

            <button
              type="button"
              onClick={closePanel}
              disabled={submitting}
              style={{
                ...buttonBaseStyle,
                opacity: submitting ? 0.75 : 1,
                cursor: submitting ? "not-allowed" : "pointer",
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        disabled={!viewerCanDonate}
        title={
          viewerCanDonate
            ? buttonLabel
            : "No puedes apoyar tu propia comunidad"
        }
        aria-label={buttonLabel}
        style={{
          width: 74,
          color: "#fff",
          textDecoration: "none",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 6,
          textAlign: "center",
          border: "none",
          background: "transparent",
          padding: 0,
          margin: 0,
          cursor: viewerCanDonate ? "pointer" : "default",
          opacity: 1,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif',
          ...buttonStyle,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 52,
            height: 52,
            borderRadius: 999,
            display: "grid",
            placeItems: "center",
            background: "#000",
            border: `2.5px solid ${buttonAccent}`,
            fontSize: 23,
            lineHeight: 1,
            boxShadow: `0 8px 24px rgba(0,0,0,0.32), 0 0 18px ${buttonAccent}33`,
          }}
        >
          {buttonEmoji}
        </span>

        <span
          style={{
            maxWidth: "100%",
            fontSize: 11,
            fontWeight: 700,
            lineHeight: 1.12,
            color: "rgba(255,255,255,0.92)",
            textWrap: "balance",
          }}
        >
          {buttonLabel}
        </span>
      </button>

      {open && mounted ? createPortal(modal, document.body) : null}
    </>
  );
}