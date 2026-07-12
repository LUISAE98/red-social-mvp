"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { WalletCard, WalletFilterMenu } from "./WalletUi";
import WalletSubscriptions from "./WalletSubscriptions";
import WalletActiveSubscribers from "./WalletActiveSubscribers";
import WalletMovementsChart, { type ChartBucket } from "./WalletMovementsChart";
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

const FILTERS: Filter[] = ["all", "withdrawal", "subscription"];

// Paginación: 50 por página; se precargan los siguientes 50 al acercarse
// a 20 filas del final de la lista visible (≈ fila 30 de 50).
const PAGE_SIZE = 50;
const PREFETCH_OFFSET = 20;

// "2026-06" → "Junio 2026" (localizado, nivel módulo por la regla de pureza).
function monthLabelOf(ym: string, locale: string): string {
  const [y, m] = ym.split("-").map(Number);
  try {
    const s = new Intl.DateTimeFormat(locale, {
      month: "long",
      year: "numeric",
    }).format(new Date(y, m - 1, 1));
    return s.charAt(0).toUpperCase() + s.slice(1);
  } catch {
    return ym;
  }
}
function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
// "2026-07" → "jul 26" (etiqueta corta para el eje de la gráfica).
function monthShort(ym: string, locale: string): string {
  const [y, m] = ym.split("-").map(Number);
  try {
    const s = new Intl.DateTimeFormat(locale, { month: "short" })
      .format(new Date(y, m - 1, 1))
      .replace(".", "");
    return `${s} ${String(y).slice(2)}`;
  } catch {
    return ym;
  }
}

export default function WalletTransactions({
  uid,
  mode,
}: {
  uid: string | null | undefined;
  mode: "net" | "gross";
}) {
  const tWallet = useTranslations("wallet");
  const locale = useLocale();
  const [filter, setFilter] = useState<Filter>("all");
  // Filtro por estado dentro de "Todos" (multi-selección, mismo menú que Pendientes/Historial).
  const [statusFilter, setStatusFilter] = useState<Array<"all" | LedgerStatus>>(["all"]);
  // Filtro por mes dentro de "Todos".
  const [monthFilter, setMonthFilter] = useState<string[]>(["all"]);
  const [limitCount, setLimitCount] = useState(PAGE_SIZE);
  const { entries, loading } = useWalletLedger(uid, limitCount);

  // Meses disponibles (desde el primer registro cargado).
  const MONTH_OPTIONS = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) {
      const d = e.occurredAt ?? e.createdAt;
      if (d) set.add(monthKey(d));
    }
    const months = [...set].sort().reverse(); // más reciente primero
    return [
      { value: "all", label: tWallet("filterMonthAllValue"), emoji: "📅" },
      ...months.map((ym) => ({ value: ym, label: monthLabelOf(ym, locale) })),
    ];
  }, [entries, locale, tWallet]);

  const monthSelLabel = monthFilter.includes("all")
    ? tWallet("filterMonthAllValue")
    : monthFilter.map((ym) => monthLabelOf(ym, locale)).join(", ");

  const STATUS_OPTIONS: Array<{
    value: "all" | LedgerStatus;
    label: string;
    emoji?: string;
    color?: string;
  }> = [
    { value: "all", label: tWallet("filterAll"), emoji: "📋" },
    { value: "earned", label: tWallet("txStatusEarned"), emoji: "✅" },
    { value: "pending", label: tWallet("txStatusPending"), emoji: "⏳" },
    { value: "refunded", label: tWallet("txStatusRefunded"), emoji: "💸" },
    { value: "rejected", label: tWallet("txStatusRejected"), emoji: "❌", color: "#f87171" },
  ];

  const visible = useMemo(() => {
    // Retiros: aún no se registran en el libro mayor. Suscriptores: panel aparte.
    if (filter === "withdrawal" || filter === "subscription") return [];
    let list = entries;
    // Filtro por estado (multi-selección).
    if (!statusFilter.includes("all")) {
      list = list.filter((e) => statusFilter.includes(e.status));
    }
    // Filtro por mes.
    if (!monthFilter.includes("all")) {
      list = list.filter((e) => {
        const d = e.occurredAt ?? e.createdAt;
        return d ? monthFilter.includes(monthKey(d)) : false;
      });
    }
    return list;
  }, [entries, filter, statusFilter, monthFilter]);

  // Meses a graficar: los seleccionados (o todos los disponibles), en orden.
  const chartMonths = useMemo(() => {
    const present = new Set<string>();
    for (const e of entries) {
      const d = e.occurredAt ?? e.createdAt;
      if (d) present.add(monthKey(d));
    }
    const all = [...present].sort();
    return monthFilter.includes("all") ? all : monthFilter.filter((m) => present.has(m)).sort();
  }, [entries, monthFilter]);

  // Tramos de la gráfica: 1 mes → 4 semanas; varios meses → un punto por mes.
  const chartBuckets = useMemo<ChartBucket[]>(() => {
    if (chartMonths.length === 1) {
      const [y, m] = chartMonths[0].split("-").map(Number);
      const ranges: Array<[number, number]> = [
        [1, 7],
        [8, 14],
        [15, 21],
        [22, 31],
      ];
      return ranges.map(([a, b], i) => ({
        key: `w${i}`,
        label: tWallet("weekShort", { n: i + 1 }),
        test: (d: Date) =>
          d.getFullYear() === y &&
          d.getMonth() === m - 1 &&
          d.getDate() >= a &&
          d.getDate() <= b,
      }));
    }
    return chartMonths.map((ym) => {
      const [y, m] = ym.split("-").map(Number);
      return {
        key: ym,
        label: monthShort(ym, locale),
        test: (d: Date) => d.getFullYear() === y && d.getMonth() === m - 1,
      };
    });
  }, [chartMonths, locale, tWallet]);

  // Resumen (Ganado · Rechazado · Reembolsado) del mes filtrado.
  const summary = useMemo(() => {
    const scoped = monthFilter.includes("all")
      ? entries
      : entries.filter((e) => {
          const d = e.occurredAt ?? e.createdAt;
          return d ? monthFilter.includes(monthKey(d)) : false;
        });
    let earned = 0;
    let rejected = 0;
    let refunded = 0;
    for (const e of scoped) {
      const amt = mode === "gross" ? e.grossAmount : e.netAmount;
      if (e.status === "earned") earned += amt;
      else if (e.status === "rejected") rejected += amt;
      else if (e.status === "refunded") refunded += amt;
    }
    return { earned, rejected, refunded };
  }, [entries, monthFilter, mode]);

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
    <WalletCard transparent>
      {/* Título centrado, separado del panel de arriba. */}
      <span
        style={{
          display: "block",
          textAlign: "center",
          fontSize: 18,
          fontWeight: 600,
          color: "#fff",
          letterSpacing: "-0.02em",
          marginTop: 10,
          marginBottom: 20,
        }}
      >
        {tWallet("txTitle")}
      </span>

      {/* Pestañas: Todos · Retiros · Suscriptores */}
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

      {/* Filtros — dentro de "Todos", debajo de las pestañas: mes (izq) · estado (der). */}
      {filter === "all" ? (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
            marginBottom: 6,
            minWidth: 0,
          }}
        >
          {/* Mes (izq): se encoge y trunca con "…" si no cabe. */}
          <div style={{ minWidth: 0, flexShrink: 1, overflow: "hidden" }}>
            <WalletFilterMenu
              label={monthSelLabel}
              menuLabel={tWallet("filterMonthMenu")}
              value={monthFilter}
              options={MONTH_OPTIONS}
              onChange={setMonthFilter}
              allValue="all"
              transparent
            />
          </div>
          {/* Estado (der): tamaño fijo. */}
          <div style={{ flexShrink: 0 }}>
            <WalletFilterMenu
              label={tWallet("filterLabel")}
              menuLabel={tWallet("filterMovementsMenu")}
              value={statusFilter}
              options={STATUS_OPTIONS}
              onChange={setStatusFilter}
              allValue="all"
              transparent
            />
          </div>
        </div>
      ) : null}

      {/* Gráfica: 1 mes → semanas; varios meses → comparación por mes. */}
      {filter === "all" && chartBuckets.length >= 1 ? (
        <WalletMovementsChart entries={entries} mode={mode} buckets={chartBuckets} />
      ) : null}

      {/* Resumen del mes filtrado: Ganado · Rechazado · Reembolsado. */}
      {filter === "all" ? (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 10,
            marginBottom: 16,
          }}
        >
          {[
            { key: "txStatusRefunded", amount: summary.refunded },
            { key: "txStatusEarned", amount: summary.earned },
            { key: "txStatusRejected", amount: summary.rejected },
          ].map((col) => (
            <div
              key={col.key}
              style={{
                flex: 1,
                minWidth: 0,
                textAlign: "center",
                display: "flex",
                flexDirection: "column",
                gap: 3,
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
                {tWallet(col.key)}
              </span>
              <span
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  color: "#fff",
                }}
              >
                {formatMoney(col.amount)}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {/* Pestaña Suscriptores: panel de suscripciones + lista de activos. */}
      {filter === "subscription" ? (
        <div style={{ marginTop: 22 }}>
          <WalletSubscriptions uid={uid} bare />
          <WalletActiveSubscribers uid={uid} />
        </div>
      ) : loading ? (
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
