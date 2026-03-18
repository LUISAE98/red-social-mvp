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

type SidebarMemberStatus = "active" | "muted" | "banned" | null;

function normalizeMemberStatus(group: GroupDocLite): SidebarMemberStatus {
  const raw = (group as any)?.memberStatus ?? (group as any)?.status ?? null;

  if (raw === "banned") return "banned";
  if (raw === "muted") return "muted";
  if (raw === "active") return "active";
  return null;
}

function statusDotColor(status?: SidebarMemberStatus) {
  if (status === "banned") return "#ff4d4f";
  if (status === "muted") return "#f5a623";
  return "#22c55e";
}

function isBannedGroup(group: GroupDocLite): boolean {
  return normalizeMemberStatus(group) === "banned";
}

function buildJoinedSubtitle(
  group: GroupDocLite,
  isMobile: boolean
): React.ReactNode {
  const status = normalizeMemberStatus(group);
  const statusText = status === "muted" ? "Muteado" : "Activo";
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
    </span>
  );
}

export default function OwnerSidebarOtherGroups({
  loadingCommunities,
  joinedGroups,
  pendingJoinRequestsSent,
  browseGroups,
  joinedGrouped,
  browseGrouped,
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
      items: section.items.filter((g) => !isBannedGroup(g)),
    }))
    .filter((section) => section.items.length > 0);

  const visibleBrowseGrouped = browseGrouped
    .map((section) => ({
      ...section,
      items: section.items.filter((g) => !isBannedGroup(g)),
    }))
    .filter((section) => section.items.length > 0);

  const visiblePendingJoinRequestsSent = pendingJoinRequestsSent.filter((row) => {
    const community = groupMetaMap[row.groupId] ?? null;
    if (!community) return false;
    return !isBannedGroup(community);
  });

  const visibleJoinedGroups = joinedGroups.filter((g) => !isBannedGroup(g));
  const visibleBrowseGroups = browseGroups.filter((g) => !isBannedGroup(g));

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

      <div style={{ display: "grid", gap: 8 }}>
        <div style={styles.sectionTitle}>Solicitudes de acceso enviadas</div>

        {visiblePendingJoinRequestsSent.length === 0 ? (
          <div
            style={{
              fontSize: 12,
              color: "rgba(255,255,255,0.58)",
              padding: "2px 2px 0",
            }}
          >
            No tienes solicitudes pendientes.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {visiblePendingJoinRequestsSent.map((row) => {
              const community = groupMetaMap[row.groupId] ?? null;
              if (!community) return null;
              if (isBannedGroup(community)) return null;

              return renderCommunityCard(community, {
                subtitle: row.createdAt
                  ? `Solicitud pendiente · ${fmtDate(row.createdAt)}`
                  : "Solicitud pendiente",
              });
            })}
          </div>
        )}
      </div>

      {visibleBrowseGrouped.map((section) => (
        <div key={`browse-${section.key}`} style={{ display: "grid", gap: 8 }}>
          <div style={styles.sectionTitle}>{section.title}</div>
          <div style={{ display: "grid", gap: 8 }}>
            {section.items.map((g) =>
              renderCommunityCard(g, {
                subtitle:
                  g.visibility === "private"
                    ? "Acceso con solicitud"
                    : "Acceso abierto",
              })
            )}
          </div>
        </div>
      ))}

      {!loadingCommunities &&
        visibleJoinedGroups.length === 0 &&
        visiblePendingJoinRequestsSent.length === 0 &&
        visibleBrowseGroups.length === 0 && (
          <div
            style={{
              fontSize: 12,
              color: "rgba(255,255,255,0.58)",
              padding: "2px 2px 0",
            }}
          >
            No hay comunidades disponibles.
          </div>
        )}
    </>
  );
}