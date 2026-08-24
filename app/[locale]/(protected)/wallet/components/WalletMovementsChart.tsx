"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { TextButton } from "@/components/ui";
import type { LedgerEntry, LedgerStatus } from "@/lib/wallet/walletLedger";
import { useWalletMoney } from "@/lib/wallet/useWalletMoney";

// Un tramo del eje X: una semana o un mes, con su etiqueta y su predicado de fecha.
export type ChartBucket = { key: string; label: string; test: (d: Date) => boolean };

const METRICS: LedgerStatus[] = ["earned", "refunded", "rejected", "pending"];
const METRIC_KEY: Record<LedgerStatus, string> = {
  earned: "txStatusEarned",
  refunded: "txStatusRefunded",
  rejected: "txStatusRejected",
  pending: "txStatusPending",
};
const METRIC_COLOR: Record<LedgerStatus, string> = {
  earned: "#4ade80",
  refunded: "#fbbf24",
  rejected: "#f87171",
  pending: "#c084fc",
};

function fmtCompact(v: number): string {
  if (v >= 1000) return `$${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`;
  return `$${Math.round(v)}`;
}

/**
 * Gráfica lineal sobre los tramos dados (semanas de un mes, o varios meses).
 * La métrica graficada cicla (Ganado → Reembolsado → Rechazado → Por liberar).
 */
export default function WalletMovementsChart({
  entries,
  mode,
  buckets,
}: {
  entries: LedgerEntry[];
  mode: "net" | "gross";
  buckets: ChartBucket[];
}) {
  const tWallet = useTranslations("wallet");
  // ⚠️ Antes `pf.format`, el precio del COMPRADOR: inflaba las barras y el total frente
  // a lo que de verdad se liquida. Ahora la lectura común de la wallet.
  const { formatMoney: fmtMoney } = useWalletMoney();
  const [metricIdx, setMetricIdx] = useState(0);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const metric = METRICS[metricIdx];
  const color = METRIC_COLOR[metric];

  const data = useMemo(() => {
    return buckets.map((b) => {
      let amount = 0;
      for (const e of entries) {
        if (e.status !== metric) continue;
        const d = e.occurredAt ?? e.createdAt;
        if (d && b.test(d)) amount += mode === "gross" ? e.grossAmount : e.netAmount;
      }
      return { key: b.key, label: b.label, amount };
    });
  }, [entries, buckets, metric, mode]);

  const total = data.reduce((s, d) => s + d.amount, 0);
  const max = Math.max(...data.map((d) => d.amount), 1);

  const W = 320;
  const H = 125;
  const padTop = 12;
  const padBottom = 8;
  const usableH = H - padTop - padBottom;
  const n = data.length;
  const xAt = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * W);
  const yAt = (a: number) => padTop + (1 - a / max) * usableH;
  const linePoints = data.map((d, i) => `${xAt(i).toFixed(1)},${yAt(d.amount).toFixed(1)}`).join(" ");
  const areaPath =
    `M ${xAt(0).toFixed(1)},${yAt(data[0]?.amount ?? 0).toFixed(1)} ` +
    data.slice(1).map((d, i) => `L ${xAt(i + 1).toFixed(1)},${yAt(d.amount).toFixed(1)}`).join(" ") +
    ` L ${xAt(n - 1).toFixed(1)},${H} L ${xAt(0).toFixed(1)},${H} Z`;

  const cycle = () => {
    setMetricIdx((i) => (i + 1) % METRICS.length);
    setHoverIdx(null);
  };

  const pointAt = (clientX: number, rect: DOMRect) => {
    if (rect.width === 0 || n === 0) return;
    const rel = (clientX - rect.left) / rect.width;
    setHoverIdx(Math.max(0, Math.min(n - 1, Math.round(rel * (n - 1)))));
  };
  const hovered = hoverIdx != null ? data[hoverIdx] : null;

  return (
    <div style={{ padding: "2px 0", userSelect: "none", marginBottom: 14 }}>
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
            {tWallet(METRIC_KEY[metric])}
          </span>
          <span style={{ fontSize: 18, fontWeight: 700, color: "#fff", letterSpacing: "-0.02em" }}>
            {fmtMoney(total)}
          </span>
        </div>
        {/* Era `rgba(168,85,255,0.95)`: el morado de marca con un 255 donde
            va 247. Ahora sale del token y no puede volver a desviarse. */}
        <TextButton tone="brand" size="sm" onClick={cycle} style={{ textAlign: "end" }}>
          {tWallet("movementsChartHint")}
        </TextButton>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
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
          <span>{fmtCompact(max)}</span>
          <span>{fmtCompact(max / 2)}</span>
          <span>$0</span>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{ position: "relative", height: H, cursor: "default", touchAction: "pan-y" }}
            onMouseMove={(e) => pointAt(e.clientX, e.currentTarget.getBoundingClientRect())}
            onMouseLeave={() => setHoverIdx(null)}
            onTouchStart={(e) => {
              const t = e.touches[0];
              if (t) pointAt(t.clientX, e.currentTarget.getBoundingClientRect());
            }}
            onTouchMove={(e) => {
              const t = e.touches[0];
              if (t) pointAt(t.clientX, e.currentTarget.getBoundingClientRect());
            }}
          >
            <svg
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="none"
              width="100%"
              height={H}
              style={{ display: "block", overflow: "visible" }}
            >
              <defs>
                <linearGradient id="movArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity="0.28" />
                  <stop offset="100%" stopColor={color} stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={areaPath} fill="url(#movArea)" />
              <polyline
                points={linePoints}
                fill="none"
                stroke={color}
                strokeWidth={2.5}
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </svg>

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
                    background: color,
                    border: "2px solid #0a071c",
                    pointerEvents: "none",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    insetInlineStart: `${(xAt(hoverIdx) / W) * 100}%`,
                    top: `${(yAt(hovered.amount) / H) * 100}%`,
                    // Traslación horizontal según la posición: en el primer punto el
                    // tooltip queda alineado a la izquierda, en el último a la derecha,
                    // y centrado en medio — así nunca se recorta en los extremos.
                    transform: `translate(${(-(xAt(hoverIdx) / W) * 100).toFixed(1)}%, calc(-100% - 12px))`,
                    background: "rgba(20,14,40,0.96)",
                    border: `1px solid ${color}66`,
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
                    {fmtMoney(hovered.amount)}
                  </div>
                </div>
              </>
            ) : null}
          </div>

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
    </div>
  );
}
