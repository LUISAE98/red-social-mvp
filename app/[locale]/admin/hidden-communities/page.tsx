"use client";

import { useEffect, useState } from "react";
import {
  collection,
  query,
  where,
  onSnapshot,
  Timestamp,
  getDoc,
  doc,
  getCountFromServer,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAdminPreview } from "../context";
import { useTranslations } from "next-intl";

type Community = {
  id: string;
  name: string | null;
  description: string | null;
  avatarUrl: string | null;
  memberCount: number | null;
  postsCount: number | null;
  livesCount: number | null;
  createdAt: Date | null;
  modVerified: boolean;
  ownerId: string | null;
  creatorName: string | null;
  creatorAvatar: string | null;
  creatorHandle: string | null;
};

type FireCommunity = {
  name?: string;
  description?: string;
  avatarUrl?: string;
  imageUrl?: string;
  createdAt?: Timestamp;
  modVerified?: boolean;
  visibility?: string;
  ownerId?: string;
};

type FireUser = {
  displayName?: string;
  photoURL?: string;
  handle?: string;
  username?: string;
};

function toCommunityBase(
  id: string,
  d: FireCommunity,
): Omit<Community, "postsCount" | "livesCount" | "memberCount" | "creatorName" | "creatorAvatar" | "creatorHandle"> {
  return {
    id,
    name: d.name ?? null,
    description: d.description ?? null,
    avatarUrl: d.avatarUrl ?? d.imageUrl ?? null,
    createdAt: d.createdAt?.toDate() ?? null,
    modVerified: d.modVerified ?? false,
    ownerId: d.ownerId ?? null,
  };
}

function rel(date: Date, t: (key: string, params?: Record<string, string | number | Date>) => string): string {
  const m = Math.floor((Date.now() - date.getTime()) / 60000);
  if (m < 1) return t("timeNow");
  if (m < 60) return t("timeMinutesAgo", { count: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t("timeHoursAgo", { count: h });
  return date.toLocaleString("es-MX", { dateStyle: "medium" });
}

type Tab = "unverified" | "verified";

export default function HiddenCommunitiesPage() {
  const { setPreviewUrl } = useAdminPreview();
  const tAdmin = useTranslations("admin");
  const [tab, setTab] = useState<Tab>("unverified");
  type CommunityBase = Omit<Community, "postsCount" | "livesCount" | "memberCount" | "creatorName" | "creatorAvatar" | "creatorHandle">;

  const [bases, setBases] = useState<CommunityBase[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [loading, setLoading] = useState(true);
  const [enriching, setEnriching] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [enrichKey, setEnrichKey] = useState(0);

  // Phase 1: subscribe to group documents (base data only)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    const q = query(
      collection(db, "groups"),
      where("visibility", "==", "hidden"),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setBases(snap.docs.map((d) => toCommunityBase(d.id, d.data() as FireCommunity)));
        setLoading(false);
      },
      () => setLoading(false),
    );
    return () => unsub();
  }, []);

  // Phase 2: enrich with counts — re-runs when base data changes OR when refreshed manually
  useEffect(() => {
    if (bases.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCommunities([]);
      return;
    }
    let cancelled = false;
    setEnriching(true);

    Promise.all(
      bases.map(async (c) => {
        const [postsSnap, livesSnap, membersSnap, creatorSnap] = await Promise.all([
          getCountFromServer(
            query(collection(db, "posts"), where("groupId", "==", c.id)),
          ).catch(() => null),
          getCountFromServer(
            query(
              collection(db, "posts"),
              where("groupId", "==", c.id),
              where("postType", "==", "live"),
            ),
          ).catch(() => null),
          getCountFromServer(
            collection(db, "groups", c.id, "members"),
          ).catch(() => null),
          c.ownerId
            ? getDoc(doc(db, "users", c.ownerId)).catch(() => null)
            : Promise.resolve(null),
        ]);

        const creatorData = creatorSnap?.exists()
          ? (creatorSnap.data() as FireUser)
          : null;

        return {
          ...c,
          postsCount: postsSnap?.data().count ?? null,
          livesCount: livesSnap?.data().count ?? null,
          memberCount: membersSnap?.data().count ?? null,
          creatorName: creatorData?.displayName ?? null,
          creatorAvatar: creatorData?.photoURL ?? null,
          creatorHandle: creatorData?.handle ?? creatorData?.username ?? null,
        } satisfies Community;
      }),
    ).then((enriched) => {
      if (cancelled) return;
      const sorted = enriched.sort(
        (a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0),
      );
      setCommunities(sorted);
      setEnriching(false);
    }).catch(() => {
      if (!cancelled) setEnriching(false);
    });

    return () => { cancelled = true; };
  }, [bases, enrichKey]);

  function selectCommunity(c: Community) {
    setSelectedId(c.id);
    setPreviewUrl(`/groups/${c.id}`);
  }

  function selectCreator(c: Community, e: React.MouseEvent) {
    e.stopPropagation();
    if (!c.creatorHandle) return;
    setSelectedId(null);
    setPreviewUrl(`/u/${c.creatorHandle}`);
  }

  const filtered = communities.filter((c) =>
    tab === "unverified" ? !c.modVerified : c.modVerified,
  );

  return (
    <div>
      <div style={{ marginBottom: 20, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: "#fff", margin: 0 }}>
            {tAdmin("hiddenCommunitiesTitle")}
          </h1>
          <p style={{ fontSize: 12, color: "#444", margin: "4px 0 0" }}>
            {tAdmin("hiddenCommunitiesSubtitle")}
          </p>
        </div>
        <button
          onClick={() => setEnrichKey((k) => k + 1)}
          disabled={enriching}
          title={tAdmin("refreshCounters")}
          style={{
            flexShrink: 0,
            marginTop: 2,
            padding: "5px 8px",
            borderRadius: 6,
            border: "1px solid #2a2a2a",
            background: "transparent",
            color: enriching ? "#333" : "#555",
            cursor: enriching ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            gap: 5,
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            style={{ flexShrink: 0, animation: enriching ? "spin 1s linear infinite" : "none" }}
          >
            <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
            <path d="M21 3v5h-5" />
            <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
            <path d="M8 16H3v5" />
          </svg>
          {enriching ? tAdmin("refreshing") : tAdmin("refresh")}
        </button>
        <style jsx>{`
          @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        `}</style>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
        {(["unverified", "verified"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "5px 12px",
              borderRadius: 6,
              border: `1px solid ${tab === t ? "#a855f7" : "#2a2a2a"}`,
              background: tab === t ? "#1a0a2a" : "transparent",
              color: tab === t ? "#d8b4fe" : "#555",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {t === "unverified" ? tAdmin("tabUnverified") : tAdmin("tabVerified")}
            <span
              style={{
                marginLeft: 5,
                fontSize: 10,
                background: tab === t ? "#2d1557" : "#1a1a1a",
                color: tab === t ? "#c084fc" : "#444",
                padding: "1px 5px",
                borderRadius: 3,
              }}
            >
              {communities.filter((c) =>
                t === "unverified" ? !c.modVerified : c.modVerified,
              ).length}
            </span>
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ color: "#444", fontSize: 13 }}>Cargando...</div>
      ) : filtered.length === 0 ? (
        <div style={{ color: "#444", fontSize: 13 }}>
          {tab === "unverified"
            ? tAdmin("noUnverifiedCommunities")
            : tAdmin("noVerifiedCommunities")}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.map((c) => {
            const isSelected = selectedId === c.id;
            return (
              <div
                key={c.id}
                onClick={() => selectCommunity(c)}
                style={{
                  background: isSelected ? "#0f0a1f" : "#0d0d0d",
                  border: `1px solid ${isSelected ? "#7c3aed" : "#1a1a1a"}`,
                  borderRadius: 10,
                  padding: "14px",
                  cursor: "pointer",
                  transition: "border-color 150ms, background 150ms",
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) {
                    (e.currentTarget as HTMLDivElement).style.borderColor = "#2d2d2d";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) {
                    (e.currentTarget as HTMLDivElement).style.borderColor = "#1a1a1a";
                  }
                }}
              >
                {/* Top: avatar + title */}
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  {c.avatarUrl ? (
                    <img
                      src={c.avatarUrl}
                      alt={c.name ?? tAdmin("communityAltText")}
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 8,
                        objectFit: "cover",
                        flexShrink: 0,
                        background: "#1a1a1a",
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 8,
                        background: "#1a1a1a",
                        flexShrink: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 18,
                        color: "#2a2a2a",
                      }}
                    >
                      #
                    </div>
                  )}

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>
                        {c.name ?? tAdmin("communityNameFallback")}
                      </span>
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 600,
                          padding: "1px 5px",
                          borderRadius: 3,
                          background: c.modVerified ? "#14532d" : "#1c0f00",
                          color: c.modVerified ? "#86efac" : "#f59e0b",
                        }}
                      >
                        {c.modVerified ? tAdmin("badgeVerified") : tAdmin("badgeUnverified")}
                      </span>
                    </div>
                    {c.description && (
                      <div
                        style={{
                          fontSize: 11,
                          color: "#666",
                          marginTop: 3,
                          lineHeight: 1.4,
                          overflow: "hidden",
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                        }}
                      >
                        {c.description}
                      </div>
                    )}
                  </div>
                </div>

                {/* Stats */}
                <div
                  style={{
                    display: "flex",
                    marginTop: 10,
                    borderTop: "1px solid #1a1a1a",
                    paddingTop: 10,
                    gap: 0,
                  }}
                >
                  {[
                    { label: tAdmin("statPosts"), value: c.postsCount },
                    { label: tAdmin("statLives"), value: c.livesCount },
                    { label: tAdmin("statMembers"), value: c.memberCount },
                  ].map((stat, i) => (
                    <div
                      key={stat.label}
                      style={{
                        flex: 1,
                        textAlign: "center",
                        borderLeft: i > 0 ? "1px solid #1a1a1a" : "none",
                      }}
                    >
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#e2e2e2" }}>
                        {stat.value !== null
                          ? stat.value.toLocaleString("es-MX")
                          : "—"}
                      </div>
                      <div style={{ fontSize: 10, color: "#444", marginTop: 1 }}>
                        {stat.label}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Meta: date + uid */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginTop: 8,
                    flexWrap: "wrap",
                    gap: 4,
                  }}
                >
                  <span style={{ fontSize: 10, color: "#444" }}>
                    {c.createdAt ? rel(c.createdAt, tAdmin) : "—"}
                  </span>
                  <span
                    style={{
                      fontSize: 9,
                      fontFamily: "monospace",
                      color: "#333",
                      background: "#0a0a0a",
                      padding: "2px 6px",
                      borderRadius: 3,
                      border: "1px solid #181818",
                    }}
                  >
                    {c.id}
                  </span>
                </div>

                {/* Creator */}
                <div
                  onClick={(e) => selectCreator(c, e)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    marginTop: 10,
                    paddingTop: 10,
                    borderTop: "1px solid #1a1a1a",
                    cursor: c.creatorHandle ? "pointer" : "default",
                    opacity: c.creatorHandle ? 1 : 0.6,
                  }}
                  title={c.creatorHandle ? tAdmin("viewCreatorProfile", { name: c.creatorName ?? "" }) : undefined}
                >
                  {c.creatorAvatar ? (
                    <img
                      src={c.creatorAvatar}
                      alt={c.creatorName ?? tAdmin("creatorAltText")}
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: "50%",
                        objectFit: "cover",
                        background: "#1a1a1a",
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: "50%",
                        background: "#1a1a1a",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 10,
                        color: "#333",
                      }}
                    >
                      ?
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 10, color: "#444" }}>{tAdmin("creatorLabel")}</span>
                    <span
                      style={{
                        fontSize: 11,
                        color: c.creatorHandle ? "#a78bfa" : "#777",
                        fontWeight: 600,
                      }}
                    >
                      {c.creatorName ?? c.ownerId ?? tAdmin("creatorNameFallback")}
                    </span>
                    {c.creatorHandle && (
                      <span style={{ fontSize: 10, color: "#555", marginLeft: 4 }}>
                        @{c.creatorHandle}
                      </span>
                    )}
                  </div>
                  {c.creatorHandle && (
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#444"
                      strokeWidth="2"
                      style={{ flexShrink: 0 }}
                    >
                      <path d="M7 17L17 7M17 7H7M17 7v10" />
                    </svg>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
