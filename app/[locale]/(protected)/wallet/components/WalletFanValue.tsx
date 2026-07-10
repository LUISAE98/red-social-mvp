"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useWalletLedger } from "@/lib/wallet/walletLedger";

const DAY = 86400000;

function formatMoney(value: number): string {
  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: "MXN",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

type External = { followers: number; communityMembers: number };

/**
 * Métricas de valor por fan (valor por seguidor, por miembro de comunidad,
 * por comprador, % recurrentes, tiempo entre compras y LTV). Todo calculado
 * en vivo desde el ledger + conteo de seguidores y miembros de comunidad.
 */
export default function WalletFanValue({
  uid,
}: {
  uid: string | null | undefined;
}) {
  const tWallet = useTranslations("wallet");
  const { entries } = useWalletLedger(uid, 1000);
  const [external, setExternal] = useState<External>({ followers: 0, communityMembers: 0 });

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    (async () => {
      let followers = 0;
      let communityMembers = 0;
      try {
        const uSnap = await getDoc(doc(db, "users", uid));
        const data = uSnap.data() as Record<string, unknown> | undefined;
        const social = data?.socialStats as { followersCount?: unknown } | undefined;
        followers =
          typeof data?.followersCount === "number"
            ? data.followersCount
            : typeof social?.followersCount === "number"
              ? social.followersCount
              : 0;
      } catch {
        // Sin permiso o inexistente: queda en 0 → la métrica muestra "—".
      }
      try {
        const gSnap = await getDocs(
          query(collection(db, "groups"), where("ownerId", "==", uid))
        );
        gSnap.docs.forEach((g) => {
          const gd = g.data() as Record<string, unknown>;
          const mon = gd.monetization as
            | { subscriptionsEnabled?: unknown; isPaid?: unknown }
            | undefined;
          const isSub = mon?.subscriptionsEnabled === true || mon?.isPaid === true;
          if (isSub && typeof gd.memberCount === "number") {
            communityMembers += gd.memberCount;
          }
        });
      } catch {
        // Igual: queda en 0 → "—".
      }
      if (!cancelled) setExternal({ followers, communityMembers });
    })();
    return () => {
      cancelled = true;
    };
  }, [uid]);

  const metrics = useMemo(() => {
    const buyers = new Map<string, { total: number; count: number; dates: number[] }>();
    let allEarnedGross = 0;
    let buyerGross = 0;
    let communityGross = 0;

    for (const e of entries) {
      if (e.status !== "earned") continue;
      allEarnedGross += e.grossAmount;
      if (e.type === "subscription") communityGross += e.grossAmount;
      if (!e.buyerId) continue;
      const b = buyers.get(e.buyerId) ?? { total: 0, count: 0, dates: [] };
      b.total += e.grossAmount;
      b.count += 1;
      const date = e.occurredAt ?? e.createdAt;
      if (date) b.dates.push(date.getTime());
      buyers.set(e.buyerId, b);
      buyerGross += e.grossAmount;
    }

    const uniqueBuyers = buyers.size;
    const recurring = [...buyers.values()].filter((b) => b.count > 1);

    let gapSum = 0;
    let gapCount = 0;
    for (const b of recurring) {
      const ds = [...b.dates].sort((a, z) => a - z);
      for (let i = 1; i < ds.length; i += 1) {
        gapSum += ds[i] - ds[i - 1];
        gapCount += 1;
      }
    }

    const perBuyer = uniqueBuyers > 0 ? buyerGross / uniqueBuyers : null;

    return {
      perFollower: external.followers > 0 ? allEarnedGross / external.followers : null,
      perCommunityMember:
        external.communityMembers > 0 ? communityGross / external.communityMembers : null,
      perBuyer,
      recurringPct: uniqueBuyers > 0 ? (recurring.length / uniqueBuyers) * 100 : null,
      avgDays: gapCount > 0 ? gapSum / gapCount / DAY : null,
    };
  }, [entries, external]);

  const money = (v: number | null) => (v == null ? "—" : `${formatMoney(v)} MXN`);
  const percent = (v: number | null) => (v == null ? "—" : `${Math.round(v)}%`);
  const days = (v: number | null) =>
    v == null ? "—" : tWallet("fanValueDays", { count: Math.round(v) });

  const rows: { label: string; value: string }[] = [
    { label: tWallet("fanValuePerFollower"), value: money(metrics.perFollower) },
    { label: tWallet("fanValuePerMember"), value: money(metrics.perCommunityMember) },
    { label: tWallet("fanValuePerBuyer"), value: money(metrics.perBuyer) },
    { label: tWallet("fanValueRecurring"), value: percent(metrics.recurringPct) },
    { label: tWallet("fanValueBetween"), value: days(metrics.avgDays) },
  ];

  return (
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
        {tWallet("fanValueTitle")}
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
}
