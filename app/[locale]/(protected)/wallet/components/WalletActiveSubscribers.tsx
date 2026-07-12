"use client";

import { useEffect, useState } from "react";
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

const DAY = 86400000;

function pickString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
function toDate(value: unknown): Date | null {
  if (value && typeof (value as { toDate?: unknown }).toDate === "function") {
    try {
      return (value as { toDate: () => Date }).toDate();
    } catch {
      return null;
    }
  }
  return null;
}

type SubRow = { uid: string; subscribedAt: Date | null };
type Profile = { displayName: string | null; avatarUrl: string | null };

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
 * Lista de suscriptores activos del creador (todas sus comunidades de
 * suscripción), con avatar, nombre y antigüedad de la suscripción.
 */
export default function WalletActiveSubscribers({
  uid,
}: {
  uid: string | null | undefined;
}) {
  const tWallet = useTranslations("wallet");
  const [subs, setSubs] = useState<SubRow[] | null>(null);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});

  // Suscriptores activos: miembros con subscriptionActive en comunidades propias.
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    (async () => {
      // Dedupe por uid: si está en varias comunidades, la suscripción más antigua.
      const byUid = new Map<string, Date | null>();
      try {
        const gSnap = await getDocs(
          query(collection(db, "groups"), where("ownerId", "==", uid))
        );
        for (const g of gSnap.docs) {
          const gd = g.data() as Record<string, unknown>;
          const mon = gd.monetization as
            | { subscriptionsEnabled?: unknown; isPaid?: unknown }
            | undefined;
          if (!(mon?.subscriptionsEnabled === true || mon?.isPaid === true)) continue;
          try {
            const mSnap = await getDocs(
              query(
                collection(db, "groups", g.id, "members"),
                where("subscriptionActive", "==", true)
              )
            );
            mSnap.docs.forEach((m) => {
              const d = m.data();
              const memberUid = pickString(d.userId) ?? m.id;
              if (!memberUid || memberUid === uid) return;
              const since = toDate(d.subscribedAt) ?? toDate(d.joinedAt);
              const prev = byUid.get(memberUid);
              // conserva la fecha más antigua (mayor antigüedad)
              if (prev === undefined || (since && (!prev || since < prev))) {
                byUid.set(memberUid, since);
              }
            });
          } catch {
            // sin permiso a esa comunidad → se omite
          }
        }
      } catch {
        // sin comunidades
      }
      if (cancelled) return;
      const list = [...byUid.entries()]
        .map(([u, since]) => ({ uid: u, subscribedAt: since }))
        .sort((a, b) => {
          const ta = a.subscribedAt?.getTime() ?? Infinity;
          const tb = b.subscribedAt?.getTime() ?? Infinity;
          return ta - tb; // más antiguos primero
        });
      setSubs(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [uid]);

  // Perfiles (avatar/nombre) por lote.
  const idsKey = (subs ?? []).map((s) => s.uid).join(",");
  useEffect(() => {
    const ids = idsKey ? idsKey.split(",") : [];
    if (ids.length === 0) return;
    let cancelled = false;
    (async () => {
      const acc: Record<string, Profile> = {};
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
          // lote fallido → se continúa
        }
      }
      if (!cancelled) setProfiles(acc);
    })();
    return () => {
      cancelled = true;
    };
  }, [idsKey]);

  const tenureLabel = (date: Date | null): string => {
    if (!date) return "—";
    const days = Math.floor((new Date().getTime() - date.getTime()) / DAY);
    if (days < 1) return tWallet("subTenureToday");
    if (days < 30) return tWallet("subTenureDays", { count: days });
    const months = Math.floor(days / 30);
    if (months < 12) return tWallet("subTenureMonths", { count: months });
    return tWallet("subTenureYears", { count: Math.floor(months / 12) });
  };

  if (subs === null) return null;

  return (
    <div style={{ marginTop: 18 }}>
      <span
        style={{
          fontSize: 13,
          fontWeight: 700,
          color: "#fff",
          letterSpacing: "-0.01em",
        }}
      >
        {tWallet("subsAllTitle")}
      </span>

      {subs.length === 0 ? (
        <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 13, padding: "12px 0" }}>
          {tWallet("subsActiveEmpty")}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", marginTop: 10 }}>
          {subs.map((s, index) => {
            const p = profiles[s.uid];
            const name = p?.displayName ?? tWallet("topFansAnonymous");
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
                <SubAvatar src={p?.avatarUrl ?? null} initial={name.charAt(0).toUpperCase()} />
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
