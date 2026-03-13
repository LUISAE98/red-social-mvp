"use client";

import type { GroupDocLite, GreetingRequestDoc } from "./OwnerSidebar";

type Props = {
  buyerPending: Array<{ id: string; data: GreetingRequestDoc }>;
  groupMetaMap: Record<string, GroupDocLite>;
  styles: Record<string, React.CSSProperties>;
  typeLabel: (t: string) => string;
  fmtDate: (ts?: any) => string;
  renderUserLink: (uid: string) => React.ReactNode;
  router: any;
};

export default function OwnerSidebarGreetings({
  buyerPending,
  groupMetaMap,
  styles,
  typeLabel,
  fmtDate,
  renderUserLink,
  router,
}: Props) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={styles.sectionTitle}>Saludos solicitados</div>

      {buyerPending.length === 0 ? (
        <div
          style={{
            fontSize: 12,
            color: "rgba(255,255,255,0.58)",
            padding: "2px 2px 0",
          }}
        >
          No tienes saludos pendientes por recibir.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {buyerPending.map((row) => {
            const req = row.data;
            const group = groupMetaMap[req.groupId] ?? null;

            return (
              <div key={row.id} style={styles.card}>
                <div style={{ display: "grid", gap: 5 }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: "#fff",
                      lineHeight: 1.25,
                    }}
                  >
                    {typeLabel(req.type)} para {req.toName}
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: 6,
                      flexWrap: "wrap",
                      alignItems: "center",
                    }}
                  >
                    <span style={styles.subtle}>Creador:</span>
                    {renderUserLink(req.creatorId)}
                  </div>

                  {group ? (
                    <button
                      type="button"
                      onClick={() => router.push(`/groups/${group.id}`)}
                      style={{
                        background: "transparent",
                        border: "none",
                        padding: 0,
                        margin: 0,
                        textAlign: "left",
                        cursor: "pointer",
                        color: "#fff",
                        fontSize: 12,
                        fontWeight: 600,
                        textDecoration: "underline",
                        textUnderlineOffset: 2,
                      }}
                    >
                      {group.name ?? "Ir a la comunidad"}
                    </button>
                  ) : null}

                  {req.instructions ? (
                    <div
                      style={{
                        borderRadius: 10,
                        border: "1px solid rgba(255,255,255,0.10)",
                        background: "rgba(0,0,0,0.18)",
                        padding: "7px 8px",
                        whiteSpace: "pre-wrap",
                        fontSize: 12,
                        lineHeight: 1.3,
                        color: "rgba(255,255,255,0.92)",
                      }}
                    >
                      {req.instructions}
                    </div>
                  ) : null}

                  {req.createdAt ? (
                    <div style={styles.subtle}>{fmtDate(req.createdAt)}</div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}