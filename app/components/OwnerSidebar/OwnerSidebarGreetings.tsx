"use client";

import { useMemo, useState } from "react";
import {
  acceptMeetGreetRequest,
  proposeMeetGreetSchedule,
  rejectMeetGreetRequest,
  requestMeetGreetRefund,
  requestMeetGreetReschedule,
  setMeetGreetPreparing,
} from "@/lib/meetGreet/meetGreetRequests";
import type {
  GroupDocLite,
  GreetingRequestDoc,
  MeetGreetRequestDoc,
} from "./OwnerSidebar";
import MeetGreetPreparationFullscreen from "@/app/components/meetGreet/MeetGreetPreparationFullscreen";
type Props = {
  buyerPending: Array<{ id: string; data: GreetingRequestDoc }>;
  buyerMeetGreets: Array<{ id: string; data: MeetGreetRequestDoc }>;
  meetGreetsByGroup: Record<
    string,
    Array<{ id: string; data: MeetGreetRequestDoc }>
  >;
  groupMetaMap: Record<string, GroupDocLite>;
  styles: Record<string, React.CSSProperties>;
  typeLabel: (t: string) => string;
  fmtDate: (ts?: any) => string;
  renderUserLink: (uid: string) => React.ReactNode;
  router: any;
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

function renderCardHeader(
  chip: React.ReactNode,
  title: React.ReactNode
): React.ReactNode {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
      }}
    >
      {chip}
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: "#fff",
          lineHeight: 1.25,
        }}
      >
        {title}
      </div>
    </div>
  );
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

function remainingReschedules(req: MeetGreetRequestDoc): number {
  const used =
    typeof req.rescheduleRequestsUsed === "number"
      ? req.rescheduleRequestsUsed
      : 0;

  return Math.max(0, 2 - used);
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
  const reqWithExtras = req as MeetGreetRequestDoc & {
    currency?: string | null;
    serviceSnapshot?: {
      currency?: string | null;
    } | null;
  };

  return reqWithExtras.currency ?? reqWithExtras.serviceSnapshot?.currency ?? "MXN";
}

export default function OwnerSidebarGreetings({
  buyerPending,
  buyerMeetGreets,
  meetGreetsByGroup,
  groupMetaMap,
  styles,
  typeLabel,
  fmtDate,
  renderUserLink,
  router,
}: Props) {
  const [busyMap, setBusyMap] = useState<BusyMap>({});
  const [errorMap, setErrorMap] = useState<TextMap>({});
  const [successMap, setSuccessMap] = useState<TextMap>({});
  const [rejectOpenMap, setRejectOpenMap] = useState<ToggleMap>({});
  const [scheduleOpenMap, setScheduleOpenMap] = useState<ToggleMap>({});
  const [refundOpenMap, setRefundOpenMap] = useState<ToggleMap>({});
  const [rescheduleOpenMap, setRescheduleOpenMap] = useState<ToggleMap>({});
  const [preparationOpenMap, setPreparationOpenMap] = useState<ToggleMap>({});
  const [preparationRoleMap, setPreparationRoleMap] = useState<TextMap>({});
  const [rejectReasonMap, setRejectReasonMap] = useState<TextMap>({});
  const [refundReasonMap, setRefundReasonMap] = useState<TextMap>({});
  const [rescheduleReasonMap, setRescheduleReasonMap] = useState<TextMap>({});
  const [scheduleNoteMap, setScheduleNoteMap] = useState<TextMap>({});
  const [scheduleDateMap, setScheduleDateMap] = useState<DateMap>({});

  const totalIncomingMeetGreets = useMemo(
    () =>
      Object.values(meetGreetsByGroup).reduce(
        (acc, rows) => acc + rows.length,
        0
      ),
    [meetGreetsByGroup]
  );

  function setBusy(requestId: string, value: boolean) {
    setBusyMap((prev) => ({ ...prev, [requestId]: value }));
  }

  function setError(requestId: string, value: string | null) {
    setErrorMap((prev) => ({
      ...prev,
      [requestId]: value ?? "",
    }));
  }

  function setSuccess(requestId: string, value: string | null) {
    setSuccessMap((prev) => ({
      ...prev,
      [requestId]: value ?? "",
    }));
  }

  async function handleCreatorAccept(requestId: string) {
    setBusy(requestId, true);
    setError(requestId, null);
    setSuccess(requestId, null);

    try {
      await acceptMeetGreetRequest({ requestId });
      setSuccess(
        requestId,
        "✅ Solicitud aceptada. Ahora puedes proponer fecha y hora."
      );
      setScheduleOpenMap((prev) => ({ ...prev, [requestId]: true }));
    } catch (e: any) {
      setError(requestId, e?.message ?? "No se pudo aceptar la solicitud.");
    } finally {
      setBusy(requestId, false);
    }
  }

  async function handleCreatorReject(requestId: string) {
    setBusy(requestId, true);
    setError(requestId, null);
    setSuccess(requestId, null);

    try {
      await rejectMeetGreetRequest({
        requestId,
        rejectionReason: rejectReasonMap[requestId] ?? null,
      });
      setSuccess(requestId, "✅ Solicitud rechazada.");
      setRejectOpenMap((prev) => ({ ...prev, [requestId]: false }));
    } catch (e: any) {
      setError(requestId, e?.message ?? "No se pudo rechazar la solicitud.");
    } finally {
      setBusy(requestId, false);
    }
  }

  async function handleCreatorSchedule(requestId: string) {
    const scheduledAt = (scheduleDateMap[requestId] ?? "").trim();

    if (!scheduledAt) {
      setError(requestId, "Selecciona fecha y hora.");
      return;
    }

    setBusy(requestId, true);
    setError(requestId, null);
    setSuccess(requestId, null);

    try {
      await proposeMeetGreetSchedule({
        requestId,
        scheduledAt: new Date(scheduledAt).toISOString(),
        note: scheduleNoteMap[requestId] ?? null,
      });
      setSuccess(requestId, "✅ Fecha propuesta/agendada correctamente.");
      setScheduleOpenMap((prev) => ({ ...prev, [requestId]: false }));
    } catch (e: any) {
      setError(
        requestId,
        e?.message ?? "No se pudo guardar la fecha del meet & greet."
      );
    } finally {
      setBusy(requestId, false);
    }
  }

  async function handleBuyerRefund(requestId: string) {
    setBusy(requestId, true);
    setError(requestId, null);
    setSuccess(requestId, null);

    try {
      await requestMeetGreetRefund({
        requestId,
        refundReason: refundReasonMap[requestId] ?? null,
      });
      setSuccess(requestId, "✅ Devolución solicitada.");
      setRefundOpenMap((prev) => ({ ...prev, [requestId]: false }));
    } catch (e: any) {
      setError(
        requestId,
        e?.message ?? "No se pudo solicitar la devolución."
      );
    } finally {
      setBusy(requestId, false);
    }
  }

  async function handleBuyerReschedule(requestId: string) {
    setBusy(requestId, true);
    setError(requestId, null);
    setSuccess(requestId, null);

    try {
      await requestMeetGreetReschedule({
        requestId,
        reason: rescheduleReasonMap[requestId] ?? null,
      });
      setSuccess(requestId, "✅ Cambio de fecha solicitado.");
      setRescheduleOpenMap((prev) => ({ ...prev, [requestId]: false }));
    } catch (e: any) {
      setError(
        requestId,
        e?.message ?? "No se pudo solicitar el cambio de fecha."
      );
    } finally {
      setBusy(requestId, false);
    }
  }

  async function handlePrepare(
    requestId: string,
    role: "buyer" | "creator"
  ) {
    setBusy(requestId, true);
    setError(requestId, null);
    setSuccess(requestId, null);

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

      setSuccess(requestId, "✅ Panel de preparación abierto.");
    } catch (e: any) {
      setError(requestId, e?.message ?? "No se pudo abrir la preparación.");
    } finally {
      setBusy(requestId, false);
    }
  }

  function renderRequestFeedback(requestId: string) {
    const error = errorMap[requestId];
    const success = successMap[requestId];

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
    role: "buyer" | "creator"
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
        scheduledAtLabel={req.scheduledAt ? fmtDate(req.scheduledAt) : null}
        durationMinutes={req.durationMinutes ?? null}
      />
    );
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={styles.sectionTitle}>Servicios solicitados</div>

      {buyerPending.length === 0 && buyerMeetGreets.length === 0 ? (
        <div
          style={{
            fontSize: 12,
            color: "rgba(255,255,255,0.58)",
            padding: "2px 2px 0",
          }}
        >
          No tienes servicios pendientes por recibir.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {buyerPending.map((row) => {
            const req = row.data;
            const group = groupMetaMap[req.groupId] ?? null;
            const chipStyle = getTypeChipStyle(req.type);

            return (
              <div key={row.id} style={styles.card}>
                <div style={{ display: "grid", gap: 7 }}>
                  {renderCardHeader(
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
                    </span>,
                    <>Para {req.toName}</>
                  )}

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

          {buyerMeetGreets.map((row) => {
            const req = row.data;
            const group = groupMetaMap[req.groupId] ?? null;
            const chipStyle = getTypeChipStyle("meet_greet_digital");
            const statusStyle = getMeetGreetStatusStyle(req.status);
            const busy = !!busyMap[row.id];
            const canRequestRefund = req.status === "rejected";
            const canRequestReschedule =
              (req.status === "scheduled" || req.status === "ready_to_prepare") &&
              remainingReschedules(req) > 0;
            const canPrepare =
              (req.status === "scheduled" ||
                req.status === "ready_to_prepare" ||
                req.status === "in_preparation") &&
              isPrepareWindowOpen(req.scheduledAt);

            return (
              <div key={row.id} style={styles.card}>
                <div style={{ display: "grid", gap: 8 }}>
                  {renderCardHeader(
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
                      Meet & Greet
                    </span>,
                    <>Solicitud enviada</>
                  )}

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

                  {isStartingSoon(req.scheduledAt) ? (
                    <div
                      style={{
                        borderRadius: 10,
                        border: "1px solid rgba(250,204,21,0.18)",
                        background: "rgba(250,204,21,0.08)",
                        padding: "7px 8px",
                        fontSize: 12,
                        lineHeight: 1.3,
                        color: "#fde68a",
                      }}
                    >
                      ⚠️ Tu meet & greet está próximo a iniciar.
                    </div>
                  ) : null}

                  {canPrepare ? (
                    <div
                      style={{
                        borderRadius: 10,
                        border: "1px solid rgba(96,165,250,0.18)",
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

                  {(req.priceSnapshot != null || req.durationMinutes != null) && (
                    <div
                      style={{
                        display: "flex",
                        gap: 10,
                        flexWrap: "wrap",
                        alignItems: "center",
                      }}
                    >
                      {req.priceSnapshot != null ? (
                        <span style={styles.subtle}>
                          Precio capturado:{" "}
                          {formatMoney(req.priceSnapshot, getRequestCurrency(req))}
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
                        border: "1px solid rgba(255,255,255,0.10)",
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
                        border: "1px solid rgba(248,113,113,0.18)",
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
                        border: "1px solid rgba(250,204,21,0.18)",
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

                  {req.scheduledAt ? (
                    <div style={styles.subtle}>
                      Fecha propuesta/agendada: {fmtDate(req.scheduledAt)}
                    </div>
                  ) : null}

                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    {canRequestRefund ? (
                      <button
                        type="button"
                        onClick={() =>
                          setRefundOpenMap((prev) => ({
                            ...prev,
                            [row.id]: !prev[row.id],
                          }))
                        }
                        disabled={busy}
                        style={{
                          ...styles.buttonSecondary,
                          opacity: busy ? 0.7 : 1,
                          cursor: busy ? "not-allowed" : "pointer",
                        }}
                      >
                        Solicitar devolución
                      </button>
                    ) : null}

                    {canRequestReschedule ? (
                      <button
                        type="button"
                        onClick={() =>
                          setRescheduleOpenMap((prev) => ({
                            ...prev,
                            [row.id]: !prev[row.id],
                          }))
                        }
                        disabled={busy}
                        style={{
                          ...styles.buttonSecondary,
                          opacity: busy ? 0.7 : 1,
                          cursor: busy ? "not-allowed" : "pointer",
                        }}
                      >
                        Solicitar cambio de fecha
                      </button>
                    ) : null}

                    {canPrepare ? (
                      <button
                        type="button"
                        onClick={() => handlePrepare(row.id, "buyer")}
                        disabled={busy}
                        style={{
                          ...styles.buttonPrimary,
                          opacity: busy ? 0.8 : 1,
                          cursor: busy ? "not-allowed" : "pointer",
                        }}
                      >
                        {busy ? "Procesando..." : "Prepararse"}
                      </button>
                    ) : null}
                  </div>

                  {req.status === "scheduled" || req.status === "ready_to_prepare" ? (
                    <div
                      style={{
                        ...styles.subtle,
                        color:
                          remainingReschedules(req) === 0
                            ? "#fca5a5"
                            : "rgba(255,255,255,0.62)",
                      }}
                    >
                      Cambios de fecha restantes: {remainingReschedules(req)}
                    </div>
                  ) : null}

                  {refundOpenMap[row.id] ? (
                    <div style={{ display: "grid", gap: 8 }}>
                      <textarea
                        value={refundReasonMap[row.id] ?? ""}
                        onChange={(e) =>
                          setRefundReasonMap((prev) => ({
                            ...prev,
                            [row.id]: e.target.value,
                          }))
                        }
                        placeholder="Explica por qué solicitas devolución."
                        style={{
                          ...styles.input,
                          height: 92,
                          resize: "vertical",
                        }}
                      />
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          onClick={() => handleBuyerRefund(row.id)}
                          disabled={busy}
                          style={{
                            ...styles.buttonPrimary,
                            opacity: busy ? 0.8 : 1,
                            cursor: busy ? "not-allowed" : "pointer",
                          }}
                        >
                          {busy ? "Procesando..." : "Confirmar devolución"}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setRefundOpenMap((prev) => ({
                              ...prev,
                              [row.id]: false,
                            }))
                          }
                          disabled={busy}
                          style={{
                            ...styles.buttonSecondary,
                            opacity: busy ? 0.7 : 1,
                            cursor: busy ? "not-allowed" : "pointer",
                          }}
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {rescheduleOpenMap[row.id] ? (
                    <div style={{ display: "grid", gap: 8 }}>
                      <textarea
                        value={rescheduleReasonMap[row.id] ?? ""}
                        onChange={(e) =>
                          setRescheduleReasonMap((prev) => ({
                            ...prev,
                            [row.id]: e.target.value,
                          }))
                        }
                        placeholder="Explica por qué necesitas otra fecha."
                        style={{
                          ...styles.input,
                          height: 92,
                          resize: "vertical",
                        }}
                      />
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          onClick={() => handleBuyerReschedule(row.id)}
                          disabled={busy}
                          style={{
                            ...styles.buttonPrimary,
                            opacity: busy ? 0.8 : 1,
                            cursor: busy ? "not-allowed" : "pointer",
                          }}
                        >
                          {busy ? "Procesando..." : "Confirmar cambio"}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setRescheduleOpenMap((prev) => ({
                              ...prev,
                              [row.id]: false,
                            }))
                          }
                          disabled={busy}
                          style={{
                            ...styles.buttonSecondary,
                            opacity: busy ? 0.7 : 1,
                            cursor: busy ? "not-allowed" : "pointer",
                          }}
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {renderRequestFeedback(row.id)}

                  {renderPreparationPanel(
                    row.id,
                    req,
                    (preparationRoleMap[row.id] as "buyer" | "creator") ?? "buyer"
                  )}

                  {req.createdAt ? (
                    <div style={styles.subtle}>{fmtDate(req.createdAt)}</div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {totalIncomingMeetGreets > 0 ? (
        <div style={{ ...styles.sectionTitle, paddingTop: 8 }}>
          Meet & Greet recibidos
        </div>
      ) : null}

      {totalIncomingMeetGreets > 0 ? (
        <div style={{ display: "grid", gap: 8 }}>
          {Object.entries(meetGreetsByGroup).map(([groupId, rows]) => {
            const group = groupMetaMap[groupId] ?? null;

            return (
              <div key={groupId} style={styles.card}>
                <div style={{ display: "grid", gap: 8 }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: "#fff",
                    }}
                  >
                    {group?.name ?? "Comunidad"}
                  </div>

                  <div style={{ display: "grid", gap: 8 }}>
                    {rows.map((row) => {
                      const req = row.data;
                      const statusStyle = getMeetGreetStatusStyle(req.status);
                      const busy = !!busyMap[row.id];
                      const canAccept = req.status === "pending_creator_response";
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
                        isPrepareWindowOpen(req.scheduledAt);

                      return (
                        <div
                          key={row.id}
                          style={{
                            borderRadius: 12,
                            border: "1px solid rgba(255,255,255,0.08)",
                            background: "rgba(255,255,255,0.03)",
                            padding: 9,
                            display: "grid",
                            gap: 7,
                          }}
                        >
                          {renderCardHeader(
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
                            </span>,
                            <>Solicitud recibida</>
                          )}

                          <div
                            style={{
                              display: "flex",
                              gap: 6,
                              flexWrap: "wrap",
                              alignItems: "center",
                            }}
                          >
                            <span style={styles.subtle}>Comprador:</span>
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

                          {isStartingSoon(req.scheduledAt) ? (
                            <div
                              style={{
                                borderRadius: 10,
                                border: "1px solid rgba(250,204,21,0.18)",
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
                                border: "1px solid rgba(96,165,250,0.18)",
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
                                gap: 10,
                                flexWrap: "wrap",
                                alignItems: "center",
                              }}
                            >
                              {req.priceSnapshot != null ? (
                                <span style={styles.subtle}>
                                  Precio capturado:{" "}
                                  {formatMoney(req.priceSnapshot, getRequestCurrency(req))}
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
                                border: "1px solid rgba(255,255,255,0.10)",
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

                          {req.scheduledAt ? (
                            <div style={styles.subtle}>
                              Fecha propuesta/agendada: {fmtDate(req.scheduledAt)}
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
                                  onClick={() => handleCreatorAccept(row.id)}
                                  disabled={busy}
                                  style={{
                                    ...styles.buttonPrimary,
                                    opacity: busy ? 0.8 : 1,
                                    cursor: busy ? "not-allowed" : "pointer",
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
                                      [row.id]: !prev[row.id],
                                    }))
                                  }
                                  disabled={busy}
                                  style={{
                                    ...styles.buttonSecondary,
                                    opacity: busy ? 0.7 : 1,
                                    cursor: busy ? "not-allowed" : "pointer",
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
                                      [row.id]: !prev[row.id],
                                    }))
                                  }
                                  disabled={busy}
                                  style={{
                                    ...styles.buttonSecondary,
                                    opacity: busy ? 0.7 : 1,
                                    cursor: busy ? "not-allowed" : "pointer",
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
                                  onClick={() => handlePrepare(row.id, "creator")}
                                  disabled={busy}
                                  style={{
                                    ...styles.buttonPrimary,
                                    opacity: busy ? 0.8 : 1,
                                    cursor: busy ? "not-allowed" : "pointer",
                                  }}
                                >
                                  {busy ? "Procesando..." : "Prepararse"}
                                </button>
                              ) : null}
                            </div>
                          ) : null}

                          {rejectOpenMap[row.id] ? (
                            <div style={{ display: "grid", gap: 8 }}>
                              <textarea
                                value={rejectReasonMap[row.id] ?? ""}
                                onChange={(e) =>
                                  setRejectReasonMap((prev) => ({
                                    ...prev,
                                    [row.id]: e.target.value,
                                  }))
                                }
                                placeholder="Explica por qué rechazas la solicitud."
                                style={{
                                  ...styles.input,
                                  height: 92,
                                  resize: "vertical",
                                }}
                              />
                              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                <button
                                  type="button"
                                  onClick={() => handleCreatorReject(row.id)}
                                  disabled={busy}
                                  style={{
                                    ...styles.buttonPrimary,
                                    opacity: busy ? 0.8 : 1,
                                    cursor: busy ? "not-allowed" : "pointer",
                                  }}
                                >
                                  {busy ? "Procesando..." : "Confirmar rechazo"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setRejectOpenMap((prev) => ({
                                      ...prev,
                                      [row.id]: false,
                                    }))
                                  }
                                  disabled={busy}
                                  style={{
                                    ...styles.buttonSecondary,
                                    opacity: busy ? 0.7 : 1,
                                    cursor: busy ? "not-allowed" : "pointer",
                                  }}
                                >
                                  Cancelar
                                </button>
                              </div>
                            </div>
                          ) : null}

                          {scheduleOpenMap[row.id] ? (
                            <div style={{ display: "grid", gap: 8 }}>
                              <input
                                type="datetime-local"
                                value={
                                  scheduleDateMap[row.id] ||
                                  toDateTimeLocalValue(req.scheduledAt)
                                }
                                onChange={(e) =>
                                  setScheduleDateMap((prev) => ({
                                    ...prev,
                                    [row.id]: e.target.value,
                                  }))
                                }
                                style={styles.input}
                              />
                              <textarea
                                value={scheduleNoteMap[row.id] ?? ""}
                                onChange={(e) =>
                                  setScheduleNoteMap((prev) => ({
                                    ...prev,
                                    [row.id]: e.target.value,
                                  }))
                                }
                                placeholder="Nota opcional sobre la fecha propuesta."
                                style={{
                                  ...styles.input,
                                  height: 92,
                                  resize: "vertical",
                                }}
                              />
                              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                <button
                                  type="button"
                                  onClick={() => handleCreatorSchedule(row.id)}
                                  disabled={busy}
                                  style={{
                                    ...styles.buttonPrimary,
                                    opacity: busy ? 0.8 : 1,
                                    cursor: busy ? "not-allowed" : "pointer",
                                  }}
                                >
                                  {busy ? "Procesando..." : "Guardar fecha"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setScheduleOpenMap((prev) => ({
                                      ...prev,
                                      [row.id]: false,
                                    }))
                                  }
                                  disabled={busy}
                                  style={{
                                    ...styles.buttonSecondary,
                                    opacity: busy ? 0.7 : 1,
                                    cursor: busy ? "not-allowed" : "pointer",
                                  }}
                                >
                                  Cancelar
                                </button>
                              </div>
                            </div>
                          ) : null}

                          {renderRequestFeedback(row.id)}

                          {renderPreparationPanel(
                            row.id,
                            req,
                            (preparationRoleMap[row.id] as "buyer" | "creator") ??
                              "creator"
                          )}

                          {req.createdAt ? (
                            <div style={styles.subtle}>
                              {fmtDate(req.createdAt)}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}