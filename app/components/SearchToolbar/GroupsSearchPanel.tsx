"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, type User } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";

import { auth, db } from "@/lib/firebase";
import GroupsSearchToolbar from "./GroupsSearchToolbar";

type Community = {
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

type CanonicalMemberStatus = "active" | "muted" | "banned" | "removed" | null;

type GroupsSearchPanelProps = {
  fontStack: string;
  showCreateGroup?: boolean;
  createGroupHref?: string;
  showCloseSearch?: boolean;
  onCloseSearch?: () => void;
};

function normalizeMemberStatus(raw: unknown): CanonicalMemberStatus {
  if (raw === "active") return "active";
  if (raw === "muted") return "muted";
  if (raw === "banned") return "banned";
  if (raw === "removed") return "removed";
  if (raw === "kicked") return "removed";
  if (raw === "expelled") return "removed";
  return null;
}

function isJoinedStatus(status: CanonicalMemberStatus) {
  return status === "active" || status === "muted";
}

function isBlockedStatus(status: CanonicalMemberStatus) {
  return status === "banned" || status === "removed";
}

function membershipStatusLabel(status: CanonicalMemberStatus) {
  if (status === "active") return "Ya estás unido";
  if (status === "muted") return "Ya estás unido (muteado)";
  if (status === "banned") return "Baneado";
  if (status === "removed") return "Expulsado";
  return "";
}

function buildUserSearchText(user: PublicUser) {
  return [
    user.handle,
    user.displayName,
    user.firstName,
    user.lastName,
    `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim(),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function initialsFromName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "";
  const b = parts[1]?.[0] ?? "";
  return (a + b).toUpperCase() || "U";
}

export default function GroupsSearchPanel({
  fontStack,
  showCreateGroup = true,
  createGroupHref = "/groups/new",
  showCloseSearch = false,
  onCloseSearch,
}: GroupsSearchPanelProps) {
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [communitiesLoading, setCommunitiesLoading] = useState(true);
  const [profilesLoading, setProfilesLoading] = useState(true);

  const [communities, setCommunities] = useState<Community[]>([]);
  const [profiles, setProfiles] = useState<PublicUser[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [memberMap, setMemberMap] = useState<
    Record<string, CanonicalMemberStatus>
  >({});
  const [reqMap, setReqMap] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");

  const cardBorder = "1px solid rgba(255,255,255,0.14)";
  const softBorder = "1px solid rgba(255,255,255,0.18)";
  const shadow = "0 18px 46px rgba(0,0,0,0.42)";

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    async function loadCommunities() {
      setError(null);
      setCommunitiesLoading(true);

      try {
        const col = collection(db, "groups");

        const qPublic = query(col, where("visibility", "==", "public"));
        const publicSnap = await getDocs(qPublic);

        const list: Community[] = [];
        publicSnap.forEach((d) => {
          list.push({ id: d.id, ...(d.data() as Record<string, unknown>) });
        });

        if (user) {
          const qPrivate = query(col, where("visibility", "==", "private"));
          const privateSnap = await getDocs(qPrivate);

          privateSnap.forEach((d) => {
            list.push({ id: d.id, ...(d.data() as Record<string, unknown>) });
          });
        }

        const deduped = Array.from(
          new Map(list.map((g) => [g.id, g])).values()
        );

        setCommunities(deduped);
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Error cargando comunidades";
        setError(message);
      } finally {
        setCommunitiesLoading(false);
      }
    }

    void loadCommunities();
  }, [user]);

  useEffect(() => {
    async function loadProfiles() {
      setProfilesLoading(true);

      try {
        const snap = await getDocs(collection(db, "users"));

        const rows: PublicUser[] = snap.docs.map((d) => {
          const data = d.data() as Record<string, unknown>;

          return {
            uid: typeof data.uid === "string" ? data.uid : d.id,
            handle: typeof data.handle === "string" ? data.handle : "",
            displayName:
              typeof data.displayName === "string" ? data.displayName : "",
            firstName:
              typeof data.firstName === "string" ? data.firstName : "",
            lastName: typeof data.lastName === "string" ? data.lastName : "",
            photoURL:
              typeof data.photoURL === "string" ? data.photoURL : null,
          };
        });

        setProfiles(rows);
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Error cargando perfiles";
        setError(message);
      } finally {
        setProfilesLoading(false);
      }
    }

    void loadProfiles();
  }, []);

  useEffect(() => {
    async function loadMembershipsAndRequests() {
      if (!user || communities.length === 0) {
        setMemberMap({});
        setReqMap({});
        return;
      }

      try {
        const entries = await Promise.all(
          communities.map(async (g) => {
            const mref = doc(db, "groups", g.id, "members", user.uid);
            const msnap = await getDoc(mref);

            const membershipStatus = msnap.exists()
              ? normalizeMemberStatus(
                  (msnap.data() as Record<string, unknown>)?.status ?? "active"
                )
              : null;

            const jref = doc(db, "groups", g.id, "joinRequests", user.uid);
            const jsnap = await getDoc(jref);

            const joinRequestData = jsnap.data() as
              | Record<string, unknown>
              | undefined;

            const pending =
              !isJoinedStatus(membershipStatus) &&
              !isBlockedStatus(membershipStatus) &&
              jsnap.exists() &&
              ((joinRequestData?.status ?? "pending") === "pending");

            return {
              groupId: g.id,
              status: membershipStatus,
              hasPendingReq: pending,
            };
          })
        );

        const nextMemberMap: Record<string, CanonicalMemberStatus> = {};
        const nextReqMap: Record<string, boolean> = {};

        for (const entry of entries) {
          nextMemberMap[entry.groupId] = entry.status;
          nextReqMap[entry.groupId] = entry.hasPendingReq;
        }

        setMemberMap(nextMemberMap);
        setReqMap(nextReqMap);
      } catch (e) {
        const message =
          e instanceof Error
            ? e.message
            : "Error leyendo members/joinRequests";
        setError(message);
      }
    }

    void loadMembershipsAndRequests();
  }, [user, communities]);

  const normalizedSearch = search.trim().toLowerCase();

  const filteredCommunities = useMemo(() => {
    if (!normalizedSearch) return [];

    return communities.filter((g) => {
      const haystack = [g.name ?? "", g.visibility ?? ""].join(" ").toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [communities, normalizedSearch]);

  const filteredProfiles = useMemo(() => {
    if (!normalizedSearch) return [];

    return profiles
      .filter((p) => {
        if (!p.handle) return false;
        if (user?.uid && p.uid === user.uid) return false;
        return buildUserSearchText(p).includes(normalizedSearch);
      })
      .slice(0, 12);
  }, [profiles, normalizedSearch, user?.uid]);

  async function handleJoinPublic(groupId: string) {
    if (!user) return;

    try {
      const { joinGroup } = await import("@/lib/groups/membership");
      await joinGroup(groupId, user.uid);

      setMemberMap((prev) => ({
        ...prev,
        [groupId]: "active",
      }));
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "No se pudo unir a la comunidad";
      setError(message);
    }
  }

  async function handleRequestPrivate(groupId: string) {
    if (!user) return;

    try {
      const { requestToJoin } = await import("@/lib/groups/joinRequests");
      await requestToJoin(groupId, user.uid);

      setReqMap((prev) => ({
        ...prev,
        [groupId]: true,
      }));
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "No se pudo enviar solicitud";
      setError(message);
    }
  }

  async function handleCancelRequest(groupId: string) {
    if (!user) return;

    try {
      const { cancelJoinRequest } = await import("@/lib/groups/joinRequests");
      await cancelJoinRequest(groupId, user.uid);

      setReqMap((prev) => ({
        ...prev,
        [groupId]: false,
      }));
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "No se pudo cancelar solicitud";
      setError(message);
    }
  }

  async function handleLeave(groupId: string, ownerId?: string) {
    if (!user) return;

    if (ownerId && ownerId === user.uid) {
      setError("El owner no puede salir de su propia comunidad.");
      return;
    }

    try {
      const { leaveGroup } = await import("@/lib/groups/membership");
      await leaveGroup(groupId, user.uid);

      setMemberMap((prev) => ({
        ...prev,
        [groupId]: null,
      }));
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "No se pudo salir de la comunidad";
      setError(message);
    }
  }

  function handleCloseSearch() {
    setSearch("");
    onCloseSearch?.();
  }

  const isLoading = authLoading || communitiesLoading || profilesLoading;
  const hasSearch = normalizedSearch.length > 0;
  const hasAnyResults =
    filteredCommunities.length > 0 || filteredProfiles.length > 0;

  return (
    <>
      <style jsx>{`
        .search-area {
          position: relative;
          z-index: 60;
          width: 100%;
        }

        .search-dropdown {
          position: absolute;
          top: calc(100% + 10px);
          left: 0;
          right: 0;
          width: 100%;
          border: ${cardBorder};
          border-radius: 20px;
          background: rgba(12, 12, 12, 0.97);
          box-shadow: ${shadow};
          overflow: hidden;
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          z-index: 80;
        }

        .search-dropdown-inner {
          max-height: min(62vh, 560px);
          overflow-y: auto;
        }

        .dropdown-section {
          display: grid;
        }

        .dropdown-section + .dropdown-section {
          border-top: 1px solid rgba(255, 255, 255, 0.08);
        }

        .dropdown-title {
          margin: 0;
          padding: 14px 16px 10px;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: rgba(255, 255, 255, 0.58);
          background: rgba(255, 255, 255, 0.02);
        }

        .dropdown-helper {
          padding: 16px;
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

        .result-item {
          padding: 14px 16px;
          transition: background 0.16s ease;
        }

        .result-item:hover {
          background: rgba(255, 255, 255, 0.035);
        }

        .result-grid {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          gap: 12px;
          align-items: center;
        }

        .result-main-mobile {
          display: contents;
        }

        .result-avatar {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          overflow: hidden;
          border: 1px solid rgba(255, 255, 255, 0.14);
          background: rgba(255, 255, 255, 0.04);
          display: grid;
          place-items: center;
          flex-shrink: 0;
        }

        .result-avatar-fallback {
          font-size: 13px;
          font-weight: 700;
          color: #fff;
        }

        .result-content {
          min-width: 0;
          display: grid;
          gap: 7px;
        }

        .result-name {
          margin: 0;
          font-size: 15px;
          font-weight: 600;
          line-height: 1.2;
          color: #fff;
          overflow-wrap: anywhere;
          word-break: break-word;
        }

        .result-meta {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .pill {
          font-size: 12px;
          padding: 4px 9px;
          border-radius: 999px;
          border: 1px solid rgba(255, 255, 255, 0.14);
          background: rgba(255, 255, 255, 0.05);
          color: rgba(255, 255, 255, 0.88);
          line-height: 1.2;
          white-space: nowrap;
        }

        .pill-paid {
          border: 1px solid rgba(255, 225, 166, 0.26);
          background: rgba(255, 225, 166, 0.1);
          font-weight: 600;
        }

        .meta-inline {
          font-size: 12px;
          color: rgba(255, 255, 255, 0.56);
          line-height: 1.3;
        }

        .meta-danger {
          color: rgba(255, 176, 176, 0.9);
        }

        .actions-wrap {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          flex-wrap: wrap;
        }

        .primary-btn {
          min-height: 38px;
          padding: 8px 12px;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.22);
          background: #fff;
          color: #000;
          cursor: pointer;
          font-weight: 600;
          font-size: 13px;
          font-family: ${fontStack};
          display: inline-flex;
          align-items: center;
          justify-content: center;
          white-space: nowrap;
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
          white-space: nowrap;
        }

        .disabled-btn {
          min-height: 38px;
          padding: 8px 12px;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.14);
          background: rgba(255, 255, 255, 0.05);
          color: rgba(255, 255, 255, 0.68);
          font-weight: 600;
          font-size: 13px;
          font-family: ${fontStack};
          cursor: default;
          white-space: nowrap;
        }

        .profile-cta {
          font-size: 12px;
          color: rgba(255, 255, 255, 0.52);
          white-space: nowrap;
        }

        @media (max-width: 640px) {
          .search-dropdown {
            top: calc(100% + 8px);
            border-radius: 18px;
          }

          .search-dropdown-inner {
            max-height: min(58vh, 460px);
          }

          .dropdown-title {
            padding: 12px 14px 9px;
            font-size: 11px;
          }

          .result-item {
            padding: 13px 14px;
          }

          .result-grid {
            grid-template-columns: 1fr;
            gap: 12px;
            align-items: stretch;
          }

          .result-main-mobile {
            display: flex;
            gap: 12px;
            align-items: flex-start;
            min-width: 0;
          }

          .result-avatar {
            width: 44px;
            height: 44px;
          }

          .result-content {
            min-width: 0;
            flex: 1;
          }

          .result-name {
            font-size: 14px;
          }

          .actions-wrap {
            width: 100%;
            justify-content: stretch;
          }

          .actions-wrap > button {
            flex: 1 1 auto;
          }

          .primary-btn,
          .secondary-btn,
          .disabled-btn {
            min-height: 40px;
          }

          .profile-cta {
            display: none;
          }
        }
      `}</style>

      <div className="search-area">
        <GroupsSearchToolbar
          search={search}
          onSearchChange={setSearch}
          onCreateGroup={
            showCreateGroup ? () => router.push(createGroupHref) : undefined
          }
          onCloseSearch={showCloseSearch ? handleCloseSearch : undefined}
          fontStack={fontStack}
          showCreateGroup={showCreateGroup}
          showCloseSearch={showCloseSearch}
        />

        {hasSearch && (
          <div className="search-dropdown">
            <div className="search-dropdown-inner">
              {isLoading && (
                <div className="dropdown-helper">
                  Buscando comunidades y perfiles...
                </div>
              )}

              {!isLoading && !hasAnyResults && (
                <div className="dropdown-helper">
                  No se encontraron comunidades ni perfiles con ese nombre.
                </div>
              )}

              {!isLoading && filteredCommunities.length > 0 && (
                <section className="dropdown-section">
                  <h2 className="dropdown-title">Comunidades</h2>

                  {filteredCommunities.map((g) => {
                    const isOwner = !!user && !!g.ownerId && g.ownerId === user.uid;
                    const membershipStatus = isOwner
                      ? "active"
                      : memberMap[g.id] ?? null;

                    const isMember = isOwner || isJoinedStatus(membershipStatus);
                    const isBlocked = !isOwner && isBlockedStatus(membershipStatus);

                    const isPrivate = g.visibility === "private";
                    const isPublic = g.visibility === "public";
                    const hasPendingReq = !!reqMap[g.id];

                    const visLabel =
                      g.visibility === "public"
                        ? "Comunidad pública"
                        : g.visibility === "private"
                          ? "Comunidad privada"
                          : "Comunidad oculta";

                    const paid = !!g.monetization?.isPaid;
                    const price = g.monetization?.priceMonthly ?? null;
                    const cur = g.monetization?.currency ?? null;

                    return (
                      <div
                        key={g.id}
                        className="result-item"
                        onClick={() => router.push(`/groups/${g.id}`)}
                      >
                        <div className="result-grid">
                          <div className="result-main-mobile">
                            <div className="result-avatar">
                              {g.avatarUrl ? (
                                <img
                                  src={g.avatarUrl}
                                  alt={g.name ?? "Comunidad"}
                                  style={{
                                    width: "100%",
                                    height: "100%",
                                    objectFit: "cover",
                                  }}
                                />
                              ) : (
                                <span className="result-avatar-fallback">
                                  {initialsFromName(g.name ?? "Comunidad")}
                                </span>
                              )}
                            </div>

                            <div className="result-content">
                              <h3 className="result-name">
                                {g.name ?? "(sin nombre)"}
                              </h3>

                              <div className="result-meta">
                                <span className="pill">{visLabel}</span>

                                {paid && (
                                  <span className="pill pill-paid">
                                    Con suscripción
                                    {price != null ? ` · ${price} ${cur ?? ""}` : ""}
                                  </span>
                                )}

                                {isOwner && (
                                  <span className="meta-inline">(Eres owner)</span>
                                )}

                                {!isOwner && isMember && (
                                  <span className="meta-inline">
                                    ({membershipStatusLabel(membershipStatus)})
                                  </span>
                                )}

                                {!isOwner && isBlocked && (
                                  <span className="meta-inline meta-danger">
                                    ({membershipStatusLabel(membershipStatus)})
                                  </span>
                                )}

                                {!isOwner &&
                                  !isMember &&
                                  !isBlocked &&
                                  isPrivate &&
                                  hasPendingReq && (
                                    <span className="meta-inline">
                                      (Pendiente)
                                    </span>
                                  )}
                              </div>
                            </div>
                          </div>

                          <div
                            className="actions-wrap"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {!isOwner && !isMember && !isBlocked && isPublic && (
                              <button
                                onClick={() => void handleJoinPublic(g.id)}
                                className="primary-btn"
                                type="button"
                              >
                                Unirme
                              </button>
                            )}

                            {!isOwner && !isMember && !isBlocked && isPrivate && (
                              <>
                                {!hasPendingReq ? (
                                  <button
                                    onClick={() => void handleRequestPrivate(g.id)}
                                    className="secondary-btn"
                                    type="button"
                                  >
                                    Solicitar acceso
                                  </button>
                                ) : (
                                  <>
                                    <button
                                      disabled
                                      className="disabled-btn"
                                      type="button"
                                    >
                                      Solicitud enviada
                                    </button>

                                    <button
                                      onClick={() => void handleCancelRequest(g.id)}
                                      className="secondary-btn"
                                      type="button"
                                    >
                                      Cancelar
                                    </button>
                                  </>
                                )}
                              </>
                            )}

                            {isMember && !isOwner && (
                              <button
                                onClick={() => void handleLeave(g.id, g.ownerId)}
                                className="secondary-btn"
                                type="button"
                              >
                                Salir
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </section>
              )}

              {!isLoading && filteredProfiles.length > 0 && (
                <section className="dropdown-section">
                  <h2 className="dropdown-title">Perfiles</h2>

                  {filteredProfiles.map((p) => {
                    const fullName =
                      p.displayName?.trim() ||
                      `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() ||
                      p.handle ||
                      "Usuario";

                    return (
                      <div
                        key={p.uid}
                        className="result-item"
                        onClick={() => router.push(`/u/${p.handle}`)}
                      >
                        <div className="result-grid">
                          <div className="result-main-mobile">
                            <div className="result-avatar">
                              {p.photoURL ? (
                                <img
                                  src={p.photoURL}
                                  alt={fullName}
                                  style={{
                                    width: "100%",
                                    height: "100%",
                                    objectFit: "cover",
                                  }}
                                />
                              ) : (
                                <span className="result-avatar-fallback">
                                  {initialsFromName(fullName)}
                                </span>
                              )}
                            </div>

                            <div className="result-content">
                              <h3 className="result-name">{fullName}</h3>

                              <div className="result-meta">
                                <span className="pill">@{p.handle}</span>
                                <span className="meta-inline">
                                  Ver perfil público
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="profile-cta">Abrir</div>
                        </div>
                      </div>
                    );
                  })}
                </section>
              )}
            </div>
          </div>
        )}

        {error && <div className="error-card">{error}</div>}
      </div>
    </>
  );
}