"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/app/providers";
import WalletSectionShell from "../components/WalletSectionShell";
import { WalletCard } from "../components/WalletUi";
import WalletTransactions from "../components/WalletTransactions";
import {
  useWalletFinances,
  selectFinanceView,
} from "@/lib/wallet/walletFinances";

function formatMoney(value: number): string {
  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: "MXN",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `$${value.toFixed(2)} MXN`;
  }
}

export default function WalletFinanzasPage() {
  const tWallet = useTranslations("wallet");
  const { user } = useAuth();
  const { summary } = useWalletFinances(user?.uid);
  const [mode, setMode] = useState<"net" | "gross">("net");

  const view = selectFinanceView(summary, mode);
  const hasPending = view.pending > 0;
  const hasLosses = view.refunded > 0 || view.rejected > 0;

  const toggle = (
    <div
      role="tablist"
      aria-label={tWallet("financesAmountMode")}
      style={{
        display: "inline-flex",
        padding: 3,
        borderRadius: 999,
        background: "rgba(255,255,255,0.06)",
        border: "1px solid rgba(255,255,255,0.08)",
        gap: 2,
      }}
    >
      {(["net", "gross"] as const).map((key) => {
        const active = mode === key;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => setMode(key)}
            style={{
              border: "none",
              cursor: "pointer",
              borderRadius: 999,
              padding: "6px 14px",
              fontSize: 12.5,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              color: active ? "#fff" : "rgba(255,255,255,0.6)",
              background: active
                ? "linear-gradient(135deg, #4f46ff, #a855ff)"
                : "transparent",
              transition: "color 150ms ease, background 150ms ease",
            }}
          >
            {key === "net" ? tWallet("financesNet") : tWallet("financesGross")}
          </button>
        );
      })}
    </div>
  );

  return (
    <WalletSectionShell activeTab="finances">
      <WalletCard title={tWallet("financesTitle")} headerRight={toggle}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 22,
            paddingTop: 4,
          }}
        >
          {/* Disponible para retirar */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div
              style={{
                fontSize: 12.5,
                fontWeight: 500,
                color: "rgba(255,255,255,0.6)",
                letterSpacing: "-0.01em",
              }}
            >
              {tWallet("financesAvailable")}
            </div>
            <div
              style={{
                fontSize: 40,
                fontWeight: 700,
                letterSpacing: "-0.03em",
                lineHeight: 1.05,
                color: "#fff",
              }}
            >
              {formatMoney(view.available)}
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "rgba(255,255,255,0.5)",
                  marginLeft: 8,
                  letterSpacing: 0,
                }}
              >
                MXN
              </span>
            </div>
          </div>

          {/* Ganado histórico */}
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <div
              style={{
                fontSize: 12.5,
                fontWeight: 500,
                color: "rgba(255,255,255,0.6)",
                letterSpacing: "-0.01em",
              }}
            >
              {tWallet("financesLifetime")}
            </div>
            <div
              style={{
                fontSize: 20,
                fontWeight: 600,
                letterSpacing: "-0.02em",
                color: "rgba(255,255,255,0.9)",
              }}
            >
              {formatMoney(view.lifetime)} MXN
            </div>
          </div>

          {/* Por liberar (solo si hay pendientes) */}
          {hasPending ? (
            <div
              style={{
                display: "flex",
                gap: 10,
                alignItems: "flex-start",
                padding: "12px 14px",
                borderRadius: 12,
                border: "1px solid rgba(168,85,255,0.28)",
                background:
                  "linear-gradient(160deg, rgba(79,70,255,0.14), rgba(168,85,255,0.12))",
              }}
            >
              <span aria-hidden="true" style={{ fontSize: 16, lineHeight: 1.3 }}>
                💡
              </span>
              <div
                style={{
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: "rgba(255,255,255,0.86)",
                  fontWeight: 400,
                }}
              >
                {tWallet("financesPendingRelease", {
                  amount: `${formatMoney(view.pending)} MXN`,
                })}
              </div>
            </div>
          ) : null}

          {/* Devuelto / perdido (solo si hay) */}
          {hasLosses ? (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "4px 18px",
                fontSize: 12,
                color: "rgba(255,255,255,0.52)",
                paddingTop: 2,
              }}
            >
              {view.refunded > 0 ? (
                <span>
                  {tWallet("financesRefunded")}:{" "}
                  <strong style={{ color: "rgba(255,255,255,0.7)", fontWeight: 600 }}>
                    {formatMoney(view.refunded)} MXN
                  </strong>
                </span>
              ) : null}
              {view.rejected > 0 ? (
                <span>
                  {tWallet("financesRejectedLost")}:{" "}
                  <strong style={{ color: "rgba(255,255,255,0.7)", fontWeight: 600 }}>
                    {formatMoney(view.rejected)} MXN
                  </strong>
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </WalletCard>

      <WalletTransactions uid={user?.uid} mode={mode} />
    </WalletSectionShell>
  );
}
