"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

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
  | "subscribed"
  | "muted"
  | "banned"
  | "removed"
  | null;

type SidebarMemberRole = "owner" | "mod" | "member" | null;

type AccessState =
  | "joined"
  | "legacy_free"
  | "subscribed"
  | "requires_subscription"
  | "banned";

type NoticeTone = "warning" | "success" | "info" | "danger";

const DISMISSED_GROUPS_STORAGE_KEY =
  "vibra_owner_sidebar_dismissed_transition_groups";

function normalizeMemberStatus(group: GroupDocLite): SidebarMemberStatus {
  const raw = group?.memberStatus ?? null;

  if (raw === "active") return "active";
  if (raw === "subscribed") return "subscribed";
  if (raw === "muted") return "muted";
  if (raw === "banned") return "banned";
  if (raw === "removed") return "removed";

  return null;
}

function normalizeMemberRole(group: GroupDocLite): SidebarMemberRole {
  const raw = group?.memberRole ?? null;

  if (raw === "owner") return "owner";
  if (raw === "mod") return "mod";
  if (raw === "member") return "member";

  return null;
}

function isVisibleJoinedStatus(status: SidebarMemberStatus) {
  return (
    status === "active" ||
    status === "subscribed" ||
    status === "muted" ||
    status === "banned"
  );
}

function isActuallyJoinedStatus(status: SidebarMemberStatus) {
  return (
    status === "active" ||
    status === "subscribed" ||
    status === "muted"
  );
}

function statusDotColor(status?: SidebarMemberStatus) {
  if (status === "subscribed") return "#38bdf8";
  if (status === "muted") return "#f5a623";
  if (status === "banned") return "#ef4444";
  if (status === "removed") return "#b91c1c";
  return "#22c55e";
}

function statusLabel(status?: SidebarMemberStatus) {
  if (status === "subscribed") return "Suscrito";
  if (status === "muted") return "Muteado";
  if (status === "banned") return "Baneado";
  if (status === "removed") return "Sin acceso";
  return "Activo";
}

function roleLabel(role?: SidebarMemberRole) {
  if (role === "mod") return "Moderador";
  if (role === "owner") return "Owner";
  return "Miembro";
}

function groupHasPaidSubscription(group: GroupDocLite) {
  const monetization = group?.monetization ?? {};

  return (
    monetization?.subscriptionsEnabled === true ||
    monetization?.isPaid === true ||
    (typeof monetization?.subscriptionPriceMonthly === "number" &&
      monetization.subscriptionPriceMonthly > 0) ||
    (typeof monetization?.priceMonthly === "number" &&
      monetization.priceMonthly > 0)
  );
}

function resolveAccessState(group: GroupDocLite): AccessState {
  if (group.sidebarState === "legacy_free") return "legacy_free";
  if (group.sidebarState === "requires_subscription") {
    return "requires_subscription";
  }
  if (group.sidebarState === "banned") return "banned";

  if (
    group.membershipAccessType === "legacy_free" ||
    group.legacyComplimentary === true
  ) {
    return "legacy_free";
  }

  if (
    group.membershipAccessType === "subscription" ||
    group.membershipAccessType === "subscribed" ||
    group.memberStatus === "subscribed" ||
    group.subscriptionActive === true
  ) {
    return "subscribed";
  }

  if (group.requiresSubscription === true) {
    return "requires_subscription";
  }

  if (normalizeMemberStatus(group) === "banned") {
    return "banned";
  }

  return "joined";
}

function isJoinedLikeState(state: AccessState) {
  return (
    state === "joined" ||
    state === "legacy_free" ||
    state === "subscribed" ||
    state === "banned"
  );
}

function shouldShowGroup(group: GroupDocLite, dismissedIds: Set<string>) {
  return true;
}

function buildJoinedSubtitle(
  group: GroupDocLite,
  isMobile: boolean
): React.ReactNode {
  const status = normalizeMemberStatus(group);
  const role = normalizeMemberRole(group);
  const statusText = statusLabel(status);
  const dotColor = statusDotColor(status);
  const accessState = resolveAccessState(group);

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
            style={{ color: "rgba(255,255,255,0.34)", flexShrink: 0 }}
          >
            •
          </span>
          <span>{roleLabel(role)}</span>
        </>
      )}

      {accessState === "legacy_free" && (
        <>
          <span
            aria-hidden="true"
            style={{ color: "rgba(255,255,255,0.34)", flexShrink: 0 }}
          >
            •
          </span>
          <span style={{ color: "#86efac" }}>Acceso legado gratis</span>
        </>
      )}

      {accessState === "subscribed" && (
        <>
          <span
            aria-hidden="true"
            style={{ color: "rgba(255,255,255,0.34)", flexShrink: 0 }}
          >
            •
          </span>
          <span style={{ color: "#93c5fd" }}>Suscripción activa</span>
        </>
      )}

      {accessState === "requires_subscription" && (
        <>
          <span
            aria-hidden="true"
            style={{ color: "rgba(255,255,255,0.34)", flexShrink: 0 }}
          >
            •
          </span>
          <span style={{ color: "#fbbf24" }}>Debes suscribirte</span>
        </>
      )}
    </span>
  );
}

function buildAccessNotice(
  group: GroupDocLite
):
  | {
      title?: string;
      text: string;
      tone: NoticeTone;
      showSubscribeCta?: boolean;
      showDismissCta?: boolean;
    }
  | null {
  const state = resolveAccessState(group);

  if (state === "requires_subscription") {
    return {
      title: "Acceso pendiente de suscripción",
      text: "Esta comunidad ahora requiere suscripción. Como tu acceso anterior ya no es suficiente, debes suscribirte para continuar dentro.",
      tone: "warning",
      showSubscribeCta: true,
      showDismissCta: false,
    };
  }

  if (state === "legacy_free") {
    return {
      title: "Acceso conservado",
      text: "Esta comunidad ahora es de suscripción, pero conservas acceso gratis porque ya estabas dentro antes del cambio.",
      tone: "success",
      showSubscribeCta: false,
      showDismissCta: false,
    };
  }

  if (state === "subscribed") {
    return {
      title: "Suscripción activa",
      text: "Tu acceso a esta comunidad está activo mediante suscripción.",
      tone: "info",
      showSubscribeCta: false,
      showDismissCta: false,
    };
  }

  if (state === "banned") {
    return {
      title: "Acceso restringido",
      text: "No puedes interactuar normalmente en esta comunidad porque tu estado actual está restringido.",
      tone: "danger",
      showSubscribeCta: false,
      showDismissCta: false,
    };
  }

  return null;
}

function noticeStyles(tone: NoticeTone, isMobile: boolean): React.CSSProperties {
  return {
    borderRadius: 10,
    border:
      tone === "warning"
        ? "1px solid rgba(251,191,36,0.28)"
        : tone === "success"
        ? "1px solid rgba(134,239,172,0.22)"
        : tone === "danger"
        ? "1px solid rgba(252,165,165,0.24)"
        : "1px solid rgba(147,197,253,0.22)",
    background:
      tone === "warning"
        ? "rgba(251,191,36,0.08)"
        : tone === "success"
        ? "rgba(134,239,172,0.08)"
        : tone === "danger"
        ? "rgba(252,165,165,0.08)"
        : "rgba(147,197,253,0.08)",
    padding: "8px 10px",
    fontSize: isMobile ? 10 : 11,
    lineHeight: 1.35,
    color:
      tone === "warning"
        ? "rgba(255,235,180,0.96)"
        : tone === "success"
        ? "rgba(220,255,230,0.96)"
        : tone === "danger"
        ? "rgba(255,220,220,0.96)"
        : "rgba(220,236,255,0.96)",
    display: "grid",
    gap: 6,
  };
}

function renderJoinedCardWithAccessNotice(params: {
  group: GroupDocLite;
  isMobile: boolean;
  renderCommunityCard: (
    g: GroupDocLite,
    opts?: { compact?: boolean; subtitle?: React.ReactNode }
  ) => React.ReactNode;
  onSubscribe: (groupId: string) => void;
  onDismiss: (groupId: string) => void;
}) {
  const { group, isMobile, renderCommunityCard, onSubscribe, onDismiss } = params;
  const notice = buildAccessNotice(group);

  return (
    <div
      key={group.id}
      style={{
        display: "grid",
        gap: notice ? 6 : 0,
      }}
    >
      {renderCommunityCard(group, {
        subtitle: buildJoinedSubtitle(group, isMobile),
      })}

      {notice && (
        <div style={noticeStyles(notice.tone, isMobile)}>
          {notice.title ? <div style={{ fontWeight: 700 }}>{notice.title}</div> : null}
          <div>{notice.text}</div>

          {(notice.showSubscribeCta || notice.showDismissCta) && (
            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                marginTop: 2,
              }}
            >
              {notice.showSubscribeCta && (
                <button
                  type="button"
                  onClick={() => onSubscribe(group.id)}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.16)",
                    background: "#fff",
                    color: "#000",
                    fontSize: 12,
                    fontWeight: 700,
                    lineHeight: 1.1,
                    cursor: "pointer",
                  }}
                >
                  Suscribirme
                </button>
              )}

              {notice.showDismissCta && (
                <button
                  type="button"
                  onClick={() => onDismiss(group.id)}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.10)",
                    background: "rgba(255,255,255,0.05)",
                    color: "#fff",
                    fontSize: 12,
                    fontWeight: 600,
                    lineHeight: 1.1,
                    cursor: "pointer",
                  }}
                >
                  Olvidar
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
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
  const router = useRouter();
  const [dismissedGroupIds, setDismissedGroupIds] = useState<Set<string>>(
    () => new Set()
  );

  const isMobile =
    typeof window !== "undefined" ? window.innerWidth <= 640 : false;

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DISMISSED_GROUPS_STORAGE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;

      setDismissedGroupIds(new Set(parsed.filter((v) => typeof v === "string")));
    } catch {
      setDismissedGroupIds(new Set());
    }
  }, []);

  function persistDismissed(next: Set<string>) {
    setDismissedGroupIds(next);
    try {
      window.localStorage.setItem(
        DISMISSED_GROUPS_STORAGE_KEY,
        JSON.stringify(Array.from(next))
      );
    } catch {}
  }

  function handleSubscribe(groupId: string) {
    router.push(`/groups/${groupId}`);
  }

  function handleDismiss(groupId: string) {
    const next = new Set(dismissedGroupIds);
    next.add(groupId);
    persistDismissed(next);
  }

  const visibleJoinedGrouped = useMemo(() => {
    return joinedGrouped
      .map((section) => ({
        ...section,
        items: section.items.filter((g) => shouldShowGroup(g, dismissedGroupIds)),
      }))
      .filter((section) => section.items.length > 0);
  }, [joinedGrouped, dismissedGroupIds]);

  const visiblePendingJoinRequestsSent = pendingJoinRequestsSent.filter((row) => {
    const community = groupMetaMap[row.groupId] ?? null;
    if (!community) {
      return true;
    }

    const state = resolveAccessState(community);
    return !isJoinedLikeState(state);
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
              const joinListOpen = joinSectionOpen[g.id] === true;
              const communityName = g.name ?? "(Sin nombre)";
              const avatarFallback = getInitials(communityName);
              const accessNotice = buildAccessNotice(g);
              const accessState = resolveAccessState(g);
              const memberStatus = normalizeMemberStatus(g);

              const showJoinSection =
                isMod &&
                g.visibility !== "public" &&
                joinRequests.length > 0 &&
                (accessState === "joined" ||
                  accessState === "legacy_free" ||
                  accessState === "subscribed") &&
                isActuallyJoinedStatus(memberStatus);

              if (!showJoinSection) {
                return renderJoinedCardWithAccessNotice({
                  group: g,
                  isMobile,
                  renderCommunityCard,
                  onSubscribe: handleSubscribe,
                  onDismiss: handleDismiss,
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

                  {accessNotice && (
                    <div style={noticeStyles(accessNotice.tone, isMobile)}>
                      {accessNotice.title ? (
                        <div style={{ fontWeight: 700 }}>{accessNotice.title}</div>
                      ) : null}
                      <div>{accessNotice.text}</div>

                      {(accessNotice.showSubscribeCta ||
                        accessNotice.showDismissCta) && (
                        <div
                          style={{
                            display: "flex",
                            gap: 8,
                            flexWrap: "wrap",
                            marginTop: 2,
                          }}
                        >
                          {accessNotice.showSubscribeCta && (
                            <button
                              type="button"
                              onClick={() => handleSubscribe(g.id)}
                              style={{
                                padding: "8px 12px",
                                borderRadius: 10,
                                border: "1px solid rgba(255,255,255,0.16)",
                                background: "#fff",
                                color: "#000",
                                fontSize: 12,
                                fontWeight: 700,
                                lineHeight: 1.1,
                                cursor: "pointer",
                              }}
                            >
                              Suscribirme
                            </button>
                          )}

                          {accessNotice.showDismissCta && (
                            <button
                              type="button"
                              onClick={() => handleDismiss(g.id)}
                              style={{
                                padding: "8px 12px",
                                borderRadius: 10,
                                border: "1px solid rgba(255,255,255,0.10)",
                                background: "rgba(255,255,255,0.05)",
                                color: "#fff",
                                fontSize: 12,
                                fontWeight: 600,
                                lineHeight: 1.1,
                                cursor: "pointer",
                              }}
                            >
                              Olvidar
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}

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