"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import { intlLocale } from "@/i18n/locales";
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
import { SETTLEMENT_CURRENCY } from "@/lib/currency/catalog";
import { useBalanceHidden, toggleBalanceHidden } from "@/lib/wallet/useBalanceHidden";
import MaskedAmount from "@/app/components/MaskedAmount";
import WalletFigureSkeleton from "../components/WalletFigureSkeleton";
import CurrencySwitcher from "@/app/components/CurrencySwitcher";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import WithdrawFiscalPanel from "../components/WithdrawFiscalPanel";



function formatMonthLabel(year: number, month: number, locale: string): string {
  try {
    return new Intl.DateTimeFormat(intlLocale(locale), {
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
  const tNav = useTranslations("nav");
  const locale = useLocale();
  const { format: formatMoney } = usePriceFormat();
  // Ocultar saldo: mismo estado compartido y persistente que el rail derecho.
  const balanceHidden = useBalanceHidden();
  const { user } = useAuth();
  const { summary, loading: summaryLoading } = useWalletFinances(user?.uid);
  const [mode, setMode] = useState<"net" | "gross">("net");
  const [withdrawPanelOpen, setWithdrawPanelOpen] = useState(false);
  const { toast: walletToast, showToast: showWalletToast } = useVibraToast();



  // Último día del mes en curso (fecha de disponibilidad del retiro).
  const withdrawDate = useMemo(() => {
    const now = new Date();
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { day: last.getDate(), month: formatMonthName(last, locale) };
  }, [locale]);

  const view = selectFinanceView(summary, mode);

  // Skeleton de las cifras variables mientras cargan. Incluye `!user?.uid` para
  // cubrir también la ventana en la que el auth aún no resuelve el usuario.
  const loadingAmounts = summaryLoading || !user?.uid;

  // Botón Retirar: habilitado siempre que haya saldo. (Se quitó el candado de fin
  // de mes; más adelante se ofrecerán retiros QUINCENALES, no mensuales.)
  const canWithdrawNow = view.available > 0;

  function handleWithdrawClick() {
    if (!canWithdrawNow) return;
    setWithdrawPanelOpen(true);
  }

  // La opción de registrar KYC solo aparece cuando ya hay saldo por retirar
  // (al menos una compra). Si el creador ya inició el flujo, mostramos su estado.

  // Mejor mes: mes calendario con más ganancias (entradas "earned").
  const { entries, loading: ledgerLoading } = useWalletLedger(user?.uid, 365);
  const loadingBestMonth = ledgerLoading || !user?.uid;
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
                ? "linear-gradient(135deg, #4f46ff, #a855f7)"
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
      <WalletCard transparent>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 22,
            paddingTop: 4,
          }}
        >
          {/* Controles: switch neto/bruto (izq) + moneda (centro) + Retirar (der).
              La moneda va centrada (flex:1 a los lados) y se mantiene en medio
              aunque el botón Retirar no esté presente. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <div style={{ flex: 1, minWidth: 0, display: "flex", justifyContent: "flex-start" }}>
              {toggle}
            </div>

            {/* Moneda actual en blanco: recuerda en qué moneda ves las cantidades
                y abre el panel de monedas al hacer clic. */}
            <CurrencySwitcher color="#fff" scale={1.3} />

            <div style={{ flex: 1, minWidth: 0, display: "flex", justifyContent: "flex-end" }}>
              {/* 🚧 BOTÓN DE RETIRO OCULTO A PROPÓSITO.
                  Antes se mostraba solo con `kyc.approved` (Didit). Al eliminar Didit el
                  2026-08-13 nadie queda aprobado, y **quitar el proveedor del gate no debe
                  quitar el gate**: abrir el retiro a cualquiera sería un retroceso de
                  seguridad, no una limpieza. Vuelve a mostrarse cuando el alta de cuenta
                  Stripe (que trae su propio KYC) esté conectada y podamos preguntarle. */}
            </div>
          </div>

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
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 12,
              }}
            >
              <div
                style={{
                  fontSize: 40,
                  fontWeight: 700,
                  letterSpacing: "-0.03em",
                  lineHeight: 1.05,
                  color: "#4ade80",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {loadingAmounts ? (
                  <WalletFigureSkeleton width={170} height={32} />
                ) : balanceHidden ? (
                  <MaskedAmount formatted={formatMoney(view.available, { code: true, baseCurrency: summary.currency ?? "MXN" })} />
                ) : (
                  formatMoney(view.available, { code: true, baseCurrency: summary.currency ?? "MXN" })
                )}
              </div>
              <button
                type="button"
                onClick={toggleBalanceHidden}
                aria-label={balanceHidden ? tNav("showAmount") : tNav("hideAmount")}
                aria-pressed={balanceHidden}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "rgba(255,255,255,0.55)",
                  cursor: "pointer",
                  padding: 6,
                  borderRadius: 8,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  lineHeight: 0,
                }}
              >
                {balanceHidden ? (
                  <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* Alta de cuenta Stripe: habilita los retiros del creador.
              🚧 SIN CONECTAR — el onClick está vacío a propósito. Didit se eliminó por
              completo el 2026-08-13 y su reemplazo (el alta de cuenta Stripe, que trae
              su propio KYC) todavía no existe. Hasta que exista, esto es solo el sitio
              donde va a vivir, con el mismo estilo que tenía el CTA de KYC. */}
          <button
            type="button"
            onClick={() => { /* TODO: iniciar el alta de cuenta Stripe del creador. */ }}
            style={{
              width: "100%",
              marginTop: -14,
              padding: 0,
              border: "none",
              background: "transparent",
              color: "#c084fc",
              fontFamily: "inherit",
              fontSize: 12.5,
              fontWeight: 600,
              lineHeight: 1.35,
              letterSpacing: "-0.01em",
              textAlign: "center",
              cursor: "pointer",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            {tWallet("stripeAccountCta")}
          </button>

          <VibraToast toast={walletToast} />

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
                  fontWeight: 640,
                  letterSpacing: "-0.02em",
                  color: "rgba(255,255,255,0.9)",
                }}
              >
                {loadingAmounts ? (
                  <WalletFigureSkeleton width={66} height={17} />
                ) : balanceHidden ? (
                  <MaskedAmount formatted={formatMoney(view.pending, { baseCurrency: summary.currency ?? "MXN" })} />
                ) : (
                  formatMoney(view.pending, { baseCurrency: summary.currency ?? "MXN" })
                )}
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
                  fontWeight: 640,
                  letterSpacing: "-0.02em",
                  color: "rgba(255,255,255,0.9)",
                }}
              >
                {loadingBestMonth ? (
                  <WalletFigureSkeleton width={66} height={17} />
                ) : balanceHidden ? (
                  <MaskedAmount formatted={formatMoney(bestMonth?.amount ?? 0, { baseCurrency: SETTLEMENT_CURRENCY })} />
                ) : (
                  formatMoney(bestMonth?.amount ?? 0, { baseCurrency: SETTLEMENT_CURRENCY })
                )}
              </div>
              {loadingBestMonth ? (
                <div style={{ textAlign: "center" }}>
                  <WalletFigureSkeleton width={44} height={9} />
                </div>
              ) : bestMonth ? (
                <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.4)" }}>
                  {formatMonthLabel(bestMonth.year, bestMonth.month, locale)}
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
                  fontWeight: 640,
                  letterSpacing: "-0.02em",
                  color: "rgba(255,255,255,0.9)",
                }}
              >
                {loadingAmounts ? (
                  <WalletFigureSkeleton width={66} height={17} />
                ) : balanceHidden ? (
                  <MaskedAmount formatted={formatMoney(view.lifetime, { baseCurrency: summary.currency ?? "MXN" })} />
                ) : (
                  formatMoney(view.lifetime, { baseCurrency: summary.currency ?? "MXN" })
                )}
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
                  {formatMoney(view.refunded, { code: true, baseCurrency: summary.currency ?? "MXN" })}
                </strong>
              </span>
            </div>
          ) : null}

          {/* 🧾 IVA cobrado (transparencia): NO es del creador, Vibra lo entera al SAT.
              Solo aparece si hubo ventas con impuesto (hoy solo compradores en México). */}
          {summary.taxCollected > 0 ? (
            <div
              title={tWallet("financesTaxCollectedHint")}
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
                {tWallet("financesTaxCollected")}:{" "}
                <strong style={{ color: "rgba(255,255,255,0.7)", fontWeight: 600 }}>
                  {formatMoney(summary.taxCollected, { code: true, baseCurrency: summary.currency ?? "MXN" })}
                </strong>
              </span>
            </div>
          ) : null}
        </div>
      </WalletCard>

      <WalletTransactions uid={user?.uid} mode={mode} />

      {/* Panel fiscal del retiro (creador mexicano). 🔁 El creador EXTRANJERO pasará
          directo a pago sin este panel cuando se determine su país fiscal. */}
      <WithdrawFiscalPanel
        open={withdrawPanelOpen}
        onClose={() => setWithdrawPanelOpen(false)}
        uid={user?.uid}
        availableLabel={formatMoney(view.available, { code: true, baseCurrency: summary.currency ?? "MXN" })}
        // IVA 16% (creador mexicano). Las retenciones se agregarán cuando se defina
        // el modelo fiscal con la API de pagos elegida.
        ivaLabel={formatMoney(view.available * 0.16, { code: true, baseCurrency: summary.currency ?? "MXN" })}
        totalLabel={formatMoney(view.available * 1.16, { code: true, baseCurrency: summary.currency ?? "MXN" })}
      />
    </WalletSectionShell>
  );
}
