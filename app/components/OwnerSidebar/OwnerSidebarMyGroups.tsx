"use client";

import Link from "next/link";
import { useState } from "react";
import InviteLinkModal from "./InviteLinkModal";
import type {
  GroupDocLite,
  GreetingRequestDoc,
  JoinRequestRow,
  UserMini,
} from "./OwnerSidebar";
import { Chevron, CountBadge, typeLabel } from "./OwnerSidebar";

type Props = {
  loadingGroups: boolean;
  myGroups: GroupDocLite[];
  ownedGrouped: Array<{ key: string; title: string; items: GroupDocLite[] }>;
  openCommunities: Record<string, boolean>;
  joinRequestsByGroup: Record<string, JoinRequestRow[]>;
  greetingsByGroup: Record<string, Array<{ id: string; data: GreetingRequestDoc }>>;
  greetingSectionOpen: Record<string, boolean>;
  joinSectionOpen: Record<string, boolean>;
  seenCountsByGroup: Record<string, { join: number; greeting: number }>;
  userMiniMap: Record<string, UserMini>;
  styles: Record<string, React.CSSProperties>;
  getInitials: (name?: string | null) => string;
  renderUserLink: (uid: string) => React.ReactNode;
  setOpenCommunities: React.Dispatch<
    React.SetStateAction<Record<string, boolean>>
  >;
  setSeenCountsByGroup: React.Dispatch<
    React.SetStateAction<Record<string, { join: number; greeting: number }>>
  >;
  setJoinSectionOpen: React.Dispatch<
    React.SetStateAction<Record<string, boolean>>
  >;
  setGreetingSectionOpen: React.Dispatch<
    React.SetStateAction<Record<string, boolean>>
  >;
  handleApproveJoin: (groupId: string, userId: string) => Promise<void>;
  handleRejectJoin: (groupId: string, userId: string) => Promise<void>;
  handleGreetingAction: (
    requestId: string,
    action: "accept" | "reject"
  ) => Promise<void>;
  joinBusyKey: string | null;
  greetingBusyId: string | null;
};

function getRequestTone(type: string): "green" | "yellow" {
  return type === "consejo" ? "yellow" : "green";
}

function getTypeChipStyle(type: string): React.CSSProperties {
  if (type === "saludo") {
    return {
      border: "1px solid rgba(34,197,94,0.28)",
      background: "rgba(34,197,94,0.16)",
      color: "#86efac",
    };
  }

  if (type === "consejo") {
    return {
      border: "1px solid rgba(250,204,21,0.30)",
      background: "rgba(250,204,21,0.16)",
      color: "#fde047",
    };
  }

  return {
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
  };
}

export default function OwnerSidebarMyGroups({
  loadingGroups,
  myGroups,
  ownedGrouped,
  openCommunities,
  joinRequestsByGroup,
  greetingsByGroup,
  greetingSectionOpen,
  joinSectionOpen,
  seenCountsByGroup,
  userMiniMap,
  styles,
  getInitials,
  renderUserLink,
  setOpenCommunities,
  setSeenCountsByGroup,
  setJoinSectionOpen,
  setGreetingSectionOpen,
  handleApproveJoin,
  handleRejectJoin,
  handleGreetingAction,
  joinBusyKey,
  greetingBusyId,
}: Props) {
  const [inviteGroupId, setInviteGroupId] = useState<string | null>(null);

  return (
    <>
      {!loadingGroups && myGroups.length === 0 && (
        <div
          style={{
            fontSize: 12,
            color: "rgba(255,255,255,0.58)",
            padding: "2px 2px 0",
          }}
        >
          No tienes comunidades como owner.
        </div>
      )}

      {ownedGrouped.map((section) => (
        <div key={section.key} style={{ display: "grid", gap: 8 }}>
          <div style={styles.sectionTitle}>{section.title}</div>

          {section.items.map((g) => {
            const isOpen = openCommunities[g.id] === true;
            const isPublic = g.visibility === "public";
            const isInviteEligible =
              g.visibility === "hidden" || g.visibility === "private";

            const joinRequests = joinRequestsByGroup[g.id] ?? [];
            const greetings = greetingsByGroup[g.id] ?? [];
            const communityName = g.name ?? "(Sin nombre)";
            const avatarFallback = getInitials(communityName);

            const showJoinSection = !isPublic && joinRequests.length > 0;
            const showGreetingsSection = greetings.length > 0;
            const greetingListOpen = greetingSectionOpen[g.id] === true;
            const joinListOpen = joinSectionOpen[g.id] === true;

            const saludoCount = greetings.filter(
              (row) => row.data.type === "saludo"
            ).length;
            const consejoCount = greetings.filter(
              (row) => row.data.type === "consejo"
            ).length;

            const currentJoinCount = showJoinSection ? joinRequests.length : 0;
            const currentGreetingCount = showGreetingsSection ? greetings.length : 0;

            const seen = seenCountsByGroup[g.id] ?? {
              join: 0,
              greeting: 0,
            };

            const hasNewJoin = currentJoinCount > seen.join;
            const hasNewGreeting = currentGreetingCount > seen.greeting;

            const hasSaludoAlert = greetings.some((row) => row.data.type === "saludo");
            const hasConsejoAlert = greetings.some(
              (row) => row.data.type === "consejo"
            );

            const hasAlert = !isOpen && (hasNewJoin || hasNewGreeting);

            const borderBackground =
              hasAlert && hasNewJoin && hasSaludoAlert && hasConsejoAlert
                ? "linear-gradient(90deg, rgba(47,140,255,0.95) 0%, rgba(47,140,255,0.95) 33.33%, rgba(34,197,94,0.95) 33.33%, rgba(34,197,94,0.95) 66.66%, rgba(250,204,21,0.95) 66.66%, rgba(250,204,21,0.95) 100%)"
                : hasAlert && hasNewJoin && hasSaludoAlert
                ? "linear-gradient(90deg, rgba(47,140,255,0.95) 0%, rgba(47,140,255,0.95) 50%, rgba(34,197,94,0.95) 50%, rgba(34,197,94,0.95) 100%)"
                : hasAlert && hasNewJoin && hasConsejoAlert
                ? "linear-gradient(90deg, rgba(47,140,255,0.95) 0%, rgba(47,140,255,0.95) 50%, rgba(250,204,21,0.95) 50%, rgba(250,204,21,0.95) 100%)"
                : hasAlert && hasNewJoin
                ? "linear-gradient(90deg, rgba(47,140,255,0.95), rgba(47,140,255,0.95))"
                : hasAlert && hasSaludoAlert && hasConsejoAlert
                ? "linear-gradient(90deg, rgba(34,197,94,0.95) 0%, rgba(34,197,94,0.95) 50%, rgba(250,204,21,0.95) 50%, rgba(250,204,21,0.95) 100%)"
                : hasAlert && hasSaludoAlert
                ? "linear-gradient(90deg, rgba(34,197,94,0.95), rgba(34,197,94,0.95))"
                : hasAlert && hasConsejoAlert
                ? "linear-gradient(90deg, rgba(250,204,21,0.95), rgba(250,204,21,0.95))"
                : null;

            return (
              <div
                key={g.id}
                style={{
                  borderRadius: 16,
                  padding: hasAlert ? 1 : 0,
                  background: borderBackground ?? "transparent",
                  boxShadow: hasAlert
                    ? hasNewJoin
                      ? "0 0 0 1px rgba(47,140,255,0.14), 0 10px 28px rgba(0,0,0,0.18)"
                      : hasConsejoAlert
                      ? "0 0 0 1px rgba(250,204,21,0.14), 0 10px 28px rgba(0,0,0,0.18)"
                      : "0 0 0 1px rgba(34,197,94,0.14), 0 10px 28px rgba(0,0,0,0.18)"
                    : undefined,
                  animation: hasAlert ? "ownerSidebarBuzz 4.8s infinite" : undefined,
                }}
              >
                <div
                  style={{
                    ...styles.card,
                    border: "none",
                    margin: 0,
                    borderRadius: 16,
                    background: "rgba(0,0,0,0.96)",
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
                    <Link
                      href={`/groups/${g.id}`}
                      style={{
                        background: "transparent",
                        border: "none",
                        padding: 0,
                        color: "#fff",
                        textAlign: "left",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        minWidth: 0,
                        flex: 1,
                        textDecoration: "none",
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

                      <div
                        style={{
                          minWidth: 0,
                          display: "grid",
                          gap: 2,
                          flex: 1,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            color: "#fff",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {communityName}
                        </span>
                      </div>
                    </Link>

                    <button
                      type="button"
                      onClick={() => {
                        const nextOpen = !openCommunities[g.id];
                        setOpenCommunities((prev) => ({
                          ...prev,
                          [g.id]: nextOpen,
                        }));

                        if (nextOpen) {
                          setSeenCountsByGroup((prev) => ({
                            ...prev,
                            [g.id]: {
                              join: currentJoinCount,
                              greeting: currentGreetingCount,
                            },
                          }));
                        }
                      }}
                      aria-label={
                        isOpen
                          ? "Cerrar opciones de comunidad"
                          : "Abrir opciones de comunidad"
                      }
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 999,
                        border: "1px solid rgba(255,255,255,0.08)",
                        background: "rgba(255,255,255,0.02)",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                        flexShrink: 0,
                      }}
                    >
                      <Chevron open={isOpen} />
                    </button>
                  </div>

                  {isOpen && (
                    <div
                      style={{
                        marginTop: 9,
                        paddingTop: 9,
                        borderTop: "1px solid rgba(255,255,255,0.06)",
                        display: "grid",
                        gap: 8,
                      }}
                    >
                      {isInviteEligible && (
                        <div style={styles.sectionPanel}>
                          <div style={{ display: "grid", gap: 8 }}>
                            <div style={{ display: "grid", gap: 2 }}>
                              <span
                                style={{
                                  fontSize: 12,
                                  color: "#fff",
                                  fontWeight: 700,
                                }}
                              >
                                Link de invitación
                              </span>
                              <span style={styles.subtle}>
                                Genera un link con vigencia personalizada y copia
                                automática al portapapeles.
                              </span>
                            </div>

                            <button
                              type="button"
                              onClick={() => setInviteGroupId(g.id)}
                              style={{
                                ...styles.buttonSecondary,
                                width: "100%",
                              }}
                            >
                              Generar link de invitación
                            </button>
                          </div>
                        </div>
                      )}

                      {showJoinSection && (
                        <div style={styles.sectionPanel}>
                          <button
                            type="button"
                            onClick={() =>
                              setJoinSectionOpen((prev) => ({
                                ...prev,
                                [g.id]: !prev[g.id],
                              }))
                            }
                            style={{
                              background: "transparent",
                              border: "none",
                              padding: 0,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 10,
                              width: "100%",
                              color: "#fff",
                              cursor: "pointer",
                              textAlign: "left",
                            }}
                          >
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
                            <Chevron open={joinListOpen} />
                          </button>

                          {joinListOpen && (
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
                          )}
                        </div>
                      )}

                      {showGreetingsSection && (
                        <div style={styles.sectionPanel}>
                          <button
                            type="button"
                            onClick={() =>
                              setGreetingSectionOpen((prev) => ({
                                ...prev,
                                [g.id]: !prev[g.id],
                              }))
                            }
                            style={{
                              background: "transparent",
                              border: "none",
                              padding: 0,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 10,
                              width: "100%",
                              color: "#fff",
                              cursor: "pointer",
                              textAlign: "left",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                flexWrap: "wrap",
                              }}
                            >
                              <span
                                style={{
                                  fontSize: 12,
                                  color: "#fff",
                                  fontWeight: 700,
                                }}
                              >
                                Solicitudes de servicios
                              </span>

                              {saludoCount > 0 && (
                                <CountBadge count={saludoCount} tone="green" />
                              )}

                              {consejoCount > 0 && (
                                <CountBadge count={consejoCount} tone="yellow" />
                              )}
                            </div>
                            <Chevron open={greetingListOpen} />
                          </button>

                          {greetingListOpen && (
                            <div className="mini-vertical-scroll">
                              <div style={{ display: "grid", gap: 7 }}>
                                {greetings.map((r) => {
                                  const req = r.data;
                                  const busy = greetingBusyId === r.id;
                                  const chipStyle = getTypeChipStyle(req.type);

                                  return (
                                    <div key={r.id} style={styles.miniItem}>
                                      <div style={{ display: "grid", gap: 6 }}>
                                        <div
                                          style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 8,
                                            flexWrap: "wrap",
                                          }}
                                        >
                                          <span
                                            style={{
                                              ...chipStyle,
                                              borderRadius: 999,
                                              padding: "4px 8px",
                                              fontSize: 11,
                                              fontWeight: 700,
                                              lineHeight: 1,
                                              display: "inline-flex",
                                              alignItems: "center",
                                              justifyContent: "center",
                                            }}
                                          >
                                            {typeLabel(req.type)}
                                          </span>

                                          <div
                                            style={{
                                              fontSize: 12,
                                              fontWeight: 700,
                                              color: "#fff",
                                              lineHeight: 1.25,
                                            }}
                                          >
                                            Para{" "}
                                            <span
                                              style={{
                                                color: "rgba(255,255,255,0.88)",
                                              }}
                                            >
                                              {req.toName}
                                            </span>
                                          </div>
                                        </div>

                                        <div
                                          style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 6,
                                            flexWrap: "wrap",
                                          }}
                                        >
                                          <span style={styles.subtle}>
                                            Comprador:
                                          </span>
                                          {renderUserLink(req.buyerId)}
                                        </div>
                                      </div>

                                      {req.instructions ? (
                                        <div
                                          style={{
                                            borderRadius: 10,
                                            border:
                                              "1px solid rgba(255,255,255,0.10)",
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
                                            handleGreetingAction(r.id, "accept")
                                          }
                                          disabled={busy}
                                          style={{
                                            ...styles.buttonPrimary,
                                            opacity: busy ? 0.8 : 1,
                                            cursor: busy ? "not-allowed" : "pointer",
                                          }}
                                        >
                                          {busy ? "Procesando..." : "Aceptar"}
                                        </button>

                                        <button
                                          type="button"
                                          onClick={() =>
                                            handleGreetingAction(r.id, "reject")
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
                          )}
                        </div>
                      )}

                      <div
                        style={{
                          fontSize: 10,
                          lineHeight: 1.35,
                          color: "rgba(255,255,255,0.36)",
                          padding: "0 2px 2px",
                        }}
                      >
                        La configuración de suscripción y servicios ahora se maneja
                        desde la pestaña Servicios dentro del panel de administración
                        de la comunidad.
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}

      {inviteGroupId && (
        <InviteLinkModal
          groupId={inviteGroupId}
          onClose={() => setInviteGroupId(null)}
        />
      )}
    </>
  );
}