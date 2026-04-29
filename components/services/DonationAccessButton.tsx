"use client";

import React from "react";

type DonationMode = "none" | "general" | "wedding";
type Currency = "MXN" | "USD";

type DonationInput = {
  mode: DonationMode;
  enabled?: boolean;
  visible?: boolean;
  currency?: Currency | null;
  sourceScope?: "group" | "profile";
  suggestedAmounts?: number[] | null;
  goalLabel?: string | null;
} | null;

type Props = {
  donation: DonationInput;
  onClick: () => void;
  disabled?: boolean;
  style?: React.CSSProperties;
};

export default function DonationAccessButton({
  donation,
  onClick,
  disabled = false,
  style,
}: Props) {
  const mode = donation?.mode ?? "none";
  const visible = donation?.visible !== false;
  const enabled = donation?.enabled === true;

  const minimumAmount =
    Array.isArray(donation?.suggestedAmounts) &&
    donation.suggestedAmounts.length > 0 &&
    Number(donation.suggestedAmounts[0]) > 0
      ? Number(donation.suggestedAmounts[0])
      : null;

  const shouldRender =
    enabled &&
    visible &&
    (mode === "general" || mode === "wedding") &&
    minimumAmount != null;

  if (!shouldRender) return null;

  const label = mode === "wedding" ? "Apoyar boda" : "Apoyar";
  const icon = mode === "wedding" ? "💍" : "💗";
  const accent = mode === "wedding" ? "#C084FC" : "#FB7185";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      style={{
        width: 74,
        minHeight: 86,
        padding: "8px 7px",
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.16)",
        background: "rgba(0,0,0,0.82)",
        color: "#fff",
        cursor: disabled ? "not-allowed" : "pointer",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif',
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        boxShadow: "0 16px 42px rgba(0,0,0,0.45)",
        opacity: disabled ? 0.7 : 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        textAlign: "center",
        boxSizing: "border-box",
        ...style,
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
          border: `2.5px solid ${accent}`,
          fontSize: 23,
          lineHeight: 1,
          boxShadow: `0 8px 24px rgba(0,0,0,0.32), 0 0 18px ${accent}33`,
          boxSizing: "border-box",
        }}
      >
        {icon}
      </span>

      <span
        style={{
          maxWidth: "100%",
          fontSize: 11,
          fontWeight: 700,
          lineHeight: 1.12,
          color: "rgba(255,255,255,0.92)",
          textAlign: "center",
          textWrap: "balance",
        }}
      >
        {label}
      </span>
    </button>
  );
}