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

  // auth
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // load my profile
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

  // load groups (public + private if signed in)
  useEffect(() => {
    async function loadGroups() {
      setError(null);
      setLoading(true);
      try {
        const col = collection(db, "groups");

        // público
        const qPublic = query(col, where("visibility", "==", "public"));
        const publicSnap = await getDocs(qPublic);

        const list: Group[] = [];
        publicSnap.forEach((d) => list.push({ id: d.id, ...(d.data() as any) }));

        // privados también visibles si hay sesión (tu regla permite list cuando private && signedIn)
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

  // load memberships/joinRequests map
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

            const pending = jsnap.exists() && (((jsnap.data() as any)?.status ?? "pending") === "pending");
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
      setError(null);
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
      setError(null);
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
      setError(null);
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
      setError(null);
      const { leaveGroup } = await import("../../lib/groups/membership");
      await leaveGroup(groupId, user.uid);
      setMemberMap((m) => ({ ...m, [groupId]: false }));
    } catch (e: any) {
      setError(e?.message ?? "No se pudo salir del grupo");
    }
  }

  function goToMyProfile() {
    if (!profile?.handle) {
      setError("No se encontró tu perfil aún. Termina tu registro o revisa /users/{uid}.");
      return;
    }
    router.push(`/u/${profile.handle}`);
  }

  const myDisplayName =
    profile?.displayName || `${profile?.firstName ?? ""} ${profile?.lastName ?? ""}`.trim() || user?.email || "Mi perfil";

  return (
    <main style={{ padding: 24 }}>
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 900, margin: 0 }}>Explorar grupos</h1>
            <p style={{ marginTop: 6, marginBottom: 0, color: "#666" }}>
              Busca grupos públicos/privados y administra tu membresía.
            </p>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button
              onClick={() => router.push("/groups/new")}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid #111",
                background: "#111",
                color: "#fff",
                cursor: "pointer",
                fontWeight: 800,
              }}
            >
              + Crear grupo
            </button>

            <button
              onClick={goToMyProfile}
              disabled={!user || profileLoading}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid #ddd",
                background: "#fff",
                cursor: !user || profileLoading ? "not-allowed" : "pointer",
                fontWeight: 800,
                display: "flex",
                alignItems: "center",
                gap: 10,
                opacity: !user ? 0.6 : 1,
              }}
              title={!user ? "Inicia sesión para ver tu perfil" : "Ir a mi perfil"}
            >
              <span
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  border: "1px solid #ddd",
                  display: "grid",
                  placeItems: "center",
                  overflow: "hidden",
                  background: "#f5f5f5",
                  fontSize: 12,
                  fontWeight: 900,
                  color: "#555",
                }}
              >
                {profile?.photoURL ? (
                  // eslint-disable-next-line @next/next/no-img-element
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
        <div style={{ marginTop: 18, display: "flex", gap: 12, alignItems: "center" }}>
          <input
            placeholder="Buscar grupo por nombre..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1, padding: 12, borderRadius: 12, border: "1px solid #ddd", outline: "none" }}
          />
        </div>

        {loading && <p style={{ marginTop: 16 }}>Cargando...</p>}

        {error && (
          <div
            style={{
              marginTop: 16,
              padding: 12,
              border: "1px solid #ffd6d6",
              background: "#fff5f5",
              borderRadius: 12,
              color: "#b42318",
            }}
          >
            {error}
          </div>
        )}

        {!loading && !error && (
          <div style={{ marginTop: 18, display: "grid", gap: 12 }}>
            {filteredGroups.length === 0 && <p>No se encontraron grupos.</p>}

            {filteredGroups.map((g) => {
              const isOwner = !!user && !!g.ownerId && g.ownerId === user.uid;
              const isMember = isOwner || !!memberMap[g.id];

              const isPrivate = g.visibility === "private";
              const isPublic = g.visibility === "public";

              const hasPendingReq = !!reqMap[g.id];

              const paid = !!g.monetization?.isPaid;
              const price = g.monetization?.priceMonthly ?? null;
              const cur = g.monetization?.currency ?? null;

              return (
                <div
                  key={g.id}
                  onClick={() => router.push(`/groups/${g.id}`)}
                  style={{
                    padding: 16,
                    border: "1px solid #eaeaea",
                    borderRadius: 16,
                    cursor: "pointer",
                    background: "#fff",
                    boxShadow: "0 1px 0 rgba(0,0,0,0.03)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        <b style={{ fontSize: 16 }}>{g.name ?? "(sin nombre)"}</b>

                        <span
                          style={{
                            fontSize: 12,
                            padding: "3px 8px",
                            borderRadius: 999,
                            border: "1px solid #ddd",
                            color: "#555",
                          }}
                        >
                          {g.visibility ?? "?"}
                        </span>

                        {/* ✅ Badge suscripción */}
                        {paid && (
                          <span
                            style={{
                              fontSize: 12,
                              padding: "3px 8px",
                              borderRadius: 999,
                              border: "1px solid #ffe1a6",
                              background: "#fff7e6",
                              color: "#7a4b00",
                              fontWeight: 800,
                            }}
                          >
                            Con suscripción{price != null ? ` · ${price} ${cur ?? ""}` : ""}
                          </span>
                        )}

                        {isOwner && <span style={{ fontSize: 12, color: "#666" }}>(Eres owner)</span>}
                        {!isOwner && isMember && <span style={{ fontSize: 12, color: "#666" }}>(Ya estás unido)</span>}
                        {!isOwner && !isMember && isPrivate && hasPendingReq && (
                          <span style={{ fontSize: 12, color: "#666" }}>(Pendiente)</span>
                        )}
                      </div>

                      <div style={{ marginTop: 6, color: "#666" }}>{g.description ?? ""}</div>
                      <div style={{ marginTop: 8, fontSize: 12, color: "#aaa" }}>id: {g.id}</div>
                    </div>

                    {/* Actions */}
                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      {!isOwner && !isMember && isPublic && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleJoinPublic(g.id);
                          }}
                          style={{
                            padding: "8px 12px",
                            borderRadius: 10,
                            border: "1px solid #111",
                            background: "#111",
                            color: "#fff",
                            cursor: "pointer",
                            fontWeight: 800,
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
                                borderRadius: 10,
                                border: "1px solid #111",
                                background: "#fff",
                                cursor: "pointer",
                                fontWeight: 800,
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
                                  borderRadius: 10,
                                  border: "1px solid #ddd",
                                  background: "#f5f5f5",
                                  opacity: 0.8,
                                  fontWeight: 800,
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
                                  borderRadius: 10,
                                  border: "1px solid #ddd",
                                  background: "#fff",
                                  cursor: "pointer",
                                  fontWeight: 800,
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
                            borderRadius: 10,
                            border: "1px solid #ddd",
                            background: "#fff",
                            cursor: "pointer",
                            fontWeight: 800,
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