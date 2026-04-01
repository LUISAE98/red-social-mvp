"use client";

import React from "react";

type DonationMode = "none" | "general" | "wedding";
type Currency = "MXN" | "USD";

type DonationInput = {
  mode: DonationMode;
  enabled?: boolean;
  visible?: boolean;
  currency?: Currency | null;
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
    donation!.suggestedAmounts!.length > 0 &&
    Number(donation!.suggestedAmounts![0]) > 0
      ? Number(donation!.suggestedAmounts![0])
      : null;

  const shouldRender =
    enabled &&
    visible &&
    (mode === "general" || mode === "wedding") &&
    minimumAmount != null;

  if (!shouldRender) return null;

  const label = mode === "wedding" ? "Donación para boda" : "Donación";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      style={{
        padding: "7px 10px",
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.18)",
        background: "rgba(0,0,0,0.92)",
        color: "#fff",
        fontWeight: 600,
        fontSize: 12,
        lineHeight: 1.2,
        cursor: disabled ? "not-allowed" : "pointer",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif',
        backdropFilter: "blur(10px)",
        boxShadow: "0 18px 48px rgba(0,0,0,0.55)",
        opacity: disabled ? 0.7 : 1,
        ...style,
      }}
    >
      {label}
    </button>
  );
}