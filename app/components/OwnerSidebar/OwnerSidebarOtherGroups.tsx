"use client";

import type {
  GroupDocLite,
  OutgoingJoinRequestRow,
} from "./OwnerSidebar";

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
            {section.items.map((g) =>
              renderCommunityCard(g, {
                subtitle: buildJoinedSubtitle(g, isMobile),
              })
            )}
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
          No tienes otros grupos ni solicitudes pendientes.
        </div>
      )}
    </>
  );
}