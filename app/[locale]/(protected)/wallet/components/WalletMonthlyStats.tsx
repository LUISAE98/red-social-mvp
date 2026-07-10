"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useWalletFinances } from "@/lib/wallet/walletFinances";
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

/**
 * Fila de 3 cifras (Rechazado · Ganado · Reembolsado). Al dar clic en cualquiera
 * alterna entre "este mes" e "histórico". Montos en neto.
 */
export default function WalletMonthlyStats({
  uid,
}: {
  uid: string | null | undefined;
}) {
  const tWallet = useTranslations("wallet");
  const { summary } = useWalletFinances(uid);
  const { entries } = useWalletLedger(uid, 365);
  const [scope, setScope] = useState<"month" | "all">("month");

  const month = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    let earned = 0;
    let rejected = 0;
    let refunded = 0;
    for (const e of entries) {
      if (!e.createdAt) continue;
      if (e.createdAt.getFullYear() !== y || e.createdAt.getMonth() !== m) continue;
      if (e.status === "earned") earned += e.netAmount;
      else if (e.status === "rejected") rejected += e.netAmount;
      else if (e.status === "refunded") refunded += e.netAmount;
    }
    return { earned, rejected, refunded };
  }, [entries]);

  const values =
    scope === "month"
      ? month
      : {
          earned: summary.lifetimeEarnedNet,
          rejected: summary.rejectedNet,
          refunded: summary.refundedNet,
        };

  const scopeLabel = tWallet(
    scope === "month" ? "statScopeMonth" : "statScopeAll"
  );

  const toggle = () => setScope((s) => (s === "month" ? "all" : "month"));

  const columns = [
    { key: "statRejected", amount: values.rejected, color: "#f87171" },
    { key: "statEarned", amount: values.earned, color: "#4ade80" },
    { key: "statRefunded", amount: values.refunded, color: "#fbbf24" },
  ];

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: 10,
        marginTop: 14,
        marginBottom: 2,
      }}
    >
      {columns.map((col) => (
        <button
          key={col.key}
          type="button"
          onClick={toggle}
          title={tWallet("statToggleHint")}
          style={{
            flex: 1,
            minWidth: 0,
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            gap: 3,
            border: "none",
            background: "transparent",
            cursor: "pointer",
            padding: "2px 0",
          }}
        >
          <span
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: "rgba(255,255,255,0.6)",
              letterSpacing: "-0.01em",
            }}
          >
            {tWallet(col.key, { scope: scopeLabel })}
          </span>
          <span
            style={{
              fontSize: 17,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              color: col.color,
            }}
          >
            {formatMoney(col.amount)}
          </span>
        </button>
      ))}
    </div>
  );
}
