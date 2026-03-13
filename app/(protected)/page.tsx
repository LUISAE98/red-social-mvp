"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  getDocs,
  query,
  where,
  doc,
  getDoc,
} from "firebase/firestore";
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

export default function GroupsHome() {
  const router = useRouter();

  const [user, setUser] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [groupsLoading, setGroupsLoading] = useState(true);

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
    padding: "12px 0 calc(118px + env(safe-area-inset-bottom))",
    background: "#000",
    minHeight: "100vh",
    color: "#fff",
    fontFamily: fontStack,
  };

  const container: React.CSSProperties = {
    maxWidth: 1080,
    margin: "0 auto",
    width: "100%",
    padding: "0 12px",
    boxSizing: "border-box",
  };

  const cardBorder = "1px solid rgba(255,255,255,0.14)";
  const softBorder = "1px solid rgba(255,255,255,0.18)";
  const fieldBorder = "1px solid rgba(255,255,255,0.18)";
  const surface = "rgba(12,12,12,0.90)";
  const fieldBg = "rgba(255,255,255,0.045)";
  const fieldBgFocus = "rgba(255,255,255,0.065)";
  const shadow = "0 18px 46px rgba(0,0,0,0.42)";

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
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
      setGroupsLoading(true);

      try {
        const col = collection(db, "groups");

        const qPublic = query(col, where("visibility", "==", "public"));
        const publicSnap = await getDocs(qPublic);

        const list: Group[] = [];
        publicSnap.forEach((d) => list.push({ id: d.id, ...(d.data() as any) }));

        if (user) {
          const qPrivate = query(col, where("visibility", "==", "private"));
          const privateSnap = await getDocs(qPrivate);
          privateSnap.forEach((d) =>
            list.push({ id: d.id, ...(d.data() as any) })
          );
        }

        const deduped = Array.from(
          new Map(list.map((g) => [g.id, g])).values()
        );

        setGroups(deduped);
      } catch (e: any) {
        setError(e?.message ?? "Error cargando grupos");
      } finally {
        setGroupsLoading(false);
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
              jsnap.exists() &&
              (((jsnap.data() as any)?.status ?? "pending") === "pending");

            return {
              groupId: g.id,
              isMember: msnap.exists(),
              hasPendingReq: pending,
            };
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

  const normalizedSearch = search.trim().toLowerCase();

  const filteredGroups = useMemo(() => {
    if (!normalizedSearch) return [];

    return groups.filter((g) =>
      (g.name ?? "").toLowerCase().includes(normalizedSearch)
    );
  }, [groups, normalizedSearch]);

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

  const isLoading = authLoading || groupsLoading;

  return (
    <main style={pageWrap}>
      <style jsx>{`
        .home-shell {
          width: 100%;
        }

        .search-toolbar {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 10px;
          align-items: center;
        }

        .search-input {
          width: 100%;
          height: 46px;
          padding: 0 14px;
          border-radius: 14px;
          border: ${fieldBorder};
          background: ${fieldBg};
          color: #fff;
          outline: none;
          font-size: 14px;
          box-sizing: border-box;
          transition: border-color 0.18s ease, background 0.18s ease;
        }

        .search-input:focus {
          border-color: rgba(255, 255, 255, 0.28);
          background: ${fieldBgFocus};
        }

        .create-btn {
          height: 46px;
          padding: 0 16px;
          border-radius: 14px;
          border: 1px solid rgba(255, 255, 255, 0.22);
          background: #fff;
          color: #000;
          cursor: pointer;
          font-weight: 600;
          font-size: 14px;
          font-family: ${fontStack};
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          white-space: nowrap;
          flex-shrink: 0;
        }

        .create-btn-mobile-text {
          display: none;
        }

        .helper-card {
          margin-top: 16px;
          padding: 16px;
          border-radius: 18px;
          border: ${cardBorder};
          background: rgba(255, 255, 255, 0.03);
          color: rgba(255, 255, 255, 0.76);
          font-size: 14px;
          line-height: 1.45;
        }

        .error-card {
          margin-top: 14px;
          padding: 12px 14px;
          border-radius: 14px;
          border: 1px solid rgba(255, 255, 255, 0.14);
          background: rgba(255, 255, 255, 0.05);
          color: #fff;
          font-size: 13px;
          line-height: 1.45;
        }

        .results-wrap {
          margin-top: 16px;
          display: grid;
          gap: 12px;
        }

        .group-card {
          padding: 15px;
          border: ${cardBorder};
          border-radius: 18px;
          cursor: pointer;
          background: ${surface};
          box-shadow: ${shadow};
          transition: transform 0.16s ease, border-color 0.16s ease,
            background 0.16s ease;
        }

        .group-card:hover {
          transform: translateY(-1px);
          border-color: rgba(255, 255, 255, 0.22);
        }

        .group-row {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          gap: 12px;
          align-items: center;
        }

        .group-avatar {
          width: 46px;
          height: 46px;
          border-radius: 50%;
          overflow: hidden;
          border: 1px solid rgba(255, 255, 255, 0.16);
          background: rgba(255, 255, 255, 0.04);
          display: grid;
          place-items: center;
          flex-shrink: 0;
        }

        .group-main {
          min-width: 0;
        }

        .group-main-wrap {
          display: contents;
        }

        .group-name-row {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          min-width: 0;
        }

        .group-name {
          font-size: 16px;
          font-weight: 600;
          line-height: 1.2;
          color: #fff;
          word-break: break-word;
        }

        .group-meta {
          margin-top: 7px;
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .pill {
          font-size: 12px;
          padding: 4px 9px;
          border-radius: 999px;
          border: 1px solid rgba(255, 255, 255, 0.16);
          background: rgba(255, 255, 255, 0.05);
          line-height: 1.2;
          white-space: nowrap;
        }

        .pill-paid {
          border: 1px solid rgba(255, 225, 166, 0.28);
          background: rgba(255, 225, 166, 0.1);
          font-weight: 600;
        }

        .status-inline {
          font-size: 12px;
          color: rgba(255, 255, 255, 0.58);
          line-height: 1.3;
        }

        .group-actions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          flex-wrap: wrap;
        }

        .secondary-btn {
          min-height: 38px;
          padding: 8px 12px;
          border-radius: 12px;
          border: ${softBorder};
          background: rgba(255, 255, 255, 0.06);
          color: #fff;
          cursor: pointer;
          font-weight: 600;
          font-size: 13px;
          font-family: ${fontStack};
        }

        .disabled-btn {
          min-height: 38px;
          padding: 8px 12px;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.14);
          background: rgba(255, 255, 255, 0.05);
          color: rgba(255, 255, 255, 0.72);
          font-weight: 600;
          font-size: 13px;
          font-family: ${fontStack};
          cursor: default;
        }

        @media (max-width: 640px) {
          .search-toolbar {
            grid-template-columns: minmax(0, 1fr) 46px;
            gap: 8px;
          }

          .create-btn {
            width: 46px;
            min-width: 46px;
            padding: 0;
            border-radius: 14px;
            font-size: 20px;
            line-height: 1;
          }

          .create-btn-desktop-text {
            display: none;
          }

          .create-btn-mobile-text {
            display: inline;
          }

          .group-card {
            padding: 14px 12px;
            border-radius: 18px;
          }

          .group-row {
            grid-template-columns: 1fr;
            align-items: stretch;
            gap: 12px;
          }

          .group-main-wrap {
            display: flex;
            gap: 12px;
            align-items: flex-start;
            min-width: 0;
          }

          .group-avatar {
            width: 44px;
            height: 44px;
          }

          .group-actions {
            width: 100%;
            justify-content: stretch;
          }

          .group-actions > button {
            flex: 1 1 auto;
          }

          .secondary-btn,
          .disabled-btn {
            min-height: 40px;
          }
        }
      `}</style>

      <div style={container} className="home-shell">
        <div className="search-toolbar">
          <input
            placeholder="Buscar grupo o perfil por nombre..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="search-input"
          />

          <button
            onClick={() => router.push("/groups/new")}
            className="create-btn"
            aria-label="Crear grupo"
            title="Crear grupo"
          >
            <span className="create-btn-mobile-text">+</span>
            <span className="create-btn-desktop-text">+ Crear grupo</span>
          </button>
        </div>

        {error && <div className="error-card">{error}</div>}

        {!error && !normalizedSearch && (
          <div className="helper-card">
            Escribe el nombre de un grupo para ver resultados.
          </div>
        )}

        {!error && normalizedSearch && isLoading && (
          <div className="helper-card">Buscando grupos...</div>
        )}

        {!error && normalizedSearch && !isLoading && filteredGroups.length === 0 && (
          <div className="helper-card">
            No se encontraron grupos con ese nombre.
          </div>
        )}

        {!isLoading && !error && filteredGroups.length > 0 && (
          <div className="results-wrap">
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
                  className="group-card"
                >
                  <div className="group-row">
                    <div className="group-main-wrap">
                      <div className="group-avatar">
                        {g.avatarUrl ? (
                          <img
                            src={g.avatarUrl}
                            alt="avatar"
                            style={{
                              width: "100%",
                              height: "100%",
                              objectFit: "cover",
                            }}
                          />
                        ) : null}
                      </div>

                      <div className="group-main">
                        <div className="group-name-row">
                          <span className="group-name">
                            {g.name ?? "(sin nombre)"}
                          </span>
                        </div>

                        <div className="group-meta">
                          <span className="pill">{visLabel}</span>

                          {paid && (
                            <span className="pill pill-paid">
                              Con suscripción
                              {price != null ? ` · ${price} ${cur ?? ""}` : ""}
                            </span>
                          )}

                          {isOwner && (
                            <span className="status-inline">(Eres owner)</span>
                          )}

                          {!isOwner && isMember && (
                            <span className="status-inline">
                              (Ya estás unido)
                            </span>
                          )}

                          {!isOwner && !isMember && isPrivate && hasPendingReq && (
                            <span className="status-inline">(Pendiente)</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div
                      className="group-actions"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {!isOwner && !isMember && isPublic && (
                        <button
                          onClick={() => handleJoinPublic(g.id)}
                          className="create-btn"
                          style={{ height: 38, padding: "0 12px", fontSize: 13 }}
                        >
                          Unirme
                        </button>
                      )}

                      {!isOwner && !isMember && isPrivate && (
                        <>
                          {!hasPendingReq ? (
                            <button
                              onClick={() => handleRequestPrivate(g.id)}
                              className="secondary-btn"
                            >
                              Solicitar acceso
                            </button>
                          ) : (
                            <>
                              <button disabled className="disabled-btn">
                                Solicitud enviada
                              </button>

                              <button
                                onClick={() => handleCancelRequest(g.id)}
                                className="secondary-btn"
                              >
                                Cancelar
                              </button>
                            </>
                          )}
                        </>
                      )}

                      {isMember && !isOwner && (
                        <button
                          onClick={() => handleLeave(g.id, g.ownerId)}
                          className="secondary-btn"
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