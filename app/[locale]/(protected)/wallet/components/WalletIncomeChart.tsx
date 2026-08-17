"use client";

import { useMemo, useState } from "react";
import { intlLocale } from "@/i18n/locales";
import { TextButton } from "@/components/ui";
import { useTranslations, useLocale } from "next-intl";
import {
  useWalletLedger,
  ledgerTypeLabelKey,
  type LedgerServiceType,
} from "@/lib/wallet/walletLedger";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import { SETTLEMENT_CURRENCY } from "@/lib/currency/catalog";

/** Monto compacto para el eje (ej. $1.2k, $850). */
function formatCompact(value: number): string {
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  }
  return `$${Math.round(value)}`;
}

/** Etiqueta de fecha "d MMM" (ej. "9 jul"). */
function dayMonthLabel(d: Date, locale: string): string {
  try {
    return new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "short" })
      .format(d)
      .replace(".", "");
  } catch {
    return "";
  }
}

// Orden canónico de los 11 servicios para el ciclo al tocar.
const SERVICE_ORDER: LedgerServiceType[] = [
  "supercomment",
  "greeting",
  "advice",
  "live_donation",
  "live_ticket",
  "premium_post",
  "vod_ticket",
  "exclusive_session",
  "live_session",
  "subscription",
  "profile_donation",
];

const DAY = 86400000;

// Rangos seleccionables: días hacia atrás + tamaño de cada tramo.
type RangeKey = "5d" | "30d" | "3m" | "6m" | "1y";
const RANGES: Record<RangeKey, { lookbackDays: number; bucketDays: number; labelKey: string }> = {
  "5d": { lookbackDays: 5, bucketDays: 1, labelKey: "chartRange5d" },
  "30d": { lookbackDays: 30, bucketDays: 5, labelKey: "chartRange30d" },
  "3m": { lookbackDays: 90, bucketDays: 15, labelKey: "chartRange3m" },
  "6m": { lookbackDays: 180, bucketDays: 30, labelKey: "chartRange6m" },
  "1y": { lookbackDays: 365, bucketDays: 30, labelKey: "chartRange1y" },
};
const RANGE_KEYS: RangeKey[] = ["5d", "30d", "3m", "6m", "1y"];

export default function WalletIncomeChart({
  uid,
}: {
  uid: string | null | undefined;
}) {
  const locale = useLocale();
  const tWallet = useTranslations("wallet");
  const { format: formatMoney } = usePriceFormat();
  const { entries } = useWalletLedger(uid, 1000);
  const [viewIndex, setViewIndex] = useState(0);
  const [range, setRange] = useState<RangeKey>("30d");
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  // Servicios con ingresos (para el ciclo), en orden canónico.
  const servicesWithIncome = useMemo(() => {
    const set = new Set<LedgerServiceType>();
    for (const e of entries) if (e.status === "earned") set.add(e.type);
    return SERVICE_ORDER.filter((t) => set.has(t));
  }, [entries]);

  const views: (LedgerServiceType | "all")[] = ["all", ...servicesWithIncome];
  const currentView = views[viewIndex % views.length] ?? "all";

  // Buckets según el rango elegido (de now-lookback a now).
  const buckets = useMemo(() => {
    const cfg = RANGES[range];
    const now = new Date().getTime();
    const list: { start: Date; end: Date; key: string; label: string }[] = [];
    let s = now - cfg.lookbackDays * DAY;
    let i = 0;
    while (s < now && i < 60) {
      const start = new Date(s);
      const end = new Date(s + cfg.bucketDays * DAY);
      list.push({ start, end, key: `b${i}`, label: dayMonthLabel(start, locale) });
      s += cfg.bucketDays * DAY;
      i += 1;
    }
    return list;
    // `locale` va en dependencias porque las etiquetas de los buckets se formatean con
    // él: sin esto, al cambiar de idioma la gráfica conservaría los meses del anterior.
  }, [range, locale]);

  // Ingresos (neto) por bucket para la vista actual.
  const data = useMemo(() => {
    return buckets.map((b) => {
      let amount = 0;
      for (const e of entries) {
        if (e.status !== "earned") continue;
        if (currentView !== "all" && e.type !== currentView) continue;
        const date = e.occurredAt ?? e.createdAt;
        if (!date) continue;
        const t = date.getTime();
        if (t >= b.start.getTime() && t < b.end.getTime()) amount += e.netAmount;
      }
      return { key: b.key, label: b.label, amount };
    });
  }, [entries, currentView, buckets]);

  const total = data.reduce((s, d) => s + d.amount, 0);
  const max = Math.max(...data.map((d) => d.amount), 1);

  // Geometría de la línea.
  const W = 320;
  const H = 125;
  const padTop = 12;
  const padBottom = 8;
  const usableH = H - padTop - padBottom;
  const n = data.length;
  const xAt = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * W);
  const yAt = (amount: number) => padTop + (1 - amount / max) * usableH;
  const linePoints = data
    .map((d, i) => `${xAt(i).toFixed(1)},${yAt(d.amount).toFixed(1)}`)
    .join(" ");
  const areaPath =
    `M ${xAt(0).toFixed(1)},${yAt(data[0]?.amount ?? 0).toFixed(1)} ` +
    data
      .slice(1)
      .map((d, i) => `L ${xAt(i + 1).toFixed(1)},${yAt(d.amount).toFixed(1)}`)
      .join(" ") +
    ` L ${xAt(n - 1).toFixed(1)},${H} L ${xAt(0).toFixed(1)},${H} Z`;

  const viewLabel =
    currentView === "all"
      ? tWallet("chartAllServices")
      : tWallet(ledgerTypeLabelKey(currentView));

  const cycle = () => setViewIndex((i) => (i + 1) % views.length);

  const pointAt = (clientX: number, rect: DOMRect) => {
    if (rect.width === 0 || n === 0) return;
    const rel = (clientX - rect.left) / rect.width;
    const idx = Math.max(0, Math.min(n - 1, Math.round(rel * (n - 1))));
    setHoverIdx(idx);
  };

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    pointAt(e.clientX, e.currentTarget.getBoundingClientRect());
  };

  const handleTouch = (e: React.TouchEvent<HTMLDivElement>) => {
    const touch = e.touches[0];
    if (!touch) return;
    pointAt(touch.clientX, e.currentTarget.getBoundingClientRect());
  };

  const hovered = hoverIdx != null ? data[hoverIdx] : null;

  const rangeButtons = RANGE_KEYS.map((r) => {
    const active = range === r;
    return (
      <TextButton
        key={r}
        tone={active ? "plain" : "mute"}
        size="sm"
        onClick={() => setRange(r)}
      >
        {tWallet(RANGES[r].labelKey)}
      </TextButton>
    );
  });

  return (
    <div style={{ padding: "2px 0", userSelect: "none" }}>
      <style jsx>{`
        .rangeRow {
          flex-wrap: wrap;
          gap: 12px;
        }
        .rangeDesktop {
          display: flex;
          justify-content: flex-end;
        }
        .rangeMobile {
          display: none;
          justify-content: center;
          margin-top: 12px;
        }
        @media (max-width: 640px) {
          .rangeDesktop {
            display: none;
          }
          .rangeMobile {
            display: flex;
          }
        }
      `}</style>
      {/* Encabezado */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 12,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.55)" }}>
            {viewLabel}
          </span>
          <span
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: "#fff",
              letterSpacing: "-0.02em",
            }}
          >
            {formatMoney(total, { baseCurrency: SETTLEMENT_CURRENCY })}
          </span>
        </div>

        {/* Rangos: en laptop aquí (arriba-derecha); en celular van abajo */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5 }}>
          <div className="rangeRow rangeDesktop">{rangeButtons}</div>
          {views.length > 1 ? (
            <button
              type="button"
              onClick={cycle}
              style={{
                border: "none",
                background: "transparent",
                padding: 0,
                cursor: "pointer",
                fontSize: 10.5,
                fontWeight: 600,
                color: "rgba(59,130,246,0.95)",
                textAlign: "end",
              }}
            >
              {tWallet("chartTapHint")}
            </button>
          ) : null}
        </div>
      </div>

      {/* Gráfico con eje de dinero a la izquierda */}
      <div style={{ display: "flex", gap: 8 }}>
        {/* Eje Y: dinero de referencia (el tope es el máximo de la categoría) */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            height: H,
            paddingTop: padTop,
            paddingBottom: padBottom,
            boxSizing: "border-box",
            textAlign: "end",
            fontSize: 9.5,
            fontWeight: 500,
            color: "rgba(255,255,255,0.38)",
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          <span>{formatCompact(max)}</span>
          <span>{formatCompact(max / 2)}</span>
          <span>$0</span>
        </div>

        {/* Columna del gráfico + etiquetas de tiempo */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              position: "relative",
              height: H,
              cursor: "default",
              touchAction: "pan-y",
            }}
            onMouseMove={handleMove}
            onMouseLeave={() => setHoverIdx(null)}
            onTouchStart={handleTouch}
            onTouchMove={handleTouch}
          >
            <svg
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="none"
              width="100%"
              height={H}
              style={{ display: "block", overflow: "visible" }}
            >
              <defs>
                <linearGradient id="walletIncomeArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.28" />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={areaPath} fill="url(#walletIncomeArea)" />
              <polyline
                points={linePoints}
                fill="none"
                stroke="#3b82f6"
                strokeWidth={2.5}
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </svg>

            {/* Hover: línea guía + punto + tooltip */}
            {hovered && hoverIdx != null ? (
              <>
                <div
                  style={{
                    position: "absolute",
                    insetInlineStart: `${(xAt(hoverIdx) / W) * 100}%`,
                    top: 0,
                    bottom: 0,
                    width: 1,
                    background: "rgba(255,255,255,0.15)",
                    pointerEvents: "none",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    insetInlineStart: `${(xAt(hoverIdx) / W) * 100}%`,
                    top: `${(yAt(hovered.amount) / H) * 100}%`,
                    transform: "translate(-50%, -50%)",
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "#60a5fa",
                    border: "2px solid #0a071c",
                    pointerEvents: "none",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    insetInlineStart: `${(xAt(hoverIdx) / W) * 100}%`,
                    top: `${(yAt(hovered.amount) / H) * 100}%`,
                    transform: "translate(-50%, calc(-100% - 12px))",
                    background: "rgba(20,14,40,0.96)",
                    border: "1px solid rgba(59,130,246,0.35)",
                    borderRadius: 8,
                    padding: "5px 9px",
                    whiteSpace: "nowrap",
                    pointerEvents: "none",
                    textAlign: "center",
                    zIndex: 2,
                  }}
                >
                  <div style={{ fontSize: 9.5, color: "rgba(255,255,255,0.5)", textTransform: "capitalize" }}>
                    {hovered.label}
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: "#fff" }}>
                    {formatMoney(hovered.amount, { baseCurrency: SETTLEMENT_CURRENCY })}
                  </div>
                </div>
              </>
            ) : null}
          </div>

          {/* Etiquetas de tiempo */}
          <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
            {data.map((d) => (
              <span
                key={d.key}
                style={{
                  flex: 1,
                  minWidth: 0,
                  textAlign: "center",
                  fontSize: 9.5,
                  color: "rgba(255,255,255,0.4)",
                  textTransform: "capitalize",
                  overflow: "hidden",
                  whiteSpace: "nowrap",
                }}
              >
                {d.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Rangos en celular: abajo del gráfico */}
      <div className="rangeRow rangeMobile">{rangeButtons}</div>
    </div>
  );
}
