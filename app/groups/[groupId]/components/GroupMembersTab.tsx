  "use client";

import Link from "next/link";
import { CSSProperties, useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, onSnapshot, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

type GroupMembersTabProps = {
  groupId: string;
  isOwner: boolean;
  canMembersViewList: boolean;
};

type MemberDoc = {
  id: string;
  uid?: string;
  role?: string;
  status?: string;
  createdAt?: any;
  joinedAt?: any;
};

type EnrichedMember = MemberDoc & {
  resolvedUid: string;
  displayName: string | null;
  handle: string | null;
  photoURL: string | null;
};

type FilterValue =
  | "all"
  | "active"
  | "muted"
  | "banned"
  | "owner"
  | "mod"
  | "member";

function normalizeRole(role?: string) {
  if (role === "owner") return "owner";
  if (role === "mod") return "mod";
  return "member";
}

function normalizeStatus(status?: string) {
  if (status === "muted") return "muted";
  if (status === "banned") return "banned";
  return "active";
}

function friendlyRole(role?: string) {
  const normalized = normalizeRole(role);
  if (normalized === "owner") return "Owner";
  if (normalized === "mod") return "Moderador";
  return "Miembro";
}

function friendlyStatus(status?: string) {
  const normalized = normalizeStatus(status);
  if (normalized === "muted") return "Muteado";
  if (normalized === "banned") return "Baneado";
  return "Activo";
}

function statusDotColor(status?: string) {
  const normalized = normalizeStatus(status);
  if (normalized === "banned") return "#ff4d4f";
  if (normalized === "muted") return "#f5a623";
  return "#22c55e";
}

function memberInitials(member: EnrichedMember) {
  const raw =
    member.displayName?.trim() ||
    member.handle?.trim() ||
    member.resolvedUid ||
    "U";

  return raw.slice(0, 2).toUpperCase();
}

function memberPrimaryName(member: EnrichedMember) {
  return (
    member.displayName?.trim() ||
    member.handle?.trim() ||
    "Usuario sin nombre"
  );
}

export default function GroupMembersTab({
  groupId,
  isOwner,
  canMembersViewList,
}: GroupMembersTabProps) {
  const [members, setMembers] = useState<EnrichedMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterValue>("all");
  const [savingVisibility, setSavingVisibility] = useState(false);

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

  const safeCanMembersViewList = canMembersViewList === true;
  const canUseFilters = isOwner;
  const canSeeStatus = isOwner;
  const canViewList = isOwner || safeCanMembersViewList;

  useEffect(() => {
    if (!canViewList) {
      setMembers([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    const membersRef = collection(db, "groups", groupId, "members");

    const unsub = onSnapshot(
      membersRef,
      async (snap) => {
        try {
          const rawMembers = snap.docs.map((d) => {
            const data = d.data() as any;
            return {
              id: d.id,
              ...data,
            } as MemberDoc;
          });

          const enriched = await Promise.all(
            rawMembers.map(async (member) => {
              const resolvedUid = member.uid || member.id;

              let displayName: string | null = null;
              let handle: string | null = null;
              let photoURL: string | null = null;

              try {
                const userSnap = await getDoc(doc(db, "users", resolvedUid));
                if (userSnap.exists()) {
                  const userData = userSnap.data() as any;

                  const firstName =
                    typeof userData.firstName === "string"
                      ? userData.firstName.trim()
                      : "";
                  const lastName =
                    typeof userData.lastName === "string"
                      ? userData.lastName.trim()
                      : "";

                  const fullName = `${firstName} ${lastName}`.trim();

                  displayName =
                    (typeof userData.displayName === "string" &&
                      userData.displayName.trim()) ||
                    fullName ||
                    null;

                  handle =
                    (typeof userData.handle === "string" &&
                      userData.handle.trim()) ||
                    null;

                  photoURL =
                    (typeof userData.photoURL === "string" &&
                      userData.photoURL.trim()) ||
                    null;
                }
              } catch (e) {
                console.error("No se pudo leer users/{uid}:", resolvedUid, e);
              }

              return {
                ...member,
                resolvedUid,
                displayName,
                handle,
                photoURL,
              } as EnrichedMember;
            })
          );

          setMembers(enriched);
          setLoading(false);
        } catch (e: any) {
          console.error(e);
          setError(e?.message ?? "No se pudo cargar la lista de integrantes.");
          setLoading(false);
        }
      },
      (e) => {
        console.error(e);
        setError(e?.message ?? "No se pudo cargar la lista de integrantes.");
        setLoading(false);
      }
    );

    return () => unsub();
  }, [groupId, canViewList]);

  const filteredMembers = useMemo(() => {
    const term = search.trim().toLowerCase();

    const list = members.filter((member) => {
      const role = normalizeRole(member.role);
      const status = normalizeStatus(member.status);

      const name = memberPrimaryName(member).toLowerCase();
      const handle = (member.handle || "").toLowerCase();

      const matchesSearch =
        !term || name.includes(term) || handle.includes(term);

      const matchesFilter =
        !canUseFilters || filter === "all"
          ? true
          : filter === "active" ||
            filter === "muted" ||
            filter === "banned"
          ? status === filter
          : role === filter;

      return matchesSearch && matchesFilter;
    });

    return list.sort((a, b) => {
      const roleWeight = (role?: string) => {
        const normalized = normalizeRole(role);
        if (normalized === "owner") return 0;
        if (normalized === "mod") return 1;
        return 2;
      };

      const aw = roleWeight(a.role);
      const bw = roleWeight(b.role);

      if (aw !== bw) return aw - bw;

      const an = memberPrimaryName(a).toLowerCase();
      const bn = memberPrimaryName(b).toLowerCase();

      return an.localeCompare(bn);
    });
  }, [members, search, filter, canUseFilters]);

  async function handleToggleMembersVisibility(nextValue: boolean) {
    if (!isOwner) return;

    setSavingVisibility(true);
    setError(null);

    try {
      await updateDoc(doc(db, "groups", groupId), {
        settings: {
          membersListVisibility: nextValue ? "members" : "owner_only",
        },
      });
    } catch (e: any) {
      console.error(e);
      setError(e?.message ?? "No se pudo actualizar la visibilidad de integrantes.");
    } finally {
      setSavingVisibility(false);
    }
  }

  const wrapStyle: CSSProperties = {
    display: "grid",
    gap: 12,
    fontFamily: fontStack,
  };

  const cardStyle: CSSProperties = {
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.03)",
    padding: 16,
    color: "#fff",
    boxShadow: "0 18px 48px rgba(0,0,0,0.35)",
    backdropFilter: "blur(10px)",
  };

  const titleStyle: CSSProperties = {
    margin: 0,
    fontSize: 16,
    fontWeight: 600,
    lineHeight: 1.2,
    color: "#fff",
  };

  const topRow: CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  };

  const switchWrap: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    color: "rgba(255,255,255,0.78)",
    fontSize: 12,
  };

  const controlsRow: CSSProperties = {
    display: "grid",
    gridTemplateColumns: canUseFilters ? "minmax(0, 1fr) 180px" : "minmax(0, 1fr)",
    gap: 10,
    marginTop: 14,
  };

  const inputStyle: CSSProperties = {
    width: "100%",
    height: 42,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.04)",
    color: "#fff",
    padding: "0 12px",
    outline: "none",
    fontSize: 13,
    fontFamily: fontStack,
    boxSizing: "border-box",
  };

  const selectStyle: CSSProperties = {
    width: "100%",
    height: 42,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "#141414",
    color: "#fff",
    padding: "0 12px",
    outline: "none",
    fontSize: 13,
    fontFamily: fontStack,
    boxSizing: "border-box",
    appearance: "none",
    WebkitAppearance: "none",
    MozAppearance: "none",
  };

  const helperText: CSSProperties = {
    marginTop: 10,
    marginBottom: 0,
    fontSize: 12,
    lineHeight: 1.45,
    color: "rgba(255,255,255,0.62)",
  };

  const listStyle: CSSProperties = {
    display: "grid",
    gap: 10,
    marginTop: 16,
  };

  const rowStyle: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr) auto",
    gap: 12,
    alignItems: "center",
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.02)",
    padding: 14,
  };

  const avatarStyle: CSSProperties = {
    width: 48,
    height: 48,
    borderRadius: "50%",
    overflow: "hidden",
    display: "grid",
    placeItems: "center",
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.10)",
    color: "#fff",
    fontSize: 13,
    fontWeight: 700,
    flexShrink: 0,
  };

  const centerColStyle: CSSProperties = {
    minWidth: 0,
  };

  const nameLinkStyle: CSSProperties = {
    fontSize: 13,
    fontWeight: 600,
    color: "#fff",
    textDecoration: "none",
    lineHeight: 1.3,
    display: "inline-block",
  };

  const namePlainStyle: CSSProperties = {
    fontSize: 13,
    fontWeight: 600,
    color: "#fff",
    lineHeight: 1.3,
  };

  const rightMetaWrap: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 14,
    justifySelf: "end",
  };

  const dividerStyle: CSSProperties = {
    width: 1,
    height: 28,
    background: "rgba(255,255,255,0.12)",
  };

  const statusWrap: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    minWidth: 78,
    justifyContent: "flex-start",
    fontSize: 12,
    color: "rgba(255,255,255,0.72)",
    whiteSpace: "nowrap",
  };

  const roleWrap: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 104,
    marginRight: 10,
  };

  const roleBadge: CSSProperties = {
    minWidth: 92,
    textAlign: "center",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.05)",
    padding: "10px 14px",
    fontSize: 12,
    color: "#fff",
    whiteSpace: "nowrap",
  };

  const emptyStyle: CSSProperties = {
    marginTop: 16,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.03)",
    padding: 14,
    fontSize: 12,
    color: "rgba(255,255,255,0.72)",
  };

  return (
    <div style={wrapStyle}>
      <section style={cardStyle}>
        <div style={topRow}>
          <h2 style={titleStyle}>Integrantes del grupo</h2>

          {isOwner && (
            <label style={switchWrap}>
              <input
                type="checkbox"
                checked={safeCanMembersViewList}
                disabled={savingVisibility}
                onChange={(e) => handleToggleMembersVisibility(e.target.checked)}
              />
              <span>Permitir que los miembros vean esta lista</span>
            </label>
          )}
        </div>

        <div style={controlsRow}>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre o username"
            style={inputStyle}
          />

          {canUseFilters && (
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as FilterValue)}
              style={selectStyle}
            >
              <option value="all" style={{ background: "#141414", color: "#fff" }}>
                Todos
              </option>
              <option value="active" style={{ background: "#141414", color: "#fff" }}>
                Activos
              </option>
              <option value="muted" style={{ background: "#141414", color: "#fff" }}>
                Muteados
              </option>
              <option value="banned" style={{ background: "#141414", color: "#fff" }}>
                Baneados
              </option>
              <option value="owner" style={{ background: "#141414", color: "#fff" }}>
                Owner
              </option>
              <option value="mod" style={{ background: "#141414", color: "#fff" }}>
                Moderadores
              </option>
              <option value="member" style={{ background: "#141414", color: "#fff" }}>
                Miembros
              </option>
            </select>
          )}
        </div>

        {isOwner && (
          <p style={helperText}>
            Cuando esta opción está desactivada, solo tú podrás ver la lista de integrantes.
          </p>
        )}

        {!canViewList && !isOwner && (
          <div style={emptyStyle}>
            El owner de esta comunidad no permite que otros miembros vean la lista de integrantes.
          </div>
        )}

        {canViewList && loading && <div style={emptyStyle}>Cargando integrantes...</div>}

        {canViewList && !loading && error && <div style={emptyStyle}>{error}</div>}

        {canViewList && !loading && !error && filteredMembers.length === 0 && (
          <div style={emptyStyle}>No encontramos integrantes con ese criterio.</div>
        )}

        {canViewList && !loading && !error && filteredMembers.length > 0 && (
          <div style={listStyle}>
            {filteredMembers.map((member) => {
              const displayName = memberPrimaryName(member);
              const statusText = friendlyStatus(member.status);
              const roleText = friendlyRole(member.role);
              const dotColor = statusDotColor(member.status);

              return (
                <div key={member.id} style={rowStyle}>
                  <div style={avatarStyle}>
                    {member.photoURL ? (
                      <img
                        src={member.photoURL}
                        alt={displayName}
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                        }}
                      />
                    ) : (
                      <span>{memberInitials(member)}</span>
                    )}
                  </div>

                  <div style={centerColStyle}>
                    {member.handle ? (
                      <Link
                        href={`/u/${member.handle}`}
                        style={nameLinkStyle}
                        title={`Ir al perfil de ${displayName}`}
                      >
                        {displayName}
                      </Link>
                    ) : (
                      <div style={namePlainStyle}>{displayName}</div>
                    )}
                  </div>

                  <div style={rightMetaWrap}>
                    {canSeeStatus && (
                      <>
                        <div style={dividerStyle} />

                        <div style={statusWrap}>
                          <span
                            aria-hidden="true"
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              background: dotColor,
                              display: "inline-block",
                              flexShrink: 0,
                            }}
                          />
                          <span>{statusText}</span>
                        </div>
                      </>
                    )}

                    <div style={roleWrap}>
                      <div style={roleBadge}>{roleText}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}