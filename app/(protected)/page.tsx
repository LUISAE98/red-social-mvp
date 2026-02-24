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
};

export default function HomePage() {
  const router = useRouter();

  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [user, setUser] = useState<any>(null);
  const [authReady, setAuthReady] = useState(false);

  const [search, setSearch] = useState("");

  // groupId -> es miembro?
  const [memberMap, setMemberMap] = useState<Record<string, boolean>>({});

  // groupId -> tiene joinRequest pending?
  const [reqMap, setReqMap] = useState<Record<string, boolean>>({});

  // debug (primer grupo)
  const [myRole, setMyRole] = useState<string | null>(null);
  const [myStatus, setMyStatus] = useState<string | null>(null);

  // 1) sesión
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // 2) grupos public + private (no hidden)
  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);

      try {
        const q = query(collection(db, "groups"), where("visibility", "in", ["public", "private"]));
        const snap = await getDocs(q);

        const data: Group[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        }));

        setGroups(data);
      } catch (e: any) {
        setError(e?.message ?? "Error leyendo Firestore");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  // 3) membership + joinRequests por grupo
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

  // 4) debug primer grupo
  useEffect(() => {
    async function loadMyMembership() {
      if (!user) {
        setMyRole(null);
        setMyStatus(null);
        return;
      }

      const firstGroupId = groups?.[0]?.id;
      if (!firstGroupId) {
        setMyRole(null);
        setMyStatus(null);
        return;
      }

      try {
        const ref = doc(db, "groups", firstGroupId, "members", user.uid);
        const snap = await getDoc(ref);

        if (!snap.exists()) {
          setMyRole(null);
          setMyStatus(null);
          return;
        }

        const data = snap.data() as any;
        setMyRole(data.role ?? null);
        setMyStatus(data.status ?? null);
      } catch (e: any) {
        setError(e?.message ?? "Error leyendo rol en members");
      }
    }

    loadMyMembership();
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

  return (
    <main style={{ padding: 24, maxWidth: 900 }}>
      <h1 style={{ fontSize: 26, fontWeight: 700 }}>Explorar grupos</h1>

      <div style={{ marginTop: 16, display: "flex", gap: 12 }}>
        <input
          placeholder="Buscar grupo por nombre..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid #ccc" }}
        />

        <button
          onClick={() => router.push("/groups/new")}
          style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #444", cursor: "pointer" }}
        >
          + Crear grupo
        </button>
      </div>

      {loading && <p style={{ marginTop: 16 }}>Cargando...</p>}

      {error && (
        <p style={{ color: "red", marginTop: 16 }}>
          Error: {error}
        </p>
      )}

      {!loading && !error && (
        <ul style={{ marginTop: 20, paddingLeft: 0, listStyle: "none" }}>
          {filteredGroups.length === 0 && <p>No se encontraron grupos.</p>}

          {filteredGroups.map((g) => {
            const isOwner = !!user && !!g.ownerId && g.ownerId === user.uid;

            // owner cuenta como miembro efectivo
            const isMember = isOwner || !!memberMap[g.id];

            const isPrivate = g.visibility === "private";
            const isPublic = g.visibility === "public";

            const hasPendingReq = !!reqMap[g.id];

            return (
              <li key={g.id} style={{ padding: 16, border: "1px solid #ddd", borderRadius: 10, marginBottom: 12 }}>
                <div style={{ cursor: "pointer" }} onClick={() => router.push(`/groups/${g.id}`)}>
                  <div>
                    <b>{g.name ?? "(sin nombre)"}</b> — <small>{g.visibility ?? "?"}</small>
                  </div>
                  <div style={{ opacity: 0.8 }}>{g.description ?? ""}</div>
                  <div style={{ fontSize: 12, opacity: 0.6 }}>id: {g.id}</div>
                </div>

                <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center" }}>
                  {/* PUBLIC: Unirme directo */}
                  {!isOwner && !isMember && isPublic && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleJoinPublic(g.id);
                      }}
                      style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #444", cursor: "pointer" }}
                    >
                      Unirme
                    </button>
                  )}

                  {/* PRIVATE: solicitar acceso / cancelar solicitud */}
                  {!isOwner && !isMember && isPrivate && (
                    <>
                      {!hasPendingReq ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRequestPrivate(g.id);
                          }}
                          style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #444", cursor: "pointer" }}
                        >
                          Solicitar acceso
                        </button>
                      ) : (
                        <>
                          <button
                            disabled
                            style={{
                              padding: "8px 12px",
                              borderRadius: 8,
                              border: "1px solid #444",
                              opacity: 0.6,
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
                              borderRadius: 8,
                              border: "1px solid #ccc",
                              cursor: "pointer",
                            }}
                          >
                            Cancelar solicitud
                          </button>
                        </>
                      )}
                    </>
                  )}

                  {/* Salir: si soy miembro y no soy owner */}
                  {isMember && !isOwner && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleLeave(g.id, g.ownerId);
                      }}
                      style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #ccc", cursor: "pointer" }}
                    >
                      Salir
                    </button>
                  )}

                  {/* etiquetas */}
                  {isOwner && <span style={{ fontSize: 12, opacity: 0.75 }}>(Eres owner)</span>}
                  {!isOwner && isMember && <span style={{ fontSize: 12, opacity: 0.75 }}>(Ya estás unido)</span>}
                  {!isOwner && !isMember && isPrivate && hasPendingReq && (
                    <span style={{ fontSize: 12, opacity: 0.75 }}>(Pendiente)</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <hr style={{ margin: "32px 0" }} />

      <section style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>Mi sesión</h2>

        {authReady && !user && (
          <p style={{ marginTop: 8 }}>
            Ve a <a href="/login">/login</a> para iniciar sesión.
          </p>
        )}

        {user && (
          <div style={{ marginTop: 8 }}>
            <p><b>UID:</b> {user.uid}</p>
            <p><b>Email:</b> {user.email}</p>
            <p><b>Rol (primer grupo):</b> {myRole ?? "(no miembro)"}</p>
            <p><b>Status:</b> {myStatus ?? "(n/a)"}</p>
          </div>
        )}
      </section>
    </main>
  );
}