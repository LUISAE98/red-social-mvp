"use client";

import { useMemo, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useAuth } from "@/app/providers";
import WalletSectionShell from "../components/WalletSectionShell";
import { WalletCard } from "../components/WalletUi";
import WalletTransactions from "../components/WalletTransactions";
import {
  useWalletFinances,
  selectFinanceView,
} from "@/lib/wallet/walletFinances";
import { useWalletLedger } from "@/lib/wallet/walletLedger";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import { useKyc } from "@/lib/kyc/useKyc";

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

function formatMonthName(date: Date, locale: string): string {
  try {
    const name = new Intl.DateTimeFormat(locale, { month: "long" }).format(date);
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return "";
  }
}

export default function WalletFinanzasPage() {
  const tWallet = useTranslations("wallet");
  const locale = useLocale();
  const { format: formatMoney } = usePriceFormat();
  const { user } = useAuth();
  const { summary } = useWalletFinances(user?.uid);
  const kyc = useKyc(user?.uid);
  const [mode, setMode] = useState<"net" | "gross">("net");

  // Etiqueta y acción del CTA de KYC según el estado de verificación.
  const kycInProgress = kyc.status === "pending" || kyc.status === "in_review";
  const kycCtaLabel = kyc.approved
    ? tWallet("kycApproved")
    : kycInProgress
    ? tWallet("kycPending")
    : kyc.status === "declined"
    ? tWallet("kycRetry")
    : tWallet("kycWithdrawCta");
  const kycCtaDisabled = kyc.approved || kycInProgress || kyc.starting || kyc.loading;

  function handleKycClick() {
    if (kycCtaDisabled) return;
    void kyc.startKyc(locale);
  }

  // Último día del mes en curso (fecha de disponibilidad del retiro).
  const withdrawDate = useMemo(() => {
    const now = new Date();
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { day: last.getDate(), month: formatMonthName(last, locale) };
  }, [locale]);

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
        borderRadius: 11,
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
              borderRadius: 8,
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
              {tWallet("financesAvailableOn", {
                day: withdrawDate.day,
                month: withdrawDate.month,
              })}
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
              {formatMoney(view.available, { code: true })}
            </div>
          </div>

          {/* CTA de KYC: justo debajo de la cifra, ocupando todo el renglón. */}
          <button
            type="button"
            onClick={handleKycClick}
            disabled={kycCtaDisabled}
            style={{
              width: "100%",
              marginTop: -14,
              padding: 0,
              border: "none",
              background: "transparent",
              color: kyc.approved
                ? "#4ade80"
                : kyc.status === "declined"
                ? "#f87171"
                : "#c084fc",
              fontFamily: "inherit",
              fontSize: 12.5,
              fontWeight: 600,
              lineHeight: 1.35,
              letterSpacing: "-0.01em",
              textAlign: "center",
              cursor: kycCtaDisabled ? "default" : "pointer",
              opacity: kyc.starting ? 0.6 : 1,
              WebkitTapHighlightColor: "transparent",
            }}
          >
            {kycCtaLabel}
          </button>

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

          {/* Aviso de comisión según el modo (neto ya descontado / bruto sin descontar). */}
          <div
            style={{
              fontSize: 11.5,
              lineHeight: 1.45,
              color: "rgba(255,255,255,0.42)",
              textAlign: "center",
              marginTop: -12,
            }}
          >
            {mode === "net"
              ? tWallet("financesCommissionNet")
              : tWallet("financesCommissionGross")}
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
                  {formatMoney(view.refunded, { code: true })}
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
