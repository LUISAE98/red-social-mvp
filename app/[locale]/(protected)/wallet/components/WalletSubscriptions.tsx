"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { useWalletLedger } from "@/lib/wallet/walletLedger";
import {
  useOwnedSubCommunities,
  useSubscriptionCancels,
} from "@/lib/wallet/walletSubscriptionData";
import { WalletCard } from "./WalletUi";

const DAY = 86400000;
// El creador recibe el neto (precio menos la comisión de la plataforma, 23%).
const NET_RATE = 0.77;

function formatMoney(value: number): string {
  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: "MXN",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `$${Math.round(value)}`;
  }
}

/**
 * Bloque de Suscripciones. Se oculta por completo si el creador no tiene
 * ninguna comunidad con suscripción activada (no deja espacio muerto).
 * Métricas: activos, MRR, nuevos (30 d), bajas/churn (30 d), ingreso histórico.
 */
export default function WalletSubscriptions({
  uid,
  bare = false,
}: {
  uid: string | null | undefined;
  /** true = sin tarjeta propia (para reusar dentro de otra sección). */
  bare?: boolean;
}) {
  const tWallet = useTranslations("wallet");
  const { entries } = useWalletLedger(uid, 1000);
  const { communities, loaded } = useOwnedSubCommunities(uid);
  const { cancels } = useSubscriptionCancels(uid);

  const stats = useMemo(() => {
    const cutoff = new Date().getTime() - 30 * DAY;
    const list = communities;
    const active = list.reduce((s, c) => s + c.activeSubs, 0);
    // MRR neto: lo que realmente recibe el creador cada mes.
    const mrr = list.reduce((s, c) => s + c.activeSubs * c.price, 0) * NET_RATE;

    let newSubs = 0;
    let incomeNet = 0;
    for (const e of entries) {
      if (e.type !== "subscription" || e.status !== "earned") continue;
      incomeNet += e.netAmount;
      const d = e.occurredAt ?? e.createdAt;
      if (d && d.getTime() >= cutoff) newSubs += 1;
    }

    const bajas = cancels.filter((d) => d && d.getTime() >= cutoff).length;
    const base = active + bajas;
    const churn = base > 0 ? (bajas / base) * 100 : null;

    return { active, mrr, newSubs, bajas, churn, incomeNet };
  }, [communities, entries, cancels]);

  // Ocultar por completo mientras carga o si no hay comunidades de suscripción.
  if (!loaded || communities.length === 0) return null;

  const rows: { label: string; value: string }[] = [
    { label: tWallet("subsActive"), value: String(stats.active) },
    { label: tWallet("subsMrr"), value: tWallet("subsPerMonth", { amount: formatMoney(stats.mrr) }) },
    { label: tWallet("subsNew"), value: String(stats.newSubs) },
    { label: tWallet("subsChurned"), value: String(stats.bajas) },
    {
      label: tWallet("subsChurnRate"),
      value: stats.churn == null ? "—" : `${Math.round(stats.churn)}%`,
    },
    { label: tWallet("subsIncome"), value: `${formatMoney(stats.incomeNet)} MXN` },
  ];

  const content = (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <span
        style={{
          fontSize: 16.5,
          fontWeight: 600,
          color: "#fff",
          letterSpacing: "-0.01em",
          textAlign: "center",
        }}
      >
        {tWallet("subsTitle")}
      </span>

      <div style={{ display: "flex", flexDirection: "column" }}>
        {rows.map((row, index) => (
          <div
            key={row.label}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "11px 0",
              borderTop: index === 0 ? "none" : "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <span style={{ fontSize: 13, color: "rgba(255,255,255,0.65)", minWidth: 0 }}>
              {row.label}
            </span>
            <span
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: "#fff",
                letterSpacing: "-0.01em",
                flexShrink: 0,
              }}
            >
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );

  return bare ? content : <WalletCard transparent>{content}</WalletCard>;
}
