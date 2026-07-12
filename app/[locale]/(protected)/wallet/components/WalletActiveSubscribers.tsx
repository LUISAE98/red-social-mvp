"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { useActiveSubscribers } from "@/lib/wallet/walletSubscriptionData";

const DAY = 86400000;

function SubAvatar({ src, initial }: { src: string | null; initial: string }) {
  const [error, setError] = useState(false);
  if (!src || error) {
    return (
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: "50%",
          flexShrink: 0,
          background: "rgba(255,255,255,0.09)",
          border: "1px solid rgba(255,255,255,0.14)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 700,
          fontSize: 13,
          color: "#fff",
        }}
      >
        {initial}
      </div>
    );
  }
  return (
    <Image
      src={src}
      alt=""
      width={34}
      height={34}
      onError={() => setError(true)}
      style={{
        borderRadius: "50%",
        objectFit: "cover",
        flexShrink: 0,
        border: "1px solid rgba(255,255,255,0.14)",
      }}
    />
  );
}

/**
 * Lista de suscriptores activos (todas las comunidades de suscripción del
 * creador), con avatar, nombre y antigüedad. Datos cacheados y compartidos.
 */
export default function WalletActiveSubscribers({
  uid,
}: {
  uid: string | null | undefined;
}) {
  const tWallet = useTranslations("wallet");
  const { subscribers, loaded } = useActiveSubscribers(uid);

  const tenureLabel = (date: Date | null): string => {
    if (!date) return "—";
    const days = Math.floor((new Date().getTime() - date.getTime()) / DAY);
    if (days < 1) return tWallet("subTenureToday");
    if (days < 30) return tWallet("subTenureDays", { count: days });
    const months = Math.floor(days / 30);
    if (months < 12) return tWallet("subTenureMonths", { count: months });
    return tWallet("subTenureYears", { count: Math.floor(months / 12) });
  };

  if (!loaded) return null;

  return (
    <div style={{ marginTop: 18 }}>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 13,
          fontWeight: 700,
          color: "#fff",
          letterSpacing: "-0.01em",
        }}
      >
        {tWallet("subsAllTitle")}
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: "#4ade80",
            flexShrink: 0,
          }}
        />
      </span>

      {subscribers.length === 0 ? (
        <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 13, padding: "12px 0" }}>
          {tWallet("subsActiveEmpty")}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", marginTop: 10 }}>
          {subscribers.map((s, index) => {
            const name = s.displayName ?? tWallet("topFansAnonymous");
            return (
              <div
                key={s.uid}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 11,
                  padding: "9px 0",
                  borderTop: index === 0 ? "none" : "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <SubAvatar src={s.avatarUrl} initial={name.charAt(0).toUpperCase()} />
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
                  {name}
                </span>
                <span
                  style={{
                    flexShrink: 0,
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: "rgba(255,255,255,0.55)",
                  }}
                >
                  {tenureLabel(s.subscribedAt)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
