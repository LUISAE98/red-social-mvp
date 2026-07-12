"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useWalletPurchaseGeo } from "@/lib/wallet/walletPurchaseGeo";

// Nombre del país localizado a partir del código ISO (nivel módulo por la regla de pureza).
function countryName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function formatPct(pct: number): string {
  if (pct > 0 && pct < 1) return "<1%";
  return `${Math.round(pct)}%`;
}

/**
 * Ranking histórico de países desde donde más te compran (según la geo por IP
 * de las compras). Top 5 + "Ver todos". Porcentaje = compras del país / total.
 */
export default function WalletCountryStats({
  uid,
}: {
  uid: string | null | undefined;
}) {
  const tWallet = useTranslations("wallet");
  const locale = useLocale();
  const { points } = useWalletPurchaseGeo(uid);
  const [showAll, setShowAll] = useState(false);

  const rows = useMemo(() => {
    const byCountry = new Map<string, number>();
    let total = 0;
    for (const p of points) {
      if (!p.country) continue;
      byCountry.set(p.country, (byCountry.get(p.country) ?? 0) + p.purchases);
      total += p.purchases;
    }
    if (total <= 0) return [];
    return [...byCountry.entries()]
      .map(([code, purchases]) => ({ code, purchases, pct: (purchases / total) * 100 }))
      .sort((a, b) => b.purchases - a.purchases);
  }, [points]);

  if (rows.length === 0) return null;

  const visible = showAll ? rows : rows.slice(0, 5);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <span
        style={{
          fontSize: 16.5,
          fontWeight: 600,
          color: "#fff",
          letterSpacing: "-0.01em",
          textAlign: "center",
        }}
      >
        {tWallet("countryStatsTitle")}
      </span>

      <div style={{ display: "flex", flexDirection: "column" }}>
        {visible.map((r, index) => (
          <div
            key={r.code}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 11,
              padding: "9px 0",
              borderTop: index === 0 ? "none" : "1px solid rgba(255,255,255,0.06)",
            }}
          >
            {/* Bandera circular (sin orilla de contenedor). */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`https://flagcdn.com/w80/${r.code.toLowerCase()}.png`}
              alt=""
              width={28}
              height={28}
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                objectFit: "cover",
                flexShrink: 0,
              }}
            />
            <span
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 13.5,
                fontWeight: 500,
                color: "rgba(255,255,255,0.9)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {countryName(r.code, locale)}
            </span>
            <span
              style={{
                flexShrink: 0,
                fontSize: 14,
                fontWeight: 700,
                color: "#fff",
                letterSpacing: "-0.01em",
              }}
            >
              {formatPct(r.pct)}
            </span>
          </div>
        ))}
      </div>

      {rows.length > 5 ? (
        <button
          type="button"
          onClick={() => setShowAll((s) => !s)}
          style={{
            alignSelf: "center",
            marginTop: 4,
            border: "none",
            background: "transparent",
            cursor: "pointer",
            fontSize: 12.5,
            fontWeight: 600,
            color: "#c084fc",
            letterSpacing: "-0.01em",
          }}
        >
          {showAll ? tWallet("countryStatsLess") : tWallet("countryStatsAll")}
        </button>
      ) : null}
    </div>
  );
}
