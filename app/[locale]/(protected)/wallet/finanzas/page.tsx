"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/app/providers";
import WalletSectionShell from "../components/WalletSectionShell";
import { WalletCard } from "../components/WalletUi";
import WalletTransactions from "../components/WalletTransactions";
import {
  useWalletFinances,
  selectFinanceView,
} from "@/lib/wallet/walletFinances";
import { useWalletLedger } from "@/lib/wallet/walletLedger";

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

function formatMonthLabel(year: number, month: number): string {
  try {
    return new Intl.DateTimeFormat("es-MX", {
      month: "short",
      year: "numeric",
    }).format(new Date(year, month, 1));
  } catch {
    return "";
  }
}

export default function WalletFinanzasPage() {
  const tWallet = useTranslations("wallet");
  const { user } = useAuth();
  const { summary } = useWalletFinances(user?.uid);
  const [mode, setMode] = useState<"net" | "gross">("net");

  const view = selectFinanceView(summary, mode);

  // Mejor mes: mes calendario con más ganancias (entradas "earned").
  const { entries } = useWalletLedger(user?.uid, 365);
  const bestMonth = useMemo(() => {
    const byMonth = new Map<string, { year: number; month: number; amount: number }>();
    for (const e of entries) {
      if (e.status !== "earned" || !e.createdAt) continue;
      const year = e.createdAt.getFullYear();
      const month = e.createdAt.getMonth();
      const key = `${year}-${month}`;
      const amount = mode === "gross" ? e.grossAmount : e.netAmount;
      const current = byMonth.get(key) ?? { year, month, amount: 0 };
      current.amount += amount;
      byMonth.set(key, current);
    }
    let best: { year: number; month: number; amount: number } | null = null;
    for (const v of byMonth.values()) {
      if (!best || v.amount > best.amount) best = v;
    }
    return best;
  }, [entries, mode]);

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
      <WalletCard headerRight={toggle} transparent>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 22,
            paddingTop: 4,
          }}
        >
          {/* Disponible para retirar */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              alignItems: "center",
              textAlign: "center",
            }}
          >
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
                color: "#4ade80",
              }}
            >
              {formatMoney(view.available)}
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "rgba(74,222,128,0.6)",
                  marginLeft: 8,
                  letterSpacing: 0,
                }}
              >
                MXN
              </span>
            </div>
          </div>

          {/* Fila de 3 columnas: por liberar · mejor mes · ganado histórico */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 10,
            }}
          >
            {/* Monto por liberar (izquierda) */}
            <div
              style={{
                flex: 1,
                minWidth: 0,
                textAlign: "center",
                display: "flex",
                flexDirection: "column",
                gap: 3,
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: "rgba(255,255,255,0.6)",
                  letterSpacing: "-0.01em",
                }}
              >
                {tWallet("financesPendingAmount")}
              </div>
              <div
                style={{
                  fontSize: 17,
                  fontWeight: 600,
                  letterSpacing: "-0.02em",
                  color: "rgba(255,255,255,0.9)",
                }}
              >
                {formatMoney(view.pending)}
              </div>
            </div>

            {/* Mejor mes (centro) */}
            <div
              style={{
                flex: 1,
                minWidth: 0,
                textAlign: "center",
                display: "flex",
                flexDirection: "column",
                gap: 3,
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: "rgba(255,255,255,0.6)",
                  letterSpacing: "-0.01em",
                }}
              >
                {tWallet("financesBestMonth")}
              </div>
              <div
                style={{
                  fontSize: 17,
                  fontWeight: 600,
                  letterSpacing: "-0.02em",
                  color: "rgba(255,255,255,0.9)",
                }}
              >
                {formatMoney(bestMonth?.amount ?? 0)}
              </div>
              {bestMonth ? (
                <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.4)" }}>
                  {formatMonthLabel(bestMonth.year, bestMonth.month)}
                </div>
              ) : null}
            </div>

            {/* Ganado histórico (derecha) */}
            <div
              style={{
                flex: 1,
                minWidth: 0,
                textAlign: "center",
                display: "flex",
                flexDirection: "column",
                gap: 3,
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: "rgba(255,255,255,0.6)",
                  letterSpacing: "-0.01em",
                }}
              >
                {tWallet("financesLifetime")}
              </div>
              <div
                style={{
                  fontSize: 17,
                  fontWeight: 600,
                  letterSpacing: "-0.02em",
                  color: "rgba(255,255,255,0.9)",
                }}
              >
                {formatMoney(view.lifetime)}
              </div>
            </div>
          </div>

          {/* Devuelto (solo si hay) */}
          {view.refunded > 0 ? (
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
              <span>
                {tWallet("financesRefunded")}:{" "}
                <strong style={{ color: "rgba(255,255,255,0.7)", fontWeight: 600 }}>
                  {formatMoney(view.refunded)} MXN
                </strong>
              </span>
            </div>
          ) : null}
        </div>
      </WalletCard>

      <WalletTransactions uid={user?.uid} mode={mode} />
    </WalletSectionShell>
  );
}
