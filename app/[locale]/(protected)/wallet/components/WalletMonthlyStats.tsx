"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useWalletFinances } from "@/lib/wallet/walletFinances";
import { useWalletLedger } from "@/lib/wallet/walletLedger";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import { SETTLEMENT_CURRENCY } from "@/lib/currency/catalog";
import WalletFigureSkeleton from "./WalletFigureSkeleton";

/**
 * Fila de 2 cifras (Ganado · Rechazado). Al dar clic en cualquiera
 * alterna entre "este mes" e "histórico". Montos en neto.
 */
export default function WalletMonthlyStats({
  uid,
}: {
  uid: string | null | undefined;
}) {
  const tWallet = useTranslations("wallet");
  const pf = usePriceFormat();
  /**
   * Dinero del CREADOR: en la moneda de liquidación, SIN convertir.
   *
   * ⚠️ `pf.format` es el precio del COMPRADOR —convierte, suma el 2% y redondea al
   * escalón—, así que inflaba el saldo del creador: sobre 500 USD, 170 pesos de más.
   */
  const formatMoney = (amount: number, opts: { code?: boolean } = {}) =>
    pf.formatAnchor(amount, { code: opts.code ?? false });
  const { summary, loading: summaryLoading } = useWalletFinances(uid);
  const { entries, loading: ledgerLoading } = useWalletLedger(uid, 365);
  const [scope, setScope] = useState<"month" | "all">("month");
  const loading = !uid || summaryLoading || ledgerLoading;

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
    { key: "statEarned", amount: values.earned, color: "#ffffff" },
    { key: "statRejected", amount: values.rejected, color: "#ffffff" },
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
            {loading ? (
              <WalletFigureSkeleton width={72} height={16} />
            ) : (
              formatMoney(col.amount)
            )}
          </span>
        </button>
      ))}
    </div>
  );
}
