"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { WalletCard } from "./WalletUi";
import {
  useWalletLedger,
  ledgerTypeLabelKey,
  ledgerStatusLabelKey,
  ledgerStatusColor,
  type LedgerStatus,
} from "@/lib/wallet/walletLedger";

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

function formatDate(date: Date | null): string {
  if (!date) return "";
  try {
    return new Intl.DateTimeFormat("es-MX", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(date);
  } catch {
    return "";
  }
}

type Filter = "all" | LedgerStatus | "withdrawal" | "subscription";

const FILTERS: Filter[] = [
  "all",
  "earned",
  "pending",
  "refunded",
  "rejected",
  "withdrawal",
  "subscription",
];

// Paginación: 50 por página; se precargan los siguientes 50 al acercarse
// a 20 filas del final de la lista visible (≈ fila 30 de 50).
const PAGE_SIZE = 50;
const PREFETCH_OFFSET = 20;

export default function WalletTransactions({
  uid,
  mode,
}: {
  uid: string | null | undefined;
  mode: "net" | "gross";
}) {
  const tWallet = useTranslations("wallet");
  const [filter, setFilter] = useState<Filter>("all");
  const [limitCount, setLimitCount] = useState(PAGE_SIZE);
  const { entries, loading } = useWalletLedger(uid, limitCount);

  const visible = useMemo(() => {
    if (filter === "all") return entries;
    // Los retiros aún no se registran en el libro mayor (pestaña vacía por ahora).
    if (filter === "withdrawal") return [];
    // Suscriptores: ingresos por suscripción a comunidad (filtra por tipo).
    if (filter === "subscription") return entries.filter((e) => e.type === "subscription");
    return entries.filter((e) => e.status === filter);
  }, [entries, filter]);

  // Puede haber más en el servidor si la ventana llegó a su tope.
  const hasMore = filter !== "withdrawal" && entries.length >= limitCount;

  const loadMore = useCallback(() => {
    setLimitCount((c) => c + PAGE_SIZE);
  }, []);

  const selectFilter = (f: Filter) => {
    setFilter(f);
    setLimitCount(PAGE_SIZE);
  };

  // Observa la fila-gatillo (20 antes del final) para precargar la próxima página.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (obs) => {
        if (obs.some((o) => o.isIntersecting)) loadMore();
      },
      { rootMargin: "300px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadMore, visible.length]);

  const triggerIndex = Math.max(0, visible.length - PREFETCH_OFFSET);

  const filterLabel = (f: Filter) =>
    f === "all"
      ? tWallet("txFilterAll")
      : f === "withdrawal"
        ? tWallet("txFilterWithdrawals")
        : f === "subscription"
          ? tWallet("txFilterSubscribers")
          : tWallet(ledgerStatusLabelKey(f));

  return (
    <WalletCard title={tWallet("txTitle")} transparent>
      {/* Filtros por estado */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          marginBottom: 14,
        }}
      >
        {FILTERS.map((f) => {
          const active = filter === f;
          return (
            <button
              key={f}
              type="button"
              onClick={() => selectFilter(f)}
              style={{
                border: "1px solid rgba(255,255,255,0.1)",
                cursor: "pointer",
                borderRadius: 999,
                padding: "5px 12px",
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: "-0.01em",
                color: active ? "#fff" : "rgba(255,255,255,0.6)",
                background: active
                  ? "linear-gradient(135deg, #4f46ff, #a855ff)"
                  : "rgba(255,255,255,0.04)",
                borderColor: active ? "transparent" : "rgba(255,255,255,0.1)",
                transition: "color 150ms ease, background 150ms ease",
              }}
            >
              {filterLabel(f)}
            </button>
          );
        })}
      </div>

      {/* Lista */}
      {loading ? (
        <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 13, padding: "8px 0" }}>
          {tWallet("txLoading")}
        </div>
      ) : visible.length === 0 ? (
        <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 13, padding: "8px 0" }}>
          {tWallet("txEmpty")}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {visible.map((entry, index) => {
            const amount = mode === "gross" ? entry.grossAmount : entry.netAmount;
            const negative = entry.status === "refunded" || entry.status === "rejected";
            return (
              <div
                key={entry.id}
                ref={index === triggerIndex ? sentinelRef : undefined}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "11px 0",
                  borderTop: index === 0 ? "none" : "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                  <span
                    style={{
                      fontSize: 13.5,
                      fontWeight: 600,
                      color: "#fff",
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {tWallet(ledgerTypeLabelKey(entry.type))}
                  </span>
                  <span style={{ fontSize: 11.5, color: "rgba(255,255,255,0.45)" }}>
                    {formatDate(entry.createdAt)}
                  </span>
                </div>

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-end",
                    gap: 3,
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: 700,
                      letterSpacing: "-0.02em",
                      color: negative ? "rgba(255,255,255,0.4)" : "#fff",
                      textDecoration: negative ? "line-through" : "none",
                    }}
                  >
                    {formatMoney(amount)}
                  </span>
                  <span
                    style={{
                      fontSize: 10.5,
                      fontWeight: 600,
                      color: ledgerStatusColor(entry.status),
                    }}
                  >
                    {tWallet(ledgerStatusLabelKey(entry.status))}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </WalletCard>
  );
}
