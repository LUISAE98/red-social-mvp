"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useWalletLedger } from "@/lib/wallet/walletLedger";
import {
  useOwnedSubCommunities,
  useSubscriptionCancels,
} from "@/lib/wallet/walletSubscriptionData";
import { WalletCard } from "./WalletUi";
import WalletScopeToggle, { type StatScope } from "./WalletScopeToggle";
import { useWalletMoney } from "@/lib/wallet/useWalletMoney";
import { useCreatorNetRate } from "@/lib/wallet/useCreatorNetRate";

const DAY = 86400000;


/**
 * Bloque de Suscripciones. Se oculta por completo si el creador no tiene
 * ninguna comunidad con suscripción activada (no deja espacio muerto).
 * Métricas: activos, MRR, nuevos (30 d), bajas/churn (30 d), ingreso histórico.
 */
export default function WalletSubscriptions({
  uid,
  bare = false,
  communityIds = null,
}: {
  uid: string | null | undefined;
  /** true = sin tarjeta propia (para reusar dentro de otra sección). */
  bare?: boolean;
  /** Si se pasa, limita las métricas a esas comunidades; null = todas. */
  communityIds?: string[] | null;
}) {
  // El creador recibe el neto, que es su precio menos SU comisión: 25% o 30% según el país
  // de su cuenta de cobro. Ver `docs/payout-tiers.md`.
  const { netRate: NET_RATE } = useCreatorNetRate();
  const tWallet = useTranslations("wallet");
  // Dinero del CREADOR, en USD o en su moneda según el switch de la wallet.
  // Formateador único: ver `useWalletMoney`.
  const { formatMoney } = useWalletMoney();
  const { entries } = useWalletLedger(uid, 1000);
  const { communities, loaded } = useOwnedSubCommunities(uid);
  const { cancels } = useSubscriptionCancels(uid);

  const filterKey = communityIds && communityIds.length ? [...communityIds].sort().join(",") : null;
  // Alcance de las métricas de flujo (Nuevos, Bajas, Churn, Ingreso).
  const [scope, setScope] = useState<StatScope>("all");

  const stats = useMemo(() => {
    const allow = filterKey ? new Set(filterKey.split(",")) : null;
    const cutoff = new Date().getTime() - 30 * DAY;
    // En "histórico" no hay ventana; en "30d" solo lo del último mes.
    const within = (t: number | null) => scope === "all" || (t != null && t >= cutoff);
    const list = allow ? communities.filter((c) => allow.has(c.id)) : communities;
    // Activos y MRR son estado actual (no dependen del alcance).
    const active = list.reduce((s, c) => s + c.activeSubs, 0);
    const mrr = list.reduce((s, c) => s + c.activeSubs * c.price, 0) * NET_RATE;

    let newSubs = 0;
    let incomeNet = 0;
    for (const e of entries) {
      if (e.type !== "subscription" || e.status !== "earned") continue;
      if (allow && !(e.channelId && allow.has(e.channelId))) continue;
      const d = e.occurredAt ?? e.createdAt;
      if (!within(d ? d.getTime() : null)) continue;
      incomeNet += e.netAmount;
      newSubs += 1;
    }

    const inCommunity = (c: (typeof cancels)[number]) =>
      !allow || (c.groupId != null && allow.has(c.groupId));
    const bajas = cancels.filter(
      (c) => inCommunity(c) && within(c.occurredAt ? c.occurredAt.getTime() : null)
    ).length;
    const base = active + bajas;
    const churn = base > 0 ? (bajas / base) * 100 : null;

    return { active, mrr, newSubs, bajas, churn, incomeNet };
  }, [communities, entries, cancels, filterKey, scope, NET_RATE]);

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
    { label: tWallet("subsIncome"), value: formatMoney(stats.incomeNet, { code: true }) },
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

      <WalletScopeToggle value={scope} onChange={setScope} />

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
