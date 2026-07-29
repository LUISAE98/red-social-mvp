"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { useWalletLedger } from "@/lib/wallet/walletLedger";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";

function formatMonthLabel(year: number, month: number): string {
  try {
    return new Intl.DateTimeFormat("es-MX", { month: "short", year: "numeric" })
      .format(new Date(year, month, 1))
      .replace(".", "");
  } catch {
    return "";
  }
}

/**
 * Meta motivacional: cuánto llevas este mes y cuánto falta para superar tu
 * mejor mes histórico. Enfoque siempre positivo (objetivo, no castigo).
 */
export default function WalletMonthComparison({
  uid,
}: {
  uid: string | null | undefined;
}) {
  const tWallet = useTranslations("wallet");
  const { format: formatMoney } = usePriceFormat();
  const { entries } = useWalletLedger(uid, 1000);

  const { current, best } = useMemo(() => {
    const now = new Date();
    const curKey = `${now.getFullYear()}-${now.getMonth()}`;
    const byMonth = new Map<string, { year: number; month: number; amount: number }>();
    for (const e of entries) {
      if (e.status !== "earned") continue;
      const date = e.occurredAt ?? e.createdAt;
      if (!date) continue;
      const year = date.getFullYear();
      const month = date.getMonth();
      const key = `${year}-${month}`;
      const prev = byMonth.get(key) ?? { year, month, amount: 0 };
      prev.amount += e.netAmount;
      byMonth.set(key, prev);
    }
    const current = byMonth.get(curKey)?.amount ?? 0;
    // Mejor mes histórico, excluyendo el mes en curso (es el récord a batir).
    let best: { year: number; month: number; amount: number } | null = null;
    for (const [key, v] of byMonth) {
      if (key === curKey) continue;
      if (!best || v.amount > best.amount) best = v;
    }
    return { current, best };
  }, [entries]);

  const target = best?.amount ?? 0;
  const beaten = target > 0 && current >= target;
  const remaining = Math.max(0, target - current);
  const pct = target > 0 ? Math.min(100, (current / target) * 100) : current > 0 ? 100 : 0;
  const bestLabel = best ? formatMonthLabel(best.year, best.month) : "";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        gap: 8,
        width: "100%",
        maxWidth: 300,
        padding: "8px 4px",
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
        {tWallet("goalThisMonth")}
      </span>

      <span style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1, color: "#fff" }}>
        {formatMoney(current)}
      </span>

      {target > 0 ? (
        <div
          style={{
            width: 170,
            maxWidth: "80%",
            height: 8,
            borderRadius: 999,
            background: "rgba(255,255,255,0.08)",
            overflow: "hidden",
            marginTop: 2,
          }}
        >
          <div
            style={{
              width: `${pct}%`,
              height: "100%",
              borderRadius: 999,
              background: beaten
                ? "linear-gradient(90deg, #4ade80, #22c55e)"
                : "linear-gradient(90deg, #a855f7, #4f46ff)",
              transition: "width 400ms ease",
            }}
          />
        </div>
      ) : null}

      {target <= 0 ? (
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "rgba(255,255,255,0.7)" }}>
          {tWallet("goalFirst")}
        </span>
      ) : beaten ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#4ade80" }}>
            {tWallet("goalRecordBeaten")} 🎉
          </span>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
            {tWallet("goalPrevRecord", { amount: formatMoney(target) })}
          </span>
        </div>
      ) : (
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "rgba(255,255,255,0.75)", lineHeight: 1.4 }}>
          {tWallet("goalRemaining", { amount: formatMoney(remaining), best: formatMoney(target) })}
          <br />
          <span style={{ fontSize: 10.5, fontWeight: 500, color: "rgba(255,255,255,0.4)" }}>
            {tWallet("goalBestMonth", { month: bestLabel })}
          </span>
        </span>
      )}
    </div>
  );
}
