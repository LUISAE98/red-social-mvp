"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import {
  collection,
  documentId,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useWalletLedger } from "@/lib/wallet/walletLedger";

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

function pickString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

type FanProfile = { displayName: string | null; avatarUrl: string | null };

const SIZE = 34;
// Aro de Vibra (mismo gradiente de marca que el aro de historias).
const VIBRA_RING = "linear-gradient(135deg, #ec4899 0%, #9333ea 52%, #3b82f6 100%)";

function FanAvatar({
  src,
  initial,
  ring = false,
}: {
  src: string | null;
  initial: string;
  ring?: boolean;
}) {
  const [error, setError] = useState(false);
  const showImg = Boolean(src) && !error;
  const innerPx = ring ? 27 : SIZE;

  const media = showImg ? (
    <Image
      src={src as string}
      alt=""
      width={innerPx}
      height={innerPx}
      onError={() => setError(true)}
      style={{ borderRadius: "50%", objectFit: "cover", display: "block" }}
    />
  ) : (
    <div
      style={{
        width: innerPx,
        height: innerPx,
        borderRadius: "50%",
        background: "rgba(255,255,255,0.09)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 700,
        fontSize: Math.round(innerPx * 0.42),
        color: "#fff",
      }}
    >
      {initial}
    </div>
  );

  if (!ring) {
    return (
      <div
        style={{
          width: SIZE,
          height: SIZE,
          flexShrink: 0,
          borderRadius: "50%",
          overflow: "hidden",
          border: "1px solid rgba(255,255,255,0.14)",
        }}
      >
        {media}
      </div>
    );
  }

  return (
    <div
      style={{
        width: SIZE,
        height: SIZE,
        flexShrink: 0,
        borderRadius: "50%",
        background: VIBRA_RING,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 2,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: "50%",
          border: "1.5px solid #0a0a0e",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxSizing: "border-box",
        }}
      >
        {media}
      </div>
    </div>
  );
}

/**
 * Top 10 fans por gasto histórico (bruto pagado en ventas concretadas).
 */
export default function WalletTopFans({
  uid,
}: {
  uid: string | null | undefined;
}) {
  const tWallet = useTranslations("wallet");
  const { entries } = useWalletLedger(uid, 1000);

  const topFans = useMemo(() => {
    const byBuyer = new Map<string, number>();
    for (const e of entries) {
      if (e.status !== "earned" || !e.buyerId) continue;
      byBuyer.set(e.buyerId, (byBuyer.get(e.buyerId) ?? 0) + e.grossAmount);
    }
    return [...byBuyer.entries()]
      .map(([buyerId, total]) => ({ buyerId, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [entries]);

  const [profiles, setProfiles] = useState<Record<string, FanProfile>>({});
  const fanIdsKey = topFans.map((f) => f.buyerId).join(",");

  useEffect(() => {
    const ids = fanIdsKey ? fanIdsKey.split(",") : [];
    if (ids.length === 0) return;
    let cancelled = false;
    (async () => {
      const acc: Record<string, FanProfile> = {};
      for (let i = 0; i < ids.length; i += 30) {
        const chunk = ids.slice(i, i + 30);
        try {
          const snap = await getDocs(
            query(collection(db, "users"), where(documentId(), "in", chunk))
          );
          snap.docs.forEach((d) => {
            const data = d.data();
            acc[d.id] = {
              displayName:
                pickString(data.displayName) ??
                pickString(data.name) ??
                pickString(data.username) ??
                pickString(data.handle),
              avatarUrl: pickString(data.avatarUrl) ?? pickString(data.photoURL),
            };
          });
        } catch {
          // Si un lote falla, seguimos con los demás.
        }
      }
      if (!cancelled) setProfiles(acc);
    })();
    return () => {
      cancelled = true;
    };
  }, [fanIdsKey]);

  if (topFans.length === 0) return null;

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
        {tWallet("topFansTitle")}
      </span>

      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {topFans.map((fan, index) => {
          const profile = profiles[fan.buyerId];
          const name = profile?.displayName ?? tWallet("topFansAnonymous");
          const initial = name.charAt(0).toUpperCase();
          return (
            <div
              key={fan.buyerId}
              style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}
            >
              <span
                style={{
                  flexShrink: 0,
                  width: 16,
                  textAlign: "center",
                  fontSize: 12,
                  fontWeight: 700,
                  color: index < 3 ? "#c084fc" : "rgba(255,255,255,0.4)",
                }}
              >
                {index + 1}
              </span>
              <FanAvatar src={profile?.avatarUrl ?? null} initial={initial} ring={index < 3} />
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 13,
                  fontWeight: 500,
                  color: "rgba(255,255,255,0.9)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {name}
              </span>
              <span
                style={{
                  flexShrink: 0,
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#fff",
                  letterSpacing: "-0.01em",
                }}
              >
                {formatMoney(fan.total)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
