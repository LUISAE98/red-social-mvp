"use client";

import Link from "next/link";
import { useState } from "react";
import InviteLinkModal from "./InviteLinkModal";
import type {
  GroupDocLite,
  GroupDraft,
  GreetingRequestDoc,
  JoinRequestRow,
  UserMini,
} from "./OwnerSidebar";
import { Chevron, CountBadge, Switch } from "./OwnerSidebar";

type Props = {
  loadingGroups: boolean;
  myGroups: GroupDocLite[];
  ownedGrouped: Array<{ key: string; title: string; items: GroupDocLite[] }>;
  groupDraft: Record<string, GroupDraft>;
  savedGroupDraft: Record<string, GroupDraft>;
  openCommunities: Record<string, boolean>;
  savingGroupId: string | null;
  joinRequestsByGroup: Record<string, JoinRequestRow[]>;
  greetingsByGroup: Record<string, Array<{ id: string; data: GreetingRequestDoc }>>;
  greetingSectionOpen: Record<string, boolean>;
  joinSectionOpen: Record<string, boolean>;
  seenCountsByGroup: Record<string, { join: number; greeting: number }>;
  userMiniMap: Record<string, UserMini>;
  styles: Record<string, React.CSSProperties>;
  getInitials: (name?: string | null) => string;
  formatMoney: (value: number, currency: "MXN" | "USD") => string;
  calcNetAmount: (raw: string) => { gross: number; net: number } | null;
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
  setGroupDraft: React.Dispatch<
    React.SetStateAction<Record<string, GroupDraft>>
  >;
  saveGroupSettings: (groupId: string) => Promise<void>;
  handleApproveJoin: (groupId: string, userId: string) => Promise<void>;
  handleRejectJoin: (groupId: string, userId: string) => Promise<void>;
  handleGreetingAction: (
    requestId: string,
    action: "accept" | "reject"
  ) => Promise<void>;
  joinBusyKey: string | null;
  greetingBusyId: string | null;
};

export default function OwnerSidebarMyGroups({
  loadingGroups,
  myGroups,
  ownedGrouped,
  groupDraft,
  savedGroupDraft,
  openCommunities,
  savingGroupId,
  joinRequestsByGroup,
  greetingsByGroup,
  greetingSectionOpen,
  joinSectionOpen,
  seenCountsByGroup,
  userMiniMap,
  styles,
  getInitials,
  formatMoney,
  calcNetAmount,
  renderUserLink,
  setOpenCommunities,
  setSeenCountsByGroup,
  setJoinSectionOpen,
  setGreetingSectionOpen,
  setGroupDraft,
  saveGroupSettings,
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
            const d = groupDraft[g.id];
            const saved = savedGroupDraft[g.id];
            if (!d || !saved) return null;

            const isOpen = openCommunities[g.id] === true;
            const saving = savingGroupId === g.id;
            const isPublic = g.visibility === "public";
            const isInviteEligible = g.visibility === "hidden";
            const joinRequests = joinRequestsByGroup[g.id] ?? [];
            const greetings = greetingsByGroup[g.id] ?? [];
            const communityName = g.name ?? "(Sin nombre)";
            const avatarFallback = getInitials(communityName);
            const saludoEnabled = d.saludoEnabled;
            const showJoinSection = !isPublic && joinRequests.length > 0;
            const showGreetingsSection = saludoEnabled && greetings.length > 0;
            const greetingListOpen = greetingSectionOpen[g.id] === true;
            const joinListOpen = joinSectionOpen[g.id] === true;

            const currentJoinCount = showJoinSection ? joinRequests.length : 0;
            const currentGreetingCount = showGreetingsSection ? greetings.length : 0;

            const seen = seenCountsByGroup[g.id] ?? {
              join: 0,
              greeting: 0,
            };

            const hasNewJoin = currentJoinCount > seen.join;
            const hasNewGreeting = currentGreetingCount > seen.greeting;
            const hasAlert = !isOpen && (hasNewJoin || hasNewGreeting);

            const subChanged =
              d.subscriptionEnabled !== saved.subscriptionEnabled ||
              d.subscriptionPrice !== saved.subscriptionPrice ||
              d.subscriptionCurrency !== saved.subscriptionCurrency;

            const saludoChanged =
              d.saludoEnabled !== saved.saludoEnabled ||
              d.saludoPrice !== saved.saludoPrice ||
              d.saludoCurrency !== saved.saludoCurrency;

            const subscriptionCalc =
              d.subscriptionEnabled && subChanged
                ? calcNetAmount(d.subscriptionPrice)
                : null;

            const saludoCalc =
              d.saludoEnabled && saludoChanged
                ? calcNetAmount(d.saludoPrice)
                : null;

            const borderBackground =
              hasAlert && hasNewJoin && hasNewGreeting
                ? "linear-gradient(90deg, rgba(47,140,255,0.95) 0%, rgba(47,140,255,0.95) 50%, rgba(34,197,94,0.95) 50%, rgba(34,197,94,0.95) 100%)"
                : hasAlert && hasNewJoin
                ? "linear-gradient(90deg, rgba(47,140,255,0.95), rgba(47,140,255,0.95))"
                : hasAlert && hasNewGreeting
                ? "linear-gradient(90deg, rgba(34,197,94,0.95), rgba(34,197,94,0.95))"
                : null;

            return (
              <div
                key={g.id}
                style={{
                  borderRadius: 16,
                  padding: hasAlert ? 1 : 0,
                  background: borderBackground ?? "transparent",
                  boxShadow: hasAlert
                    ? hasNewJoin && hasNewGreeting
                      ? "0 0 0 1px rgba(255,255,255,0.03), 0 10px 28px rgba(0,0,0,0.18)"
                      : hasNewJoin
                      ? "0 0 0 1px rgba(47,140,255,0.14), 0 10px 28px rgba(0,0,0,0.18)"
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
                              }}
                            >
                              <span
                                style={{
                                  fontSize: 12,
                                  color: "#fff",
                                  fontWeight: 700,
                                }}
                              >
                                Solicitudes de saludo
                              </span>
                              <CountBadge count={greetings.length} tone="green" />
                            </div>
                            <Chevron open={greetingListOpen} />
                          </button>

                          {greetingListOpen && (
                            <div className="mini-vertical-scroll">
                              <div style={{ display: "grid", gap: 7 }}>
                                {greetings.map((r) => {
                                  const req = r.data;
                                  const busy = greetingBusyId === r.id;

                                  return (
                                    <div key={r.id} style={styles.miniItem}>
                                      <div style={{ display: "grid", gap: 3 }}>
                                        <div
                                          style={{
                                            fontSize: 12,
                                            fontWeight: 700,
                                            color: "#fff",
                                            lineHeight: 1.25,
                                          }}
                                        >
                                          {req.type} para{" "}
                                          <span
                                            style={{
                                              color: "rgba(255,255,255,0.88)",
                                            }}
                                          >
                                            {req.toName}
                                          </span>
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

                      {!isPublic && (
                        <div style={styles.sectionPanel}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 10,
                            }}
                          >
                            <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
                              <span
                                style={{
                                  fontSize: 12,
                                  color: "#fff",
                                  fontWeight: 700,
                                }}
                              >
                                Suscripción mensual
                              </span>
                            </div>

                            <Switch
                              checked={d.subscriptionEnabled}
                              disabled={saving}
                              onChange={(next) =>
                                setGroupDraft((prev) => ({
                                  ...prev,
                                  [g.id]: {
                                    ...prev[g.id],
                                    subscriptionEnabled: next,
                                    subscriptionPrice: next
                                      ? prev[g.id].subscriptionPrice
                                      : "",
                                  },
                                }))
                              }
                              label="Activar suscripción mensual"
                            />
                          </div>

                          {d.subscriptionEnabled && (
                            <>
                              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                <input
                                  type="number"
                                  value={d.subscriptionPrice}
                                  onChange={(e) =>
                                    setGroupDraft((prev) => ({
                                      ...prev,
                                      [g.id]: {
                                        ...prev[g.id],
                                        subscriptionPrice: e.target.value,
                                      },
                                    }))
                                  }
                                  placeholder="Precio mensual"
                                  style={{ ...styles.input, width: 116 }}
                                />

                                <select
                                  value={d.subscriptionCurrency}
                                  onChange={(e) =>
                                    setGroupDraft((prev) => ({
                                      ...prev,
                                      [g.id]: {
                                        ...prev[g.id],
                                        subscriptionCurrency:
                                          e.target.value as "MXN" | "USD",
                                      },
                                    }))
                                  }
                                  style={{ ...styles.input, flex: 1, minWidth: 82 }}
                                >
                                  <option value="MXN">MXN</option>
                                  <option value="USD">USD</option>
                                </select>
                              </div>

                              {subscriptionCalc && (
                                <div
                                  style={{
                                    fontSize: 10,
                                    lineHeight: 1.3,
                                    color: "rgba(255,255,255,0.42)",
                                    paddingTop: 1,
                                  }}
                                >
                                  Por una suscripción de{" "}
                                  {formatMoney(
                                    subscriptionCalc.gross,
                                    d.subscriptionCurrency
                                  )}
                                  , tú cobras{" "}
                                  {formatMoney(
                                    subscriptionCalc.net,
                                    d.subscriptionCurrency
                                  )}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}

                      <div style={styles.sectionPanel}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 10,
                          }}
                        >
                          <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
                            <span
                              style={{
                                fontSize: 12,
                                color: "#fff",
                                fontWeight: 700,
                              }}
                            >
                              Saludos en comunidad
                            </span>
                          </div>

                          <Switch
                            checked={d.saludoEnabled}
                            disabled={saving}
                            onChange={(next) =>
                              setGroupDraft((prev) => ({
                                ...prev,
                                [g.id]: {
                                  ...prev[g.id],
                                  saludoEnabled: next,
                                  saludoPrice: next ? prev[g.id].saludoPrice : "",
                                },
                              }))
                            }
                            label="Saludos activos en esta comunidad"
                          />
                        </div>

                        {d.saludoEnabled && (
                          <>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <input
                                type="number"
                                value={d.saludoPrice}
                                onChange={(e) =>
                                  setGroupDraft((prev) => ({
                                    ...prev,
                                    [g.id]: {
                                      ...prev[g.id],
                                      saludoPrice: e.target.value,
                                    },
                                  }))
                                }
                                placeholder="Precio"
                                style={{ ...styles.input, width: 100 }}
                              />

                              <select
                                value={d.saludoCurrency}
                                onChange={(e) =>
                                  setGroupDraft((prev) => ({
                                    ...prev,
                                    [g.id]: {
                                      ...prev[g.id],
                                      saludoCurrency:
                                        e.target.value as "MXN" | "USD",
                                    },
                                  }))
                                }
                                style={{ ...styles.input, flex: 1, minWidth: 82 }}
                              >
                                <option value="MXN">MXN</option>
                                <option value="USD">USD</option>
                              </select>
                            </div>

                            {saludoCalc && (
                              <div
                                style={{
                                  fontSize: 10,
                                  lineHeight: 1.3,
                                  color: "rgba(255,255,255,0.42)",
                                  paddingTop: 1,
                                }}
                              >
                                Por un saludo de{" "}
                                {formatMoney(saludoCalc.gross, d.saludoCurrency)},
                                tú cobras{" "}
                                {formatMoney(saludoCalc.net, d.saludoCurrency)}
                              </div>
                            )}
                          </>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => saveGroupSettings(g.id)}
                        disabled={saving}
                        style={{
                          ...styles.buttonSecondary,
                          width: "100%",
                          opacity: saving ? 0.7 : 1,
                          cursor: saving ? "not-allowed" : "pointer",
                        }}
                      >
                        {saving ? "Guardando..." : "Guardar cambios"}
                      </button>

                      {isPublic && (
                        <div
                          style={{
                            fontSize: 10,
                            lineHeight: 1.35,
                            color: "rgba(255,255,255,0.36)",
                            padding: "0 2px 2px",
                          }}
                        >
                          Para activar suscripción mensual tu comunidad debe ser
                          privada u oculta.
                        </div>
                      )}
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