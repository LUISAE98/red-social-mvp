"use client";

import type {
  GroupDocLite,
  JoinRequestRow,
  OutgoingJoinRequestRow,
  UserMini,
} from "./OwnerSidebar";
import { Chevron, CountBadge } from "./OwnerSidebar";

type Props = {
  loadingCommunities: boolean;
  joinedGroups: GroupDocLite[];
  pendingJoinRequestsSent: OutgoingJoinRequestRow[];
  browseGroups: GroupDocLite[];
  joinedGrouped: Array<{ key: string; title: string; items: GroupDocLite[] }>;
  browseGrouped: Array<{ key: string; title: string; items: GroupDocLite[] }>;
  groupMetaMap: Record<string, GroupDocLite>;
  styles: Record<string, React.CSSProperties>;
  fmtDate: (ts?: any) => string;
  renderCommunityCard: (
    g: GroupDocLite,
    opts?: { compact?: boolean; subtitle?: React.ReactNode }
  ) => React.ReactNode;
  joinRequestsByGroup: Record<string, JoinRequestRow[]>;
  joinSectionOpen: Record<string, boolean>;
  setJoinSectionOpen: React.Dispatch<
    React.SetStateAction<Record<string, boolean>>
  >;
  handleApproveJoin: (groupId: string, userId: string) => Promise<void>;
  handleRejectJoin: (groupId: string, userId: string) => Promise<void>;
  joinBusyKey: string | null;
  userMiniMap: Record<string, UserMini>;
  getInitials: (name?: string | null) => string;
  renderUserLink: (uid: string) => React.ReactNode;
};

type SidebarMemberStatus =
  | "active"
  | "muted"
  | "banned"
  | "removed"
  | null;

type SidebarMemberRole = "owner" | "mod" | "member" | null;

function normalizeMemberStatus(group: GroupDocLite): SidebarMemberStatus {
  const raw = (group as any)?.memberStatus ?? (group as any)?.status ?? null;

  if (raw === "active") return "active";
  if (raw === "muted") return "muted";
  if (raw === "banned") return "banned";
  if (raw === "removed") return "removed";

  if (raw === "kicked") return "removed";
  if (raw === "expelled") return "removed";

  return null;
}

function normalizeMemberRole(group: GroupDocLite): SidebarMemberRole {
  const raw = (group as any)?.memberRole ?? (group as any)?.roleInGroup ?? null;

  if (raw === "owner") return "owner";
  if (raw === "mod" || raw === "moderator") return "mod";
  if (raw === "member") return "member";
  return null;
}

function isVisibleJoinedStatus(status: SidebarMemberStatus) {
  return status === "active" || status === "muted" || status === "banned";
}

function isActuallyJoinedStatus(status: SidebarMemberStatus) {
  return status === "active" || status === "muted";
}

function statusDotColor(status?: SidebarMemberStatus) {
  if (status === "muted") return "#f5a623";
  if (status === "banned") return "#ef4444";
  if (status === "removed") return "#b91c1c";
  return "#22c55e";
}

function statusLabel(status?: SidebarMemberStatus) {
  if (status === "muted") return "Muteado";
  if (status === "banned") return "Baneado";
  if (status === "removed") return "Expulsado";
  return "Activo";
}

function roleLabel(role?: SidebarMemberRole) {
  if (role === "mod") return "Moderador";
  if (role === "owner") return "Owner";
  return "Miembro";
}

function buildJoinedSubtitle(
  group: GroupDocLite,
  isMobile: boolean
): React.ReactNode {
  const status = normalizeMemberStatus(group);
  const role = normalizeMemberRole(group);
  const statusText = statusLabel(status);
  const dotColor = statusDotColor(status);

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: isMobile ? 5 : 7,
        fontSize: isMobile ? 9.5 : 11.5,
        color: "rgba(255,255,255,0.68)",
        lineHeight: 1,
        whiteSpace: "nowrap",
        minWidth: 0,
        flexWrap: "wrap",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: isMobile ? 7 : 8,
          height: isMobile ? 7 : 8,
          borderRadius: "50%",
          background: dotColor,
          display: "inline-block",
          flexShrink: 0,
        }}
      />
      <span>{statusText}</span>

      {role === "mod" && (
        <>
          <span
            aria-hidden="true"
            style={{
              color: "rgba(255,255,255,0.34)",
              flexShrink: 0,
            }}
          >
            •
          </span>
          <span>{roleLabel(role)}</span>
        </>
      )}
    </span>
  );
}

export default function OwnerSidebarOtherGroups({
  loadingCommunities,
  pendingJoinRequestsSent,
  joinedGrouped,
  groupMetaMap,
  styles,
  fmtDate,
  renderCommunityCard,
  joinRequestsByGroup,
  joinSectionOpen,
  setJoinSectionOpen,
  handleApproveJoin,
  handleRejectJoin,
  joinBusyKey,
  userMiniMap,
  getInitials,
  renderUserLink,
}: Props) {
  const isMobile =
    typeof window !== "undefined" ? window.innerWidth <= 640 : false;

  const visibleJoinedGrouped = joinedGrouped
    .map((section) => ({
      ...section,
      items: section.items.filter((g) =>
        isVisibleJoinedStatus(normalizeMemberStatus(g))
      ),
    }))
    .filter((section) => section.items.length > 0);

  const visiblePendingJoinRequestsSent = pendingJoinRequestsSent.filter((row) => {
    const community = groupMetaMap[row.groupId] ?? null;
    if (!community) {
      return true;
    }

    const status = normalizeMemberStatus(community);

    return !isActuallyJoinedStatus(status);
  });

  const hasAnyJoined = visibleJoinedGrouped.length > 0;
  const hasAnyPending = visiblePendingJoinRequestsSent.length > 0;

  return (
    <>
      {visibleJoinedGrouped.map((section) => (
        <div key={`joined-${section.key}`} style={{ display: "grid", gap: 8 }}>
          <div style={styles.sectionTitle}>{section.title}</div>

          <div style={{ display: "grid", gap: 8 }}>
            {section.items.map((g) => {
              const role = normalizeMemberRole(g);
              const isMod = role === "mod";
              const joinRequests = joinRequestsByGroup[g.id] ?? [];
              const showJoinSection =
                isMod &&
                g.visibility !== "public" &&
                joinRequests.length > 0;
              const joinListOpen = joinSectionOpen[g.id] === true;
              const communityName = g.name ?? "(Sin nombre)";
              const avatarFallback = getInitials(communityName);

              if (!showJoinSection) {
                return renderCommunityCard(g, {
                  subtitle: buildJoinedSubtitle(g, isMobile),
                });
              }

              return (
                <div
                  key={g.id}
                  style={{
                    ...styles.card,
                    display: "grid",
                    gap: 9,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {}}
                      style={{
                        background: "transparent",
                        border: "none",
                        padding: 0,
                        color: "#fff",
                        textAlign: "left",
                        cursor: "default",
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        minWidth: 0,
                        flex: 1,
                      }}
                    >
                      {g.avatarUrl ? (
                        <img
                          src={g.avatarUrl}
                          alt={communityName}
                          style={{
                            width: 30,
                            height: 30,
                            borderRadius: "50%",
                            objectFit: "cover",
                            border: "1px solid rgba(255,255,255,0.10)",
                            flexShrink: 0,
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            width: 30,
                            height: 30,
                            borderRadius: "50%",
                            background: "rgba(255,255,255,0.06)",
                            border: "1px solid rgba(255,255,255,0.10)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 11,
                            fontWeight: 700,
                            color: "#fff",
                            flexShrink: 0,
                          }}
                        >
                          {avatarFallback}
                        </div>
                      )}

                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: "#fff",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {communityName}
                        </div>

                        <div style={styles.subtle}>
                          {buildJoinedSubtitle(g, isMobile)}
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        setJoinSectionOpen((prev) => ({
                          ...prev,
                          [g.id]: !prev[g.id],
                        }))
                      }
                      aria-label={
                        joinListOpen
                          ? "Cerrar solicitudes de acceso"
                          : "Abrir solicitudes de acceso"
                      }
                      style={{
                        minWidth: 52,
                        height: 28,
                        borderRadius: 999,
                        border: "1px solid rgba(255,255,255,0.08)",
                        background: "rgba(255,255,255,0.02)",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 6,
                        cursor: "pointer",
                        flexShrink: 0,
                        padding: "0 8px",
                      }}
                    >
                      <CountBadge count={joinRequests.length} tone="blue" />
                      <Chevron open={joinListOpen} />
                    </button>
                  </div>

                  {joinListOpen && (
                    <div style={styles.sectionPanel}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 12,
                            color: "#fff",
                            fontWeight: 700,
                          }}
                        >
                          Solicitudes de acceso
                        </span>
                        <CountBadge count={joinRequests.length} tone="blue" />
                      </div>

                      <div className="mini-vertical-scroll">
                        <div style={{ display: "grid", gap: 7 }}>
                          {joinRequests.map((r) => {
                            const approveKey = `${g.id}:${r.userId}:approve`;
                            const rejectKey = `${g.id}:${r.userId}:reject`;
                            const busy =
                              joinBusyKey === approveKey ||
                              joinBusyKey === rejectKey;
                            const requester = userMiniMap[r.userId] ?? null;
                            const letter = getInitials(requester?.displayName);

                            return (
                              <div key={r.id} style={styles.miniItem}>
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                    minWidth: 0,
                                  }}
                                >
                                  {requester?.photoURL ? (
                                    <img
                                      src={requester.photoURL}
                                      alt={requester.displayName}
                                      style={{
                                        width: 28,
                                        height: 28,
                                        borderRadius: 10,
                                        objectFit: "cover",
                                        border:
                                          "1px solid rgba(255,255,255,0.12)",
                                        flexShrink: 0,
                                      }}
                                    />
                                  ) : (
                                    <div
                                      style={{
                                        width: 28,
                                        height: 28,
                                        borderRadius: 10,
                                        background: "rgba(255,255,255,0.05)",
                                        border:
                                          "1px solid rgba(255,255,255,0.12)",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        fontWeight: 700,
                                        fontSize: 11,
                                        color: "#fff",
                                        flexShrink: 0,
                                      }}
                                    >
                                      {letter}
                                    </div>
                                  )}

                                  <div style={{ minWidth: 0 }}>
                                    <div
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 6,
                                        minWidth: 0,
                                        flexWrap: "wrap",
                                      }}
                                    >
                                      {renderUserLink(r.userId)}
                                    </div>
                                    <div style={styles.subtle}>
                                      Solicitud pendiente
                                    </div>
                                  </div>
                                </div>

                                <div
                                  style={{
                                    display: "flex",
                                    gap: 8,
                                    flexWrap: "wrap",
                                  }}
                                >
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleApproveJoin(g.id, r.userId)
                                    }
                                    disabled={busy}
                                    style={{
                                      ...styles.buttonPrimary,
                                      opacity: busy ? 0.8 : 1,
                                      cursor: busy ? "not-allowed" : "pointer",
                                    }}
                                  >
                                    {busy ? "Procesando..." : "Aprobar"}
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleRejectJoin(g.id, r.userId)
                                    }
                                    disabled={busy}
                                    style={{
                                      ...styles.buttonSecondary,
                                      opacity: busy ? 0.7 : 1,
                                      cursor: busy ? "not-allowed" : "pointer",
                                    }}
                                  >
                                    {busy ? "Procesando..." : "Rechazar"}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {hasAnyPending && (
        <div style={{ display: "grid", gap: 8 }}>
          <div style={styles.sectionTitle}>Solicitudes de acceso enviadas</div>
          <div style={{ display: "grid", gap: 8 }}>
            {visiblePendingJoinRequestsSent.map((row) => {
              const community = groupMetaMap[row.groupId] ?? null;
              if (!community) return null;

              return renderCommunityCard(community, {
                subtitle: row.createdAt
                  ? `Solicitud pendiente · ${fmtDate(row.createdAt)}`
                  : "Solicitud pendiente",
              });
            })}
          </div>
        </div>
      )}

      {!loadingCommunities && !hasAnyJoined && !hasAnyPending && (
        <div
          style={{
            fontSize: 12,
            color: "rgba(255,255,255,0.58)",
            padding: "2px 2px 0",
          }}
        >
          No tienes otras comunidades ni solicitudes pendientes.
        </div>
      )}
    </>
  );
}