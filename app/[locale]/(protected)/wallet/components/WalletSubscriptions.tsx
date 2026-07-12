"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  collection,
  getCountFromServer,
  getDocs,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useWalletLedger } from "@/lib/wallet/walletLedger";
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
function numOr0(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
function toDate(v: unknown): Date | null {
  if (v && typeof (v as { toDate?: unknown }).toDate === "function") {
    try {
      return (v as { toDate: () => Date }).toDate();
    } catch {
      return null;
    }
  }
  return null;
}

type Community = { id: string; price: number; activeSubs: number };

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
  // null = cargando; [] = sin comunidades de suscripción.
  const [communities, setCommunities] = useState<Community[] | null>(null);
  const [cancels, setCancels] = useState<Array<Date | null>>([]);

  // Comunidades de suscripción propias + suscriptores activos (conteo).
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    (async () => {
      let result: Community[] = [];
      try {
        const gSnap = await getDocs(
          query(collection(db, "groups"), where("ownerId", "==", uid))
        );
        result = await Promise.all(
          gSnap.docs
            .map((g) => {
              const gd = g.data() as Record<string, unknown>;
              const mon = gd.monetization as
                | {
                    subscriptionsEnabled?: unknown;
                    isPaid?: unknown;
                    subscriptionPriceMonthly?: unknown;
                  }
                | undefined;
              const isSub =
                mon?.subscriptionsEnabled === true || mon?.isPaid === true;
              if (!isSub) return null;
              return { g, price: numOr0(mon?.subscriptionPriceMonthly) };
            })
            .filter((x): x is { g: (typeof gSnap.docs)[number]; price: number } => x !== null)
            .map(async ({ g, price }) => {
              let activeSubs = 0;
              try {
                const c = await getCountFromServer(
                  query(
                    collection(db, "groups", g.id, "members"),
                    where("subscriptionActive", "==", true)
                  )
                );
                activeSubs = c.data().count;
              } catch {
                activeSubs = 0;
              }
              return { id: g.id, price, activeSubs };
            })
        );
      } catch {
        result = [];
      }
      if (!cancelled) setCommunities(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [uid]);

  // Bajas (eventos de cancelación registrados por el trigger).
  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(
      query(collection(db, "users", uid, "subscriptionEvents")),
      (snap) => setCancels(snap.docs.map((d) => toDate(d.data().occurredAt))),
      () => {}
    );
    return () => unsub();
  }, [uid]);

  const stats = useMemo(() => {
    const cutoff = new Date().getTime() - 30 * DAY;
    const list = communities ?? [];
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
  if (communities === null || communities.length === 0) return null;

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
