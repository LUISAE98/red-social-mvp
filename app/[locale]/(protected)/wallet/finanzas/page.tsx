"use client";

import { useMemo, useState, useEffect, useRef } from "react";
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
import { useBalanceHidden, toggleBalanceHidden } from "@/lib/wallet/useBalanceHidden";
import MaskedAmount from "@/app/components/MaskedAmount";
import CurrencySwitcher from "@/app/components/CurrencySwitcher";
import { useKyc } from "@/lib/kyc/useKyc";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import VibraToast from "@/app/components/VibraToast/VibraToast";

// Mapeo de códigos de motivo (risk) de Didit → clave de traducción amigable.
const KYC_REASON_KEY: Record<string, string> = {
  POSSIBLE_DUPLICATED_USER: "kycReasonDuplicate",
  DUPLICATED_USER: "kycReasonDuplicate",
  DUPLICATED_FACE: "kycReasonDuplicate",
  DOCUMENT_EXPIRED: "kycReasonDocExpired",
  EXPIRED_DOCUMENT: "kycReasonDocExpired",
  DOCUMENT_TYPE_NOT_ALLOWED: "kycReasonDocUnsupported",
  DOCUMENT_NOT_SUPPORTED: "kycReasonDocUnsupported",
  UNSUPPORTED_DOCUMENT: "kycReasonDocUnsupported",
  FACE_NOT_MATCHING: "kycReasonFaceMismatch",
  FACE_MISMATCH: "kycReasonFaceMismatch",
  LIVENESS_FAILED: "kycReasonLiveness",
  NOT_LIVE: "kycReasonLiveness",
  SPOOFING_DETECTED: "kycReasonLiveness",
  DOCUMENT_MANIPULATED: "kycReasonManipulated",
  TAMPERED_DOCUMENT: "kycReasonManipulated",
  FRAUD: "kycReasonManipulated",
  UNDERAGE: "kycReasonUnderage",
  AGE_NOT_MET: "kycReasonUnderage",
  BAD_QUALITY: "kycReasonQuality",
  LOW_QUALITY: "kycReasonQuality",
  UNREADABLE_DOCUMENT: "kycReasonQuality",
};

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
  const tNav = useTranslations("nav");
  const locale = useLocale();
  const { format: formatMoney } = usePriceFormat();
  // Ocultar saldo: mismo estado compartido y persistente que el rail derecho.
  const balanceHidden = useBalanceHidden();
  const { user } = useAuth();
  const { summary } = useWalletFinances(user?.uid);
  const kyc = useKyc(user?.uid);
  const [mode, setMode] = useState<"net" | "gross">("net");
  const { toast: walletToast, showToast: showWalletToast } = useVibraToast();

  // ── CTA de KYC: solo mientras la identidad NO está verificada ──────────────
  // "in_review" = Didit revisando manualmente (bloqueado). "pending" = sesión
  // creada pero sin terminar → clicable para continuar/reiniciar el flujo.
  const kycReasonText = tWallet(
    (kyc.reason && KYC_REASON_KEY[kyc.reason]) || "kycReasonGeneric"
  );
  const kycCtaLabel =
    kyc.status === "in_review"
      ? tWallet("kycPending")
      : kyc.status === "pending"
      ? tWallet("kycContinue")
      : kyc.status === "declined"
      ? tWallet("kycRejectedReason", { reason: kycReasonText })
      : tWallet("kycWithdrawCta");
  const kycCtaDisabled = kyc.status === "in_review" || kyc.starting || kyc.loading;

  async function handleKycClick() {
    if (kycCtaDisabled) return;
    try {
      await kyc.startKyc(locale);
    } catch {
      showWalletToast(tWallet("kycStartError"), "error");
    }
  }

  // ── Celebración "Identidad verificada": 10 s, una sola vez tras verificar ──
  const [kycCelebrate, setKycCelebrate] = useState(false);
  const [kycCelebrateExiting, setKycCelebrateExiting] = useState(false);
  const celebratedRef = useRef(false);
  const cameFromDiditRef = useRef(false);

  // Detecta el retorno desde el flujo de Didit y limpia los params de la URL.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.has("verificationSessionId") || params.has("status")) {
      cameFromDiditRef.current = true;
      params.delete("verificationSessionId");
      params.delete("status");
      const qs = params.toString();
      window.history.replaceState(
        null,
        "",
        window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash
      );
    }
  }, []);

  // Celebra UNA sola vez, y SOLO si el usuario acaba de volver del flujo de Didit
  // (no en visitas normales a finanzas ya estando verificado).
  useEffect(() => {
    if (kyc.loading || celebratedRef.current) return;
    if (cameFromDiditRef.current && kyc.approved) {
      celebratedRef.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reacción a la aprobación async de Firestore
      setKycCelebrate(true);
    }
  }, [kyc.approved, kyc.loading]);

  // Temporizador: visible 10 s, con salida animada al final.
  useEffect(() => {
    if (!kycCelebrate) return;
    const exit = setTimeout(() => setKycCelebrateExiting(true), 9500);
    const hide = setTimeout(() => setKycCelebrate(false), 10000);
    return () => {
      clearTimeout(exit);
      clearTimeout(hide);
    };
  }, [kycCelebrate]);

  // Último día del mes en curso (fecha de disponibilidad del retiro).
  const withdrawDate = useMemo(() => {
    const now = new Date();
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { day: last.getDate(), month: formatMonthName(last, locale) };
  }, [locale]);

  const view = selectFinanceView(summary, mode);

  // Botón Retirar: se habilita al llegar la fecha de disponibilidad (último día
  // del mes, igual que la etiqueta "Disponible el…"). El flujo de retiro real es
  // un ticket aparte; por ahora el botón solo refleja el estado.
  const canWithdrawNow = useMemo(() => {
    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return now.getDate() >= lastDay && view.available > 0;
  }, [view.available]);

  function handleWithdrawClick() {
    if (!canWithdrawNow) return;
    showWalletToast(tWallet("withdrawComingSoon"), "warning");
  }

  // La opción de registrar KYC solo aparece cuando ya hay saldo por retirar
  // (al menos una compra). Si el creador ya inició el flujo, mostramos su estado.
  const showKycCta = view.available > 0 || kyc.status !== "not_started";

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
              {kyc.approved ? (
                <button
                  type="button"
                  onClick={handleWithdrawClick}
                  disabled={!canWithdrawNow}
                  style={{
                    border: "none",
                    borderRadius: 10,
                    padding: "7px 16px",
                    fontSize: 12.5,
                    fontWeight: 700,
                    letterSpacing: "-0.01em",
                    whiteSpace: "nowrap",
                    color: canWithdrawNow ? "#052e16" : "rgba(255,255,255,0.4)",
                    background: canWithdrawNow
                      ? "linear-gradient(135deg, #4ade80, #16a34a)"
                      : "rgba(255,255,255,0.06)",
                    cursor: canWithdrawNow ? "pointer" : "not-allowed",
                    transition: "background 150ms ease, color 150ms ease",
                  }}
                >
                  {tWallet("withdrawButton")}
                </button>
              ) : null}
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
                {balanceHidden ? (
                  <MaskedAmount formatted={formatMoney(view.available, { code: true })} />
                ) : (
                  formatMoney(view.available, { code: true })
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

          {/* KYC: CTA mientras no está verificado; celebración al verificar. */}
          {kyc.approved ? (
            kycCelebrate ? (
              <>
                <style jsx global>{`
                  @keyframes vbKycBadgeIn {
                    0%   { opacity: 0; transform: translateY(4px) scale(0.9); }
                    60%  { opacity: 1; transform: translateY(0) scale(1.04); }
                    100% { opacity: 1; transform: translateY(0) scale(1); }
                  }
                  @keyframes vbKycBadgeOut {
                    from { opacity: 1; transform: translateY(0) scale(1); }
                    to   { opacity: 0; transform: translateY(-4px) scale(0.96); }
                  }
                  @keyframes vbKycCirclePop {
                    0%   { transform: scale(0.4); }
                    65%  { transform: scale(1.25); }
                    100% { transform: scale(1); }
                  }
                `}</style>
                <div
                  style={{
                    marginTop: -14,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    animation: kycCelebrateExiting
                      ? "vbKycBadgeOut 0.5s ease forwards"
                      : "vbKycBadgeIn 0.45s cubic-bezier(0.34,1.56,0.64,1) forwards",
                  }}
                >
                  <span
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      background: "#22c55e",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      animation:
                        "vbKycCirclePop 0.4s cubic-bezier(0.34,1.56,0.64,1) forwards",
                    }}
                  >
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                      <path
                        d="M2 6L5 9L10 3"
                        stroke="#fff"
                        strokeWidth="1.9"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <span
                    style={{
                      color: "#4ade80",
                      fontSize: 12.5,
                      fontWeight: 600,
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {tWallet("kycApproved")}
                  </span>
                </div>
              </>
            ) : null
          ) : showKycCta ? (
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
                color: kyc.status === "declined" ? "#f87171" : "#c084fc",
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
          ) : null}

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
                {balanceHidden ? (
                  <MaskedAmount formatted={formatMoney(view.pending)} />
                ) : (
                  formatMoney(view.pending)
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
                {balanceHidden ? (
                  <MaskedAmount formatted={formatMoney(bestMonth?.amount ?? 0)} />
                ) : (
                  formatMoney(bestMonth?.amount ?? 0)
                )}
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
                  fontWeight: 640,
                  letterSpacing: "-0.02em",
                  color: "rgba(255,255,255,0.9)",
                }}
              >
                {balanceHidden ? (
                  <MaskedAmount formatted={formatMoney(view.lifetime)} />
                ) : (
                  formatMoney(view.lifetime)
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
                  {formatMoney(view.refunded, { code: true })}
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
                  {formatMoney(summary.taxCollected, { code: true })}
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
