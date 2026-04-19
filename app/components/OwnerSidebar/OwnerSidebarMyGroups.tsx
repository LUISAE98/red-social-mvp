"use client";

import Link from "next/link";
import { useState } from "react";
import InviteLinkModal from "./InviteLinkModal";
import MeetGreetPreparationFullscreen from "@/app/components/meetGreet/MeetGreetPreparationFullscreen";
import type {
  GroupDocLite,
  GreetingRequestDoc,
  JoinRequestRow,
  MeetGreetRequestDoc,
  UserMini,
} from "./OwnerSidebar";
import { Chevron, CountBadge, typeLabel } from "./OwnerSidebar";
import {
  acceptMeetGreetRequest,
  proposeMeetGreetSchedule,
  rejectMeetGreetRequest,
  setMeetGreetPreparing,
} from "@/lib/meetGreet/meetGreetRequests";

type Props = {
  loadingGroups: boolean;
  myGroups: GroupDocLite[];
  ownedGrouped: Array<{ key: string; title: string; items: GroupDocLite[] }>;
  openCommunities: Record<string, boolean>;
  joinRequestsByGroup: Record<string, JoinRequestRow[]>;
  greetingsByGroup: Record<string, Array<{ id: string; data: GreetingRequestDoc }>>;
  meetGreetsByGroup: Record<string, Array<{ id: string; data: MeetGreetRequestDoc }>>;
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

type BusyMap = Record<string, boolean>;
type TextMap = Record<string, string>;
type DateMap = Record<string, string>;
type ToggleMap = Record<string, boolean>;

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

  if (type === "meet_greet_digital") {
    return {
      border: "1px solid rgba(96,165,250,0.30)",
      background: "rgba(96,165,250,0.16)",
      color: "#93c5fd",
    };
  }

  return {
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
  };
}

function getMeetGreetStatusLabel(status: string): string {
  switch (status) {
    case "pending_creator_response":
      return "En espera de aceptación";
    case "accepted_pending_schedule":
      return "Aceptado, pendiente de fecha";
    case "scheduled":
      return "Agendado";
    case "reschedule_requested":
      return "Cambio de fecha solicitado";
    case "rejected":
      return "Rechazado";
    case "refund_requested":
      return "Devolución solicitada";
    case "refund_review":
      return "Devolución en revisión";
    case "ready_to_prepare":
      return "Ya casi inicia";
    case "in_preparation":
      return "En preparación";
    case "completed":
      return "Completado";
    case "cancelled":
      return "Cancelado";
    default:
      return status || "Estado desconocido";
  }
}

function getMeetGreetStatusStyle(status: string): React.CSSProperties {
  if (
    status === "scheduled" ||
    status === "accepted_pending_schedule" ||
    status === "completed"
  ) {
    return {
      border: "1px solid rgba(34,197,94,0.24)",
      background: "rgba(34,197,94,0.12)",
      color: "#86efac",
    };
  }

  if (status === "in_preparation") {
    return {
      border: "1px solid rgba(96,165,250,0.30)",
      background: "rgba(96,165,250,0.16)",
      color: "#93c5fd",
    };
  }

  if (
    status === "reschedule_requested" ||
    status === "ready_to_prepare" ||
    status === "refund_requested" ||
    status === "refund_review"
  ) {
    return {
      border: "1px solid rgba(250,204,21,0.26)",
      background: "rgba(250,204,21,0.12)",
      color: "#fde047",
    };
  }

  if (status === "rejected" || status === "cancelled") {
    return {
      border: "1px solid rgba(248,113,113,0.28)",
      background: "rgba(248,113,113,0.14)",
      color: "#fca5a5",
    };
  }

  return {
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
  };
}

function formatUnknownDate(value: unknown): string | null {
  if (!value) return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toLocaleString("es-MX");
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    const date = (value as { toDate: () => Date }).toDate();
    if (date instanceof Date && !Number.isNaN(date.getTime())) {
      return date.toLocaleString("es-MX");
    }
  }

  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleString("es-MX");
    }
  }

  return null;
}

function formatMoney(value: number, currency?: string | null): string {
  const safeCurrency = currency === "USD" ? "USD" : "MXN";

  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: safeCurrency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${safeCurrency} ${value}`;
  }
}

function getRequestCurrency(req: MeetGreetRequestDoc): string {
  return req.currency ?? req.serviceSnapshot?.currency ?? "MXN";
}

function toDateSafe(value: unknown): Date | null {
  if (!value) return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    const date = (value as { toDate: () => Date }).toDate();
    if (date instanceof Date && !Number.isNaN(date.getTime())) {
      return date;
    }
  }

  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }

  return null;
}

function isPrepareWindowOpen(value: unknown): boolean {
  const date = toDateSafe(value);
  if (!date) return false;

  const now = Date.now();
  const startsAt = date.getTime();
  const prepareFrom = startsAt - 10 * 60 * 1000;

  return now >= prepareFrom;
}

function isStartingSoon(value: unknown): boolean {
  const date = toDateSafe(value);
  if (!date) return false;

  const now = Date.now();
  const diff = date.getTime() - now;

  return diff > 0 && diff <= 24 * 60 * 60 * 1000;
}

function toDateTimeLocalValue(value: unknown): string {
  const date = toDateSafe(value);
  if (!date) return "";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day}T${hour}:${minute}`;
}

export default function OwnerSidebarMyGroups({
  loadingGroups,
  myGroups,
  ownedGrouped,
  openCommunities,
  joinRequestsByGroup,
  greetingsByGroup,
  meetGreetsByGroup,
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

  const [meetGreetBusyMap, setMeetGreetBusyMap] = useState<BusyMap>({});
  const [meetGreetErrorMap, setMeetGreetErrorMap] = useState<TextMap>({});
  const [meetGreetSuccessMap, setMeetGreetSuccessMap] = useState<TextMap>({});
  const [rejectOpenMap, setRejectOpenMap] = useState<ToggleMap>({});
  const [scheduleOpenMap, setScheduleOpenMap] = useState<ToggleMap>({});
  const [preparationOpenMap, setPreparationOpenMap] = useState<ToggleMap>({});
  const [preparationRoleMap, setPreparationRoleMap] = useState<TextMap>({});
  const [rejectReasonMap, setRejectReasonMap] = useState<TextMap>({});
  const [scheduleNoteMap, setScheduleNoteMap] = useState<TextMap>({});
  const [scheduleDateMap, setScheduleDateMap] = useState<DateMap>({});

  function setMeetGreetBusy(requestId: string, value: boolean) {
    setMeetGreetBusyMap((prev) => ({ ...prev, [requestId]: value }));
  }

  function setMeetGreetError(requestId: string, value: string | null) {
    setMeetGreetErrorMap((prev) => ({
      ...prev,
      [requestId]: value ?? "",
    }));
  }

  function setMeetGreetSuccess(requestId: string, value: string | null) {
    setMeetGreetSuccessMap((prev) => ({
      ...prev,
      [requestId]: value ?? "",
    }));
  }

  async function handleCreatorAccept(requestId: string) {
    setMeetGreetBusy(requestId, true);
    setMeetGreetError(requestId, null);
    setMeetGreetSuccess(requestId, null);

    try {
      await acceptMeetGreetRequest({ requestId });
      setMeetGreetSuccess(
        requestId,
        "✅ Solicitud aceptada. Ahora puedes proponer fecha y hora."
      );
      setScheduleOpenMap((prev) => ({ ...prev, [requestId]: true }));
    } catch (e: any) {
      setMeetGreetError(
        requestId,
        e?.message ?? "No se pudo aceptar la solicitud."
      );
    } finally {
      setMeetGreetBusy(requestId, false);
    }
  }

  async function handleCreatorReject(requestId: string) {
    setMeetGreetBusy(requestId, true);
    setMeetGreetError(requestId, null);
    setMeetGreetSuccess(requestId, null);

    try {
      await rejectMeetGreetRequest({
        requestId,
        rejectionReason: rejectReasonMap[requestId] ?? null,
      });
      setMeetGreetSuccess(requestId, "✅ Solicitud rechazada.");
      setRejectOpenMap((prev) => ({ ...prev, [requestId]: false }));
    } catch (e: any) {
      setMeetGreetError(
        requestId,
        e?.message ?? "No se pudo rechazar la solicitud."
      );
    } finally {
      setMeetGreetBusy(requestId, false);
    }
  }

  async function handleCreatorSchedule(requestId: string) {
    const scheduledAt = (scheduleDateMap[requestId] ?? "").trim();

    if (!scheduledAt) {
      setMeetGreetError(requestId, "Selecciona fecha y hora.");
      return;
    }

    setMeetGreetBusy(requestId, true);
    setMeetGreetError(requestId, null);
    setMeetGreetSuccess(requestId, null);

    try {
      await proposeMeetGreetSchedule({
        requestId,
        scheduledAt: new Date(scheduledAt).toISOString(),
        note: scheduleNoteMap[requestId] ?? null,
      });

      setMeetGreetSuccess(
        requestId,
        "✅ Fecha propuesta/agendada correctamente."
      );
      setScheduleOpenMap((prev) => ({ ...prev, [requestId]: false }));
    } catch (e: any) {
      setMeetGreetError(
        requestId,
        e?.message ?? "No se pudo guardar la fecha del meet & greet."
      );
    } finally {
      setMeetGreetBusy(requestId, false);
    }
  }

  async function handlePrepare(
    requestId: string,
    role: "creator"
  ) {
    setMeetGreetBusy(requestId, true);
    setMeetGreetError(requestId, null);
    setMeetGreetSuccess(requestId, null);

    try {
      await setMeetGreetPreparing({ requestId, role });

      setPreparationRoleMap((prev) => ({
        ...prev,
        [requestId]: role,
      }));

      setPreparationOpenMap((prev) => ({
        ...prev,
        [requestId]: true,
      }));

      setMeetGreetSuccess(requestId, "✅ Panel de preparación abierto.");
    } catch (e: any) {
      setMeetGreetError(
        requestId,
        e?.message ?? "No se pudo abrir la preparación."
      );
    } finally {
      setMeetGreetBusy(requestId, false);
    }
  }

  function renderMeetGreetFeedback(requestId: string) {
    const error = meetGreetErrorMap[requestId];
    const success = meetGreetSuccessMap[requestId];

    return (
      <>
        {error ? (
          <div
            style={{
              borderRadius: 10,
              border: "1px solid rgba(248,113,113,0.18)",
              background: "rgba(248,113,113,0.08)",
              padding: "7px 8px",
              fontSize: 12,
              lineHeight: 1.3,
              color: "#fecaca",
            }}
          >
            {error}
          </div>
        ) : null}

        {success ? (
          <div
            style={{
              borderRadius: 10,
              border: "1px solid rgba(34,197,94,0.18)",
              background: "rgba(34,197,94,0.08)",
              padding: "7px 8px",
              fontSize: 12,
              lineHeight: 1.3,
              color: "#bbf7d0",
            }}
          >
            {success}
          </div>
        ) : null}
      </>
    );
  }

    function renderPreparationPanel(
    requestId: string,
    req: MeetGreetRequestDoc,
    role: "creator"
  ) {
    return (
      <MeetGreetPreparationFullscreen
        open={!!preparationOpenMap[requestId]}
        onClose={() =>
          setPreparationOpenMap((prev) => ({
            ...prev,
            [requestId]: false,
          }))
        }
        role={role}
        scheduledAtLabel={req.scheduledAt ? formatUnknownDate(req.scheduledAt) : null}
        durationMinutes={req.durationMinutes ?? null}
      />
    );
  }

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
            const isInviteEligible = g.visibility === "hidden";

            const joinRequests = joinRequestsByGroup[g.id] ?? [];
            const greetings = greetingsByGroup[g.id] ?? [];
            const meetGreets = meetGreetsByGroup[g.id] ?? [];
            const communityName = g.name ?? "(Sin nombre)";
            const avatarFallback = getInitials(communityName);

            const showJoinSection = !isPublic && joinRequests.length > 0;
            const showGreetingsSection =
              greetings.length > 0 || meetGreets.length > 0;
            const greetingListOpen = greetingSectionOpen[g.id] === true;
            const joinListOpen = joinSectionOpen[g.id] === true;

            const saludoCount = greetings.filter(
              (row) => row.data.type === "saludo"
            ).length;
            const consejoCount = greetings.filter(
              (row) => row.data.type === "consejo"
            ).length;
            const meetGreetCount = meetGreets.length;

            const currentJoinCount = showJoinSection ? joinRequests.length : 0;
            const currentGreetingCount = showGreetingsSection
              ? greetings.length + meetGreets.length
              : 0;

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
            const hasMeetGreetAlert = meetGreets.length > 0;

            const hasAlert = !isOpen && (hasNewJoin || hasNewGreeting);

            const borderBackground =
              hasAlert &&
              hasNewJoin &&
              hasSaludoAlert &&
              hasConsejoAlert &&
              hasMeetGreetAlert
                ? "linear-gradient(90deg, rgba(47,140,255,0.95) 0%, rgba(47,140,255,0.95) 25%, rgba(34,197,94,0.95) 25%, rgba(34,197,94,0.95) 50%, rgba(250,204,21,0.95) 50%, rgba(250,204,21,0.95) 75%, rgba(96,165,250,0.95) 75%, rgba(96,165,250,0.95) 100%)"
                : hasAlert && hasNewJoin && hasMeetGreetAlert
                ? "linear-gradient(90deg, rgba(47,140,255,0.95) 0%, rgba(47,140,255,0.95) 50%, rgba(96,165,250,0.95) 50%, rgba(96,165,250,0.95) 100%)"
                : hasAlert && hasSaludoAlert && hasMeetGreetAlert
                ? "linear-gradient(90deg, rgba(34,197,94,0.95) 0%, rgba(34,197,94,0.95) 50%, rgba(96,165,250,0.95) 50%, rgba(96,165,250,0.95) 100%)"
                : hasAlert && hasConsejoAlert && hasMeetGreetAlert
                ? "linear-gradient(90deg, rgba(250,204,21,0.95) 0%, rgba(250,204,21,0.95) 50%, rgba(96,165,250,0.95) 50%, rgba(96,165,250,0.95) 100%)"
                : hasAlert && hasMeetGreetAlert
                ? "linear-gradient(90deg, rgba(96,165,250,0.95), rgba(96,165,250,0.95))"
                : hasAlert && hasNewJoin && hasSaludoAlert && hasConsejoAlert
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
                      : hasMeetGreetAlert
                      ? "0 0 0 1px rgba(96,165,250,0.16), 0 10px 28px rgba(0,0,0,0.18)"
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

                              {meetGreetCount > 0 && (
                                <CountBadge count={meetGreetCount} tone="blue" />
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

                                {meetGreets.map((r) => {
                                  const req = r.data;
                                  const statusStyle = getMeetGreetStatusStyle(
                                    req.status
                                  );
                                  const createdAtText = formatUnknownDate(req.createdAt);
                                  const scheduledAtText = formatUnknownDate(req.scheduledAt);
                                  const startingSoon = isStartingSoon(req.scheduledAt);
                                  const prepareWindowOpen = isPrepareWindowOpen(
                                    req.scheduledAt
                                  );
                                  const busy = !!meetGreetBusyMap[r.id];
                                  const canAccept =
                                    req.status === "pending_creator_response";
                                  const canReject =
                                    req.status === "pending_creator_response" ||
                                    req.status === "accepted_pending_schedule" ||
                                    req.status === "reschedule_requested";
                                  const canSchedule =
                                    req.status === "accepted_pending_schedule" ||
                                    req.status === "reschedule_requested" ||
                                    req.status === "scheduled" ||
                                    req.status === "ready_to_prepare";
                                  const canPrepare =
                                    (req.status === "scheduled" ||
                                      req.status === "ready_to_prepare" ||
                                      req.status === "in_preparation") &&
                                    prepareWindowOpen;

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
                                              ...getTypeChipStyle("meet_greet_digital"),
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
                                            Meet & Greet
                                          </span>

                                          <div
                                            style={{
                                              fontSize: 12,
                                              fontWeight: 700,
                                              color: "#fff",
                                              lineHeight: 1.25,
                                            }}
                                          >
                                            Solicitud recibida
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

                                        <div
                                          style={{
                                            ...statusStyle,
                                            borderRadius: 999,
                                            padding: "5px 9px",
                                            fontSize: 11,
                                            fontWeight: 700,
                                            lineHeight: 1,
                                            display: "inline-flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            width: "fit-content",
                                          }}
                                        >
                                          {getMeetGreetStatusLabel(req.status)}
                                        </div>
                                      </div>

                                      {startingSoon ? (
                                        <div
                                          style={{
                                            borderRadius: 10,
                                            border:
                                              "1px solid rgba(250,204,21,0.18)",
                                            background: "rgba(250,204,21,0.08)",
                                            padding: "7px 8px",
                                            fontSize: 12,
                                            lineHeight: 1.3,
                                            color: "#fde68a",
                                          }}
                                        >
                                          ⚠️ Este meet & greet está próximo a iniciar.
                                        </div>
                                      ) : null}

                                      {canPrepare ? (
                                        <div
                                          style={{
                                            borderRadius: 10,
                                            border:
                                              "1px solid rgba(96,165,250,0.18)",
                                            background: "rgba(96,165,250,0.08)",
                                            padding: "7px 8px",
                                            fontSize: 12,
                                            lineHeight: 1.3,
                                            color: "#bfdbfe",
                                          }}
                                        >
                                          🎥 Ya puedes entrar a preparación.
                                        </div>
                                      ) : null}

                                      {(req.priceSnapshot != null ||
                                        req.durationMinutes != null) && (
                                        <div
                                          style={{
                                            display: "flex",
                                            gap: 8,
                                            flexWrap: "wrap",
                                          }}
                                        >
                                          {req.priceSnapshot != null ? (
                                            <span style={styles.subtle}>
                                              Precio capturado:{" "}
                                              {formatMoney(
                                                req.priceSnapshot,
                                                getRequestCurrency(req)
                                              )}
                                            </span>
                                          ) : null}

                                          {req.durationMinutes != null ? (
                                            <span style={styles.subtle}>
                                              Duración: {req.durationMinutes} min
                                            </span>
                                          ) : null}
                                        </div>
                                      )}

                                      {req.buyerMessage ? (
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
                                          {req.buyerMessage}
                                        </div>
                                      ) : null}

                                      {req.rejectionReason ? (
                                        <div
                                          style={{
                                            borderRadius: 10,
                                            border:
                                              "1px solid rgba(248,113,113,0.18)",
                                            background: "rgba(248,113,113,0.08)",
                                            padding: "7px 8px",
                                            fontSize: 12,
                                            lineHeight: 1.3,
                                            color: "#fecaca",
                                          }}
                                        >
                                          Motivo de rechazo: {req.rejectionReason}
                                        </div>
                                      ) : null}

                                      {req.refundReason ? (
                                        <div
                                          style={{
                                            borderRadius: 10,
                                            border:
                                              "1px solid rgba(250,204,21,0.18)",
                                            background: "rgba(250,204,21,0.08)",
                                            padding: "7px 8px",
                                            fontSize: 12,
                                            lineHeight: 1.3,
                                            color: "#fde68a",
                                          }}
                                        >
                                          Motivo de devolución: {req.refundReason}
                                        </div>
                                      ) : null}

                                      {scheduledAtText ? (
                                        <div style={styles.subtle}>
                                          Fecha propuesta/agendada: {scheduledAtText}
                                        </div>
                                      ) : null}

                                      {createdAtText ? (
                                        <div style={styles.subtle}>
                                          {createdAtText}
                                        </div>
                                      ) : null}

                                      {canAccept || canReject || canSchedule || canPrepare ? (
                                        <div
                                          style={{
                                            display: "flex",
                                            gap: 8,
                                            flexWrap: "wrap",
                                          }}
                                        >
                                          {canAccept ? (
                                            <button
                                              type="button"
                                              onClick={() => handleCreatorAccept(r.id)}
                                              disabled={busy}
                                              style={{
                                                ...styles.buttonPrimary,
                                                opacity: busy ? 0.8 : 1,
                                                cursor: busy
                                                  ? "not-allowed"
                                                  : "pointer",
                                              }}
                                            >
                                              {busy ? "Procesando..." : "Aceptar"}
                                            </button>
                                          ) : null}

                                          {canReject ? (
                                            <button
                                              type="button"
                                              onClick={() =>
                                                setRejectOpenMap((prev) => ({
                                                  ...prev,
                                                  [r.id]: !prev[r.id],
                                                }))
                                              }
                                              disabled={busy}
                                              style={{
                                                ...styles.buttonSecondary,
                                                opacity: busy ? 0.7 : 1,
                                                cursor: busy
                                                  ? "not-allowed"
                                                  : "pointer",
                                              }}
                                            >
                                              Rechazar
                                            </button>
                                          ) : null}

                                          {canSchedule ? (
                                            <button
                                              type="button"
                                              onClick={() =>
                                                setScheduleOpenMap((prev) => ({
                                                  ...prev,
                                                  [r.id]: !prev[r.id],
                                                }))
                                              }
                                              disabled={busy}
                                              style={{
                                                ...styles.buttonSecondary,
                                                opacity: busy ? 0.7 : 1,
                                                cursor: busy
                                                  ? "not-allowed"
                                                  : "pointer",
                                              }}
                                            >
                                              {req.status === "accepted_pending_schedule"
                                                ? "Poner fecha"
                                                : "Proponer nueva fecha"}
                                            </button>
                                          ) : null}

                                          {canPrepare ? (
                                            <button
                                              type="button"
                                              onClick={() =>
                                                handlePrepare(r.id, "creator")
                                              }
                                              disabled={busy}
                                              style={{
                                                ...styles.buttonPrimary,
                                                opacity: busy ? 0.8 : 1,
                                                cursor: busy
                                                  ? "not-allowed"
                                                  : "pointer",
                                              }}
                                            >
                                              {busy ? "Procesando..." : "Prepararse"}
                                            </button>
                                          ) : null}
                                        </div>
                                      ) : null}

                                      {rejectOpenMap[r.id] ? (
                                        <div style={{ display: "grid", gap: 8 }}>
                                          <textarea
                                            value={rejectReasonMap[r.id] ?? ""}
                                            onChange={(e) =>
                                              setRejectReasonMap((prev) => ({
                                                ...prev,
                                                [r.id]: e.target.value,
                                              }))
                                            }
                                            placeholder="Explica por qué rechazas la solicitud."
                                            style={{
                                              ...styles.input,
                                              height: 92,
                                              resize: "vertical",
                                            }}
                                          />
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
                                                handleCreatorReject(r.id)
                                              }
                                              disabled={busy}
                                              style={{
                                                ...styles.buttonPrimary,
                                                opacity: busy ? 0.8 : 1,
                                                cursor: busy
                                                  ? "not-allowed"
                                                  : "pointer",
                                              }}
                                            >
                                              {busy
                                                ? "Procesando..."
                                                : "Confirmar rechazo"}
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() =>
                                                setRejectOpenMap((prev) => ({
                                                  ...prev,
                                                  [r.id]: false,
                                                }))
                                              }
                                              disabled={busy}
                                              style={{
                                                ...styles.buttonSecondary,
                                                opacity: busy ? 0.7 : 1,
                                                cursor: busy
                                                  ? "not-allowed"
                                                  : "pointer",
                                              }}
                                            >
                                              Cancelar
                                            </button>
                                          </div>
                                        </div>
                                      ) : null}

                                      {scheduleOpenMap[r.id] ? (
                                        <div style={{ display: "grid", gap: 8 }}>
                                          <input
                                            type="datetime-local"
                                            value={
                                              scheduleDateMap[r.id] ||
                                              toDateTimeLocalValue(req.scheduledAt)
                                            }
                                            onChange={(e) =>
                                              setScheduleDateMap((prev) => ({
                                                ...prev,
                                                [r.id]: e.target.value,
                                              }))
                                            }
                                            style={styles.input}
                                          />
                                          <textarea
                                            value={scheduleNoteMap[r.id] ?? ""}
                                            onChange={(e) =>
                                              setScheduleNoteMap((prev) => ({
                                                ...prev,
                                                [r.id]: e.target.value,
                                              }))
                                            }
                                            placeholder="Nota opcional sobre la fecha propuesta."
                                            style={{
                                              ...styles.input,
                                              height: 92,
                                              resize: "vertical",
                                            }}
                                          />
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
                                                handleCreatorSchedule(r.id)
                                              }
                                              disabled={busy}
                                              style={{
                                                ...styles.buttonPrimary,
                                                opacity: busy ? 0.8 : 1,
                                                cursor: busy
                                                  ? "not-allowed"
                                                  : "pointer",
                                              }}
                                            >
                                              {busy
                                                ? "Procesando..."
                                                : "Guardar fecha"}
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() =>
                                                setScheduleOpenMap((prev) => ({
                                                  ...prev,
                                                  [r.id]: false,
                                                }))
                                              }
                                              disabled={busy}
                                              style={{
                                                ...styles.buttonSecondary,
                                                opacity: busy ? 0.7 : 1,
                                                cursor: busy
                                                  ? "not-allowed"
                                                  : "pointer",
                                              }}
                                            >
                                              Cancelar
                                            </button>
                                          </div>
                                        </div>
                                      ) : null}

                                      {renderMeetGreetFeedback(r.id)}

                                      {renderPreparationPanel(
                                        r.id,
                                        req,
                                        (preparationRoleMap[r.id] as "creator") ??
                                          "creator"
                                      )}
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