"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  useWalletLedger,
  ledgerTypeLabelKey,
  type LedgerServiceType,
} from "@/lib/wallet/walletLedger";

// Color por servicio (mismo espíritu que los recuadros del panel de live).
const SERVICE_COLOR: Record<LedgerServiceType, string> = {
  supercomment: "#a855f7",
  greeting: "#f472b6",
  advice: "#facc15",
  live_donation: "#22d3ee",
  live_ticket: "#3b82f6",
  premium_post: "#60a5fa",
  vod_ticket: "#818cf8",
  exclusive_session: "#fb923c",
  live_session: "#f97316",
  subscription: "#4ade80",
  profile_donation: "#f87171",
};

/** Porcentaje redondeado, con "<1%" para participaciones muy pequeñas. */
function formatPct(pct: number): string {
  if (pct > 0 && pct < 1) return "<1%";
  return `${Math.round(pct)}%`;
}

/**
 * Desglose: qué porcentaje de la monetización (neto ganado) genera cada
 * servicio. Solo aparecen los servicios efectivamente utilizados.
 */
export default function WalletServiceBreakdown({
  uid,
}: {
  uid: string | null | undefined;
}) {
  const tWallet = useTranslations("wallet");
  const { entries } = useWalletLedger(uid, 1000);

  const rows = useMemo(() => {
    const byType = new Map<LedgerServiceType, number>();
    let total = 0;
    for (const e of entries) {
      if (e.status !== "earned") continue;
      byType.set(e.type, (byType.get(e.type) ?? 0) + e.netAmount);
      total += e.netAmount;
    }
    if (total <= 0) return [];
    return [...byType.entries()]
      .filter(([, amount]) => amount > 0)
      .map(([type, amount]) => ({
        type,
        pct: (amount / total) * 100,
      }))
      .sort((a, b) => b.pct - a.pct);
  }, [entries]);

  if (rows.length === 0) return null;

  return (
    <div style={{ marginTop: 48 }}>
      <style jsx>{`
        .grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 8px 4px;
        }
        @media (max-width: 520px) {
          .grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }
      `}</style>

      <p
        style={{
          margin: "0 0 20px",
          textAlign: "center",
          fontSize: 16.5,
          fontWeight: 600,
          lineHeight: 1.4,
          letterSpacing: "-0.01em",
          color: "rgba(255,255,255,0.85)",
        }}
      >
        {tWallet("breakdownQuestion")}
      </p>

      <div className="grid">
        {rows.map((row) => (
          <div
            key={row.type}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "flex-start",
              padding: "12px 8px",
              gap: 5,
              color: SERVICE_COLOR[row.type],
            }}
          >
            <span style={{ fontSize: 24, fontWeight: 700, lineHeight: 1, color: "#fff" }}>
              {formatPct(row.pct)}
            </span>
            <span
              style={{
                fontSize: 9,
                fontWeight: 600,
                color: "#fff",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                textAlign: "center",
                lineHeight: 1.25,
              }}
            >
              {tWallet(ledgerTypeLabelKey(row.type))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
