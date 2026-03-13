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
    opts?: { compact?: boolean; subtitle?: string }
  ) => React.ReactNode;
};

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
  return (
    <>
      {joinedGrouped.map((section) => (
        <div key={`joined-${section.key}`} style={{ display: "grid", gap: 8 }}>
          <div style={styles.sectionTitle}>{section.title}</div>
          <div style={{ display: "grid", gap: 8 }}>
            {section.items.map((g) =>
              renderCommunityCard(g, { subtitle: "Ya formas parte" })
            )}
          </div>
        </div>
      ))}

      <div style={{ display: "grid", gap: 8 }}>
        <div style={styles.sectionTitle}>Solicitudes de acceso enviadas</div>

        {pendingJoinRequestsSent.length === 0 ? (
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
            {pendingJoinRequestsSent.map((row) => {
              const community = groupMetaMap[row.groupId] ?? null;
              if (!community) return null;

              return renderCommunityCard(community, {
                subtitle: row.createdAt
                  ? `Solicitud pendiente · ${fmtDate(row.createdAt)}`
                  : "Solicitud pendiente",
              });
            })}
          </div>
        )}
      </div>

      {browseGrouped.map((section) => (
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
        joinedGroups.length === 0 &&
        pendingJoinRequestsSent.length === 0 &&
        browseGroups.length === 0 && (
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