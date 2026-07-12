"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  query,
  Timestamp,
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
function numOr0(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

// Chevron blanco propio (mismo trazo que las flechas del carrusel). Rota 90° al abrir.
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={{
        flexShrink: 0,
        transform: open ? "rotate(90deg)" : "rotate(0deg)",
        transition: "transform 260ms cubic-bezier(0.16,1,0.3,1)",
      }}
    >
      <path
        d="M9 18l6-6-6-6"
        stroke="#fff"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type GroupVisibility = "public" | "private" | "hidden" | null;
type ProfileMeta = { name: string | null; avatar: string | null; followers: number };
type GroupMeta = {
  id: string;
  name: string;
  avatar: string | null;
  memberCount: number;
  price: number;
  visibility: GroupVisibility;
  isSubscription: boolean;
  /** Miembros nuevos en 30 d (solo para comunidades sin suscripción). */
  newMembers: number | null;
};

function ChannelAvatar({
  src,
  initial,
}: {
  src: string | null;
  initial: string;
}) {
  const [error, setError] = useState(false);
  const radius = "50%";
  if (!src || error) {
    return (
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: radius,
          flexShrink: 0,
          background: "rgba(255,255,255,0.09)",
          border: "1px solid rgba(255,255,255,0.14)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 700,
          fontSize: 14,
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
      width={36}
      height={36}
      onError={() => setError(true)}
      style={{
        borderRadius: radius,
        objectFit: "cover",
        flexShrink: 0,
        border: "1px solid rgba(255,255,255,0.14)",
      }}
    />
  );
}

/**
 * Canal principal de monetización: lista el perfil + las comunidades propias,
 * ordenadas por lo que más monetizan (neto ganado), con % y monto. Al tocar un
 * canal se expande con estadísticas básicas (seguidores/miembros, nuevos, etc.).
 */
export default function WalletChannels({
  uid,
}: {
  uid: string | null | undefined;
}) {
  const tWallet = useTranslations("wallet");
  const { entries } = useWalletLedger(uid, 1000);

  const [profile, setProfile] = useState<ProfileMeta | null>(null);
  const [groups, setGroups] = useState<GroupMeta[]>([]);
  const [newFollowers, setNewFollowers] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Metadatos: perfil (nombre/avatar/seguidores) + comunidades propias.
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    (async () => {
      let prof: ProfileMeta | null = null;
      let ownedGroups: GroupMeta[] = [];
      let nf: number | null = null;
      try {
        const uSnap = await getDoc(doc(db, "users", uid));
        const ud = uSnap.data() as Record<string, unknown> | undefined;
        const social = ud?.socialStats as { followersCount?: unknown } | undefined;
        prof = {
          name:
            pickString(ud?.displayName) ??
            pickString(ud?.name) ??
            pickString(ud?.username) ??
            pickString(ud?.handle),
          avatar: pickString(ud?.avatarUrl) ?? pickString(ud?.photoURL),
          followers: numOr0(ud?.followersCount ?? social?.followersCount),
        };
      } catch {
        // sin datos → se muestra con fallback
      }
      try {
        const cutoff = Timestamp.fromMillis(Date.now() - 30 * DAY);
        const c = await getCountFromServer(
          query(
            collection(db, "users", uid, "followers"),
            where("createdAt", ">=", cutoff)
          )
        );
        nf = c.data().count;
      } catch {
        // sin permiso/índice → "—"
      }
      try {
        const cutoffTs = Timestamp.fromMillis(new Date().getTime() - 30 * DAY);
        const gSnap = await getDocs(
          query(collection(db, "groups"), where("ownerId", "==", uid))
        );
        ownedGroups = await Promise.all(
          gSnap.docs.map(async (g) => {
            const gd = g.data() as Record<string, unknown>;
            const mon = gd.monetization as
              | {
                  subscriptionPriceMonthly?: unknown;
                  subscriptionsEnabled?: unknown;
                  isPaid?: unknown;
                }
              | undefined;
            const isSubscription =
              mon?.subscriptionsEnabled === true || mon?.isPaid === true;
            const vis = pickString(gd.visibility);

            // Miembros nuevos (30 d): solo para comunidades sin suscripción.
            let newMembers: number | null = null;
            if (!isSubscription) {
              try {
                const c = await getCountFromServer(
                  query(
                    collection(db, "groups", g.id, "members"),
                    where("joinedAt", ">=", cutoffTs)
                  )
                );
                newMembers = c.data().count;
              } catch {
                newMembers = null;
              }
            }

            return {
              id: g.id,
              name: pickString(gd.name) ?? tWallet("channelCommunityFallback"),
              avatar:
                pickString(gd.avatarUrl) ??
                pickString(gd.imageUrl) ??
                pickString(gd.coverUrl),
              memberCount: numOr0(gd.memberCount),
              price: numOr0(mon?.subscriptionPriceMonthly),
              visibility:
                vis === "public" || vis === "private" || vis === "hidden" ? vis : null,
              isSubscription,
              newMembers,
            };
          })
        );
      } catch {
        // sin comunidades / sin permiso
      }
      if (!cancelled) {
        setProfile(prof);
        setGroups(ownedGroups);
        setNewFollowers(nf);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uid, tWallet]);

  // Monetización (neto ganado) por canal, desde el ledger.
  const agg = useMemo(() => {
    const map = new Map<
      string,
      { net: number; buyers: Set<string>; newSubs30d: number }
    >();
    const cutoff = new Date().getTime() - 30 * DAY;
    for (const e of entries) {
      if (e.status !== "earned") continue;
      const key = e.channelType === "group" && e.channelId ? `g:${e.channelId}` : "profile";
      const cur = map.get(key) ?? { net: 0, buyers: new Set<string>(), newSubs30d: 0 };
      cur.net += e.netAmount;
      if (e.buyerId) cur.buyers.add(e.buyerId);
      if (e.type === "subscription") {
        const d = e.occurredAt ?? e.createdAt;
        if (d && d.getTime() >= cutoff) cur.newSubs30d += 1;
      }
      map.set(key, cur);
    }
    return map;
  }, [entries]);

  // Lista de canales combinando metadatos + monetización, ordenada desc.
  const channels = useMemo(() => {
    const p = agg.get("profile");
    const list = [
      {
        key: "profile",
        type: "profile" as const,
        name: profile?.name ?? null,
        avatar: profile?.avatar ?? null,
        net: p?.net ?? 0,
        buyers: p?.buyers.size ?? 0,
        followers: profile?.followers ?? 0,
        memberCount: 0,
        price: 0,
        newSubs: 0,
        visibility: null as GroupVisibility,
        isSubscription: false,
        newMembers: null as number | null,
      },
      ...groups.map((g) => {
        const a = agg.get(`g:${g.id}`);
        return {
          key: `g:${g.id}`,
          type: "group" as const,
          name: g.name,
          avatar: g.avatar,
          net: a?.net ?? 0,
          buyers: a?.buyers.size ?? 0,
          followers: 0,
          memberCount: g.memberCount,
          price: g.price,
          newSubs: a?.newSubs30d ?? 0,
          visibility: g.visibility,
          isSubscription: g.isSubscription,
          newMembers: g.newMembers,
        };
      }),
    ];
    const total = list.reduce((s, c) => s + c.net, 0);
    list.sort((a, b) => b.net - a.net);
    return { list, total };
  }, [agg, profile, groups]);

  if (channels.list.length === 0) return null;

  const statRow = (label: string, value: string) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "7px 0",
      }}
    >
      <span style={{ fontSize: 12.5, color: "rgba(255,255,255,0.55)" }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{value}</span>
    </div>
  );

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
        {tWallet("channelsTitle")}
      </span>

      <div style={{ display: "flex", flexDirection: "column" }}>
        {channels.list.map((ch, index) => {
          const pct =
            channels.total > 0 ? Math.round((ch.net / channels.total) * 100) : 0;
          const name = ch.name ?? tWallet("channelProfile");
          const isOpen = expanded === ch.key;
          return (
            <div
              key={ch.key}
              style={{
                borderTop: index === 0 ? "none" : "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <button
                type="button"
                onClick={() => setExpanded((k) => (k === ch.key ? null : ch.key))}
                style={{
                  width: "100%",
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 0",
                  textAlign: "left",
                }}
              >
                <ChannelAvatar src={ch.avatar} initial={name.charAt(0).toUpperCase()} />
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                  <span
                    style={{
                      fontSize: 13.5,
                      fontWeight: 600,
                      color: "#fff",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {name}
                  </span>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.45)" }}>
                    {ch.type === "profile"
                      ? tWallet("channelProfileTag")
                      : ch.visibility === "public"
                        ? tWallet("channelCommunityPublic")
                        : ch.visibility === "private"
                          ? tWallet("channelCommunityPrivate")
                          : ch.visibility === "hidden"
                            ? tWallet("channelCommunityHidden")
                            : tWallet("channelCommunityTag")}
                  </span>
                </div>
                <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#fff", letterSpacing: "-0.01em" }}>
                    {pct}%
                  </span>
                  <span style={{ fontSize: 11.5, color: "rgba(255,255,255,0.55)" }}>
                    {formatMoney(ch.net)} MXN
                  </span>
                </div>
                <span style={{ flexShrink: 0, marginLeft: 4, display: "inline-flex" }}>
                  <Chevron open={isOpen} />
                </span>
              </button>

              {/* Panel expandible: anima la altura con el truco grid-rows 0fr→1fr. */}
              <div
                style={{
                  display: "grid",
                  gridTemplateRows: isOpen ? "1fr" : "0fr",
                  transition: "grid-template-rows 300ms cubic-bezier(0.16,1,0.3,1)",
                }}
              >
                <div style={{ overflow: "hidden" }}>
                  <div style={{ padding: "2px 0 14px 48px" }}>
                    {ch.type === "profile" ? (
                      <>
                        {statRow(tWallet("channelFollowers"), String(ch.followers))}
                        {statRow(
                          tWallet("channelNewFollowers"),
                          newFollowers == null ? "—" : String(newFollowers)
                        )}
                        {statRow(tWallet("channelBuyers"), String(ch.buyers))}
                        {statRow(tWallet("channelIncome"), `${formatMoney(ch.net)} MXN`)}
                      </>
                    ) : ch.isSubscription ? (
                      <>
                        {statRow(tWallet("channelSubscribersTotal"), String(ch.memberCount))}
                        {statRow(tWallet("channelNewSubs"), String(ch.newSubs))}
                        {statRow(
                          tWallet("channelSubPrice"),
                          ch.price > 0
                            ? tWallet("channelPerMonth", { price: formatMoney(ch.price) })
                            : "—"
                        )}
                        {statRow(tWallet("channelIncome"), `${formatMoney(ch.net)} MXN`)}
                      </>
                    ) : (
                      <>
                        {statRow(tWallet("channelMembersTotal"), String(ch.memberCount))}
                        {statRow(
                          tWallet("channelNewMembers"),
                          ch.newMembers == null ? "—" : String(ch.newMembers)
                        )}
                        {statRow(tWallet("channelIncome"), `${formatMoney(ch.net)} MXN`)}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
