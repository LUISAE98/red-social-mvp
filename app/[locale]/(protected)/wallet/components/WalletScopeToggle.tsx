"use client";

import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";

export type StatScope = "all" | "30d";

/**
 * Switch segmentado Histórico / Últimos 30 días, compartido por las tarjetas de
 * estadísticas (mismo estilo que el switch neto/bruto).
 */
export default function WalletScopeToggle({
  value,
  onChange,
  style,
}: {
  value: StatScope;
  onChange: (next: StatScope) => void;
  style?: CSSProperties;
}) {
  const tWallet = useTranslations("wallet");
  return (
    <div style={{ display: "flex", justifyContent: "center", ...style }}>
      <div
        role="tablist"
        style={{
          display: "inline-flex",
          padding: 3,
          borderRadius: 11,
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.08)",
          gap: 2,
        }}
      >
        {(["all", "30d"] as const).map((key) => {
          const active = value === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(key)}
              style={{
                border: "none",
                cursor: "pointer",
                borderRadius: 8,
                padding: "6px 14px",
                fontSize: 12.5,
                fontWeight: 600,
                letterSpacing: "-0.01em",
                whiteSpace: "nowrap",
                color: active ? "#fff" : "rgba(255,255,255,0.6)",
                background: active
                  ? "linear-gradient(135deg, #4f46ff, #a855f7)"
                  : "transparent",
                transition: "color 150ms ease, background 150ms ease",
              }}
            >
              {key === "all"
                ? tWallet("breakdownScopeAll")
                : tWallet("breakdownScope30d")}
            </button>
          );
        })}
      </div>
    </div>
  );
}
