"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where, doc, getDoc } from "firebase/firestore";
import { db, auth } from "../../lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { useRouter } from "next/navigation";

type Group = {
  id: string;
  name?: string;
  description?: string;
  avatarUrl?: string | null;
  visibility?: "public" | "private" | "hidden" | string;
  ownerId?: string;
  monetization?: {
    isPaid?: boolean;
    priceMonthly?: number | null;
    currency?: string | null;
  };
};

type PublicUser = {
  uid: string;
  handle: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  photoURL?: string | null;
};

function initials(name: string) {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "";
  const b = parts[1]?.[0] ?? "";
  return (a + b).toUpperCase();
}

export default function GroupsHome() {
  const router = useRouter();

  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const [profile, setProfile] = useState<PublicUser | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  const [groups, setGroups] = useState<Group[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [memberMap, setMemberMap] = useState<Record<string, boolean>>({});
  const [reqMap, setReqMap] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

  const pageWrap: React.CSSProperties = {
    padding: 24,
    background: "#000",
    minHeight: "100vh",
    color: "#fff",
    fontFamily: fontStack,
  };

  const container: React.CSSProperties = {
    maxWidth: 860,
    margin: "0 auto",
    width: "100%",
  };

  const cardBorder = "1px solid rgba(255,255,255,0.18)";
  const softBorder = "1px solid rgba(255,255,255,0.22)";
  const fieldBorder = "1px solid rgba(255,255,255,0.30)";
  const surface = "rgba(12,12,12,0.90)";
  const fieldBg = "rgba(0,0,0,0.32)";

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    async function loadProfile() {
      if (!user) {
        setProfile(null);
        return;
      }
      setProfileLoading(true);
      try {
        const ref = doc(db, "users", user.uid);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          setProfile(null);
          return;
        }
        setProfile(snap.data() as any);
      } catch (e: any) {
        setError(e?.message ?? "Error leyendo perfil");
      } finally {
        setProfileLoading(false);
      }
    }
    loadProfile();
  }, [user]);

  useEffect(() => {
    async function loadGroups() {
      setError(null);
      setLoading(true);
      try {
        const col = collection(db, "groups");

        const qPublic = query(col, where("visibility", "==", "public"));
        const publicSnap = await getDocs(qPublic);

        const list: Group[] = [];
        publicSnap.forEach((d) => list.push({ id: d.id, ...(d.data() as any) }));

        if (user) {
          const qPrivate = query(col, where("visibility", "==", "private"));
          const privateSnap = await getDocs(qPrivate);
          privateSnap.forEach((d) => list.push({ id: d.id, ...(d.data() as any) }));
        }

        setGroups(list);
      } catch (e: any) {
        setError(e?.message ?? "Error cargando grupos");
      } finally {
        setLoading(false);
      }
    }

    loadGroups();
  }, [user]);

  useEffect(() => {
    async function loadMembershipsAndRequests() {
      if (!user || groups.length === 0) {
        setMemberMap({});
        setReqMap({});
        return;
      }

      try {
        const entries = await Promise.all(
          groups.map(async (g) => {
            const mref = doc(db, "groups", g.id, "members", user.uid);
            const msnap = await getDoc(mref);

            const jref = doc(db, "groups", g.id, "joinRequests", user.uid);
            const jsnap = await getDoc(jref);

            const pending =
              jsnap.exists() && (((jsnap.data() as any)?.status ?? "pending") === "pending");

            return { groupId: g.id, isMember: msnap.exists(), hasPendingReq: pending };
          })
        );

        const m: Record<string, boolean> = {};
        const r: Record<string, boolean> = {};

        for (const e of entries) {
          m[e.groupId] = e.isMember;
          r[e.groupId] = e.hasPendingReq;
        }

        setMemberMap(m);
        setReqMap(r);
      } catch (e: any) {
        setError(e?.message ?? "Error leyendo members/joinRequests");
      }
    }

    loadMembershipsAndRequests();
  }, [user, groups]);

  const filteredGroups = useMemo(() => {
    if (!search.trim()) return groups;
    const s = search.toLowerCase();
    return groups.filter((g) => (g.name ?? "").toLowerCase().includes(s));
  }, [groups, search]);

  async function handleJoinPublic(groupId: string) {
    if (!user) return;
    try {
      const { joinGroup } = await import("../../lib/groups/membership");
      await joinGroup(groupId, user.uid);
      setMemberMap((m) => ({ ...m, [groupId]: true }));
    } catch (e: any) {
      setError(e?.message ?? "No se pudo unir al grupo");
    }
  }

  async function handleRequestPrivate(groupId: string) {
    if (!user) return;
    try {
      const { requestToJoin } = await import("../../lib/groups/joinRequests");
      await requestToJoin(groupId, user.uid);
      setReqMap((r) => ({ ...r, [groupId]: true }));
    } catch (e: any) {
      setError(e?.message ?? "No se pudo enviar solicitud");
    }
  }

  async function handleCancelRequest(groupId: string) {
    if (!user) return;
    try {
      const { cancelJoinRequest } = await import("../../lib/groups/joinRequests");
      await cancelJoinRequest(groupId, user.uid);
      setReqMap((r) => ({ ...r, [groupId]: false }));
    } catch (e: any) {
      setError(e?.message ?? "No se pudo cancelar solicitud");
    }
  }

  async function handleLeave(groupId: string, ownerId?: string) {
    if (!user) return;

    if (ownerId && ownerId === user.uid) {
      setError("El owner no puede salir de su propio grupo.");
      return;
    }

    try {
      const { leaveGroup } = await import("../../lib/groups/membership");
      await leaveGroup(groupId, user.uid);
      setMemberMap((m) => ({ ...m, [groupId]: false }));
    } catch (e: any) {
      setError(e?.message ?? "No se pudo salir del grupo");
    }
  }

  function goToMyProfile() {
    if (!profile?.handle) {
      setError("No se encontró tu perfil aún.");
      return;
    }
    router.push(`/u/${profile.handle}`);
  }

  const myDisplayName =
    profile?.displayName ||
    `${profile?.firstName ?? ""} ${profile?.lastName ?? ""}`.trim() ||
    user?.email ||
    "Mi perfil";

  return (
    <main style={pageWrap}>
      <div style={container}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ fontSize: 28, fontWeight: 600, margin: 0, letterSpacing: -0.2 }}>Explorar grupos</h1>
            <p style={{ marginTop: 6, marginBottom: 0, color: "rgba(255,255,255,0.76)", fontSize: 14 }}>
              Busca grupos públicos/privados y administra tu membresía.
            </p>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button
              onClick={() => router.push("/groups/new")}
              style={{
                padding: "10px 14px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.28)",
                background: "#fff",
                color: "#000",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              + Crear grupo
            </button>

            <button
              onClick={goToMyProfile}
              disabled={!user || profileLoading}
              style={{
                padding: "10px 14px",
                borderRadius: 12,
                border: softBorder,
                background: "rgba(255,255,255,0.06)",
                color: "#fff",
                cursor: !user || profileLoading ? "not-allowed" : "pointer",
                fontWeight: 600,
                fontSize: 14,
                display: "flex",
                alignItems: "center",
                gap: 10,
                opacity: !user ? 0.55 : 1,
              }}
            >
              <span
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  border: "1px solid rgba(255,255,255,0.26)",
                  display: "grid",
                  placeItems: "center",
                  overflow: "hidden",
                  background: "rgba(0,0,0,0.35)",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "rgba(255,255,255,0.86)",
                }}
              >
                {profile?.photoURL ? (
                  <img src={profile.photoURL} alt="me" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  initials(myDisplayName)
                )}
              </span>

              <span>Mi perfil</span>
            </button>
          </div>
        </div>

        {/* Search */}
        <div style={{ marginTop: 18 }}>
          <input
            placeholder="Buscar grupo por nombre..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: "100%",
              padding: "11px 12px",
              borderRadius: 12,
              border: fieldBorder,
              background: fieldBg,
              color: "#fff",
              outline: "none",
              fontSize: 14,
            }}
          />
        </div>

        {!loading && !error && (
          <div style={{ marginTop: 18, display: "grid", gap: 12 }}>
            {filteredGroups.map((g) => {
              const isOwner = !!user && !!g.ownerId && g.ownerId === user.uid;
              const isMember = isOwner || !!memberMap[g.id];

              const isPrivate = g.visibility === "private";
              const isPublic = g.visibility === "public";

              const hasPendingReq = !!reqMap[g.id];

              const paid = !!g.monetization?.isPaid;
              const price = g.monetization?.priceMonthly ?? null;
              const cur = g.monetization?.currency ?? null;

              const visLabel =
                g.visibility === "public"
                  ? "Grupo público"
                  : g.visibility === "private"
                  ? "Grupo privado"
                  : "Grupo oculto";

              return (
                <div
                  key={g.id}
                  onClick={() => router.push(`/groups/${g.id}`)}
                  style={{
                    padding: 16,
                    border: cardBorder,
                    borderRadius: 16,
                    cursor: "pointer",
                    background: surface,
                    boxShadow: "0 14px 40px rgba(0,0,0,0.35)",
                  }}
                >
                  <div style={{ display: "flex", gap: 12 }}>
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: "50%",
                        overflow: "hidden",
                        border: "1px solid rgba(255,255,255,0.22)",
                        background: "rgba(0,0,0,0.35)",
                        display: "grid",
                        placeItems: "center",
                        flexShrink: 0,
                      }}
                    >
                      {g.avatarUrl && (
                        <img
                          src={g.avatarUrl}
                          alt="avatar"
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                          }}
                        />
                      )}
                    </div>

                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        <span style={{ fontSize: 16, fontWeight: 600 }}>{g.name ?? "(sin nombre)"}</span>

                        <span
                          style={{
                            fontSize: 12,
                            padding: "3px 8px",
                            borderRadius: 999,
                            border: "1px solid rgba(255,255,255,0.24)",
                            background: "rgba(255,255,255,0.06)",
                          }}
                        >
                          {visLabel}
                        </span>

                        {paid && (
                          <span
                            style={{
                              fontSize: 12,
                              padding: "3px 8px",
                              borderRadius: 999,
                              border: "1px solid rgba(255, 225, 166, 0.40)",
                              background: "rgba(255, 225, 166, 0.10)",
                              fontWeight: 600,
                            }}
                          >
                            Con suscripción{price != null ? ` · ${price} ${cur ?? ""}` : ""}
                          </span>
                        )}

                        {isOwner && <span style={{ fontSize: 12, color: "rgba(255,255,255,0.62)" }}>(Eres owner)</span>}
                        {!isOwner && isMember && (
                          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.62)" }}>(Ya estás unido)</span>
                        )}
                        {!isOwner && !isMember && isPrivate && hasPendingReq && (
                          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.62)" }}>(Pendiente)</span>
                        )}
                      </div>

                      <div style={{ marginTop: 6, color: "rgba(255,255,255,0.76)", fontSize: 14 }}>
                        {g.description ?? ""}
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      {!isOwner && !isMember && isPublic && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleJoinPublic(g.id);
                          }}
                          style={{
                            padding: "8px 12px",
                            borderRadius: 12,
                            border: "1px solid rgba(255,255,255,0.28)",
                            background: "#fff",
                            color: "#000",
                            cursor: "pointer",
                            fontWeight: 600,
                            fontSize: 14,
                          }}
                        >
                          Unirme
                        </button>
                      )}

                      {!isOwner && !isMember && isPrivate && (
                        <>
                          {!hasPendingReq ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRequestPrivate(g.id);
                              }}
                              style={{
                                padding: "8px 12px",
                                borderRadius: 12,
                                border: "1px solid rgba(255,255,255,0.26)",
                                background: "rgba(255,255,255,0.06)",
                                color: "#fff",
                                cursor: "pointer",
                                fontWeight: 600,
                                fontSize: 14,
                              }}
                            >
                              Solicitar acceso
                            </button>
                          ) : (
                            <>
                              <button
                                disabled
                                style={{
                                  padding: "8px 12px",
                                  borderRadius: 12,
                                  border: "1px solid rgba(255,255,255,0.22)",
                                  background: "rgba(255,255,255,0.05)",
                                  color: "rgba(255,255,255,0.75)",
                                  fontWeight: 600,
                                  fontSize: 14,
                                }}
                              >
                                Solicitud enviada
                              </button>

                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCancelRequest(g.id);
                                }}
                                style={{
                                  padding: "8px 12px",
                                  borderRadius: 12,
                                  border: "1px solid rgba(255,255,255,0.26)",
                                  background: "rgba(255,255,255,0.06)",
                                  color: "#fff",
                                  cursor: "pointer",
                                  fontWeight: 600,
                                  fontSize: 14,
                                }}
                              >
                                Cancelar
                              </button>
                            </>
                          )}
                        </>
                      )}

                      {isMember && !isOwner && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleLeave(g.id, g.ownerId);
                          }}
                          style={{
                            padding: "8px 12px",
                            borderRadius: 12,
                            border: "1px solid rgba(255,255,255,0.26)",
                            background: "rgba(255,255,255,0.06)",
                            color: "#fff",
                            cursor: "pointer",
                            fontWeight: 600,
                            fontSize: 14,
                          }}
                        >
                          Salir
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}