"use client";

import Link from "next/link";
import { useState } from "react";

import InviteLinkModal from "./InviteLinkModal";
import MeetGreetPreparationFullscreen from "@/app/components/meetGreet/MeetGreetPreparationFullscreen";
import ScheduleCalendarOverlay from "@/app/(protected)/wallet/components/ScheduleCalendarOverlay";
import { WalletServiceRow } from "@/app/(protected)/wallet/components/WalletUi";

import {
  getWalletScheduleConflictResult,
  getWalletServiceDurationMinutes,
  type WalletServiceItem,
} from "@/lib/wallet/ownerWallet";

import type {
  GroupDocLite,
  GreetingRequestDoc,
  JoinRequestRow,
  MeetGreetRequestDoc,
  ExclusiveSessionRequestDoc,
  UserMini,
} from "./OwnerSidebar";

import { Chevron, CountBadge, typeLabel } from "./OwnerSidebar";

import {
  acceptMeetGreetRequest,
  proposeMeetGreetSchedule,
  rejectMeetGreetRequest,
  setMeetGreetPreparing,
} from "@/lib/meetGreet/meetGreetRequests";

import {
  acceptExclusiveSessionRequest,
  proposeExclusiveSessionSchedule,
  rejectExclusiveSessionRequest,
  setExclusiveSessionPreparing,
} from "@/lib/exclusiveSession/exclusiveSessionRequests";

import ScheduleDateTimeSelector, {
  getSchedulePartsFromDate,
  schedulePartsToIso,
  type ScheduleParts,
} from "@/app/(protected)/wallet/components/ScheduleDateTimeSelector";

type ScheduledServiceKind = "meet_greet" | "exclusive_session";

type Props = {
  loadingGroups: boolean;
  myGroups: GroupDocLite[];
  ownedGrouped: Array<{ key: string; title: string; items: GroupDocLite[] }>;
  openCommunities: Record<string, boolean>;

  joinRequestsByGroup: Record<string, JoinRequestRow[]>;
  greetingsByGroup: Record<string, Array<{ id: string; data: GreetingRequestDoc }>>;
  meetGreetsByGroup: Record<string, Array<{ id: string; data: MeetGreetRequestDoc }>>;
  exclusiveSessionsByGroup: Record<string, Array<{ id: string; data: ExclusiveSessionRequestDoc }>>;

  greetingSectionOpen: Record<string, boolean>;
  joinSectionOpen: Record<string, boolean>;

  seenCountsByGroup: Record<string, { join: number; greeting: number }>;
  userMiniMap: Record<string, UserMini>;

  styles: Record<string, React.CSSProperties>;

  getInitials: (name?: string | null) => string;
  renderUserLink: (uid: string) => React.ReactNode;

  setOpenCommunities: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setSeenCountsByGroup: React.Dispatch<
    React.SetStateAction<Record<string, { join: number; greeting: number }>>
  >;

  setJoinSectionOpen: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setGreetingSectionOpen: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;

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
  if (
    type === "digital_exclusive_session" ||
    type === "exclusive_session" ||
    type === "clase_personalizada"
  ) {
    return {
      border: "1px solid rgba(168,85,247,0.32)",
      background: "rgba(168,85,247,0.16)",
      color: "#d8b4fe",
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

function getRequestCurrency(
  req: MeetGreetRequestDoc | ExclusiveSessionRequestDoc
): string {
  return req.currency ?? req.serviceSnapshot?.currency ?? "MXN";
}

function getCreatorScheduleNote(
  req: MeetGreetRequestDoc | ExclusiveSessionRequestDoc
): string | null {
  const note = (req as any).creatorScheduleNote;
  return typeof note === "string" && note.trim() ? note.trim() : null;
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

function isNoShowExpired(value: unknown): boolean {
  const date = toDateSafe(value);
  if (!date) return false;

  const rejectAt = date.getTime() + 15 * 60 * 1000;
  return Date.now() >= rejectAt;
}

function isStartingSoon(value: unknown): boolean {
  const date = toDateSafe(value);
  if (!date) return false;

  const now = Date.now();
  const diff = date.getTime() - now;

  return diff > 0 && diff <= 15 * 60 * 1000;
}

function isPreparationVisibleWindow(value: unknown): boolean {
  const date = toDateSafe(value);
  if (!date) return false;

  const now = Date.now();
  const startsAt = date.getTime();

  const prepareFrom = startsAt - 10 * 60 * 1000;
  const rejectAt = startsAt + 15 * 60 * 1000;

  return now >= prepareFrom && now < rejectAt;
}

function isServiceRequestAlertStatus(status?: string | null): boolean {
  return (
    status === "pending_creator_response" ||
    status === "accepted_pending_schedule" ||
    status === "reschedule_requested"
  );
}

function isUpcomingServiceStatus(status?: string | null): boolean {
  return (
    status === "scheduled" ||
    status === "ready_to_prepare" ||
    status === "in_preparation"
  );
}

function shouldHideExpiredPreparationAlert(
  status?: string | null,
  scheduledAt?: unknown
): boolean {
  return (
    (status === "scheduled" ||
      status === "ready_to_prepare" ||
      status === "in_preparation") &&
    isNoShowExpired(scheduledAt)
  );
}

function getServiceEmoji(type: string): string {
  if (type === "saludo") return "👋";
  if (type === "consejo") return "💡";
  if (type === "mensaje") return "💬";
  if (type === "meet_greet_digital") return "🤝";
  if (
    type === "digital_exclusive_session" ||
    type === "exclusive_session" ||
    type === "clase_personalizada"
  )
    return "👑";
  return "👑";
}

export default function OwnerSidebarMyGroups({
  loadingGroups,
  myGroups,
  ownedGrouped,
  openCommunities,
  joinRequestsByGroup,
  greetingsByGroup,
  meetGreetsByGroup,
  exclusiveSessionsByGroup,
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
  const [calendarOpenMap, setCalendarOpenMap] = useState<ToggleMap>({});
  const [calendarEventOpenKey, setCalendarEventOpenKey] =
    useState<string | null>(null);

  const [preparationOpenMap, setPreparationOpenMap] = useState<ToggleMap>({});
  const [preparationRoleMap, setPreparationRoleMap] = useState<TextMap>({});

  const [rejectReasonMap, setRejectReasonMap] = useState<TextMap>({});
  const [scheduleNoteMap, setScheduleNoteMap] = useState<TextMap>({});
  const [schedulePartsMap, setSchedulePartsMap] = useState<
    Record<string, ScheduleParts>
  >({});

  const emojiAlertStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 15,
    lineHeight: 1,
    color: "#fff",
    animation: "ownerSidebarBuzz 4.8s infinite",
  };

  function setMeetGreetBusy(requestId: string, value: boolean) {
    setMeetGreetBusyMap((prev) => ({
      ...prev,
      [requestId]: value,
    }));
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

  async function handleCreatorAccept(
    requestId: string,
    kind: ScheduledServiceKind
  ) {
    setMeetGreetBusy(requestId, true);
    setMeetGreetError(requestId, null);
    setMeetGreetSuccess(requestId, null);

    try {
      if (kind === "exclusive_session") {
        await acceptExclusiveSessionRequest({ requestId });
      } else {
        await acceptMeetGreetRequest({ requestId });
      }

      setMeetGreetSuccess(
        requestId,
        "✅ Solicitud aceptada. Ahora puedes proponer fecha y hora."
      );

      setScheduleOpenMap((prev) => ({
        ...prev,
        [requestId]: true,
      }));
    } catch (e: any) {
      setMeetGreetError(
        requestId,
        e?.message ?? "No se pudo aceptar la solicitud."
      );
    } finally {
      setMeetGreetBusy(requestId, false);
    }
  }
    async function handleCreatorReject(
    requestId: string,
    kind: ScheduledServiceKind
  ) {
    setMeetGreetBusy(requestId, true);
    setMeetGreetError(requestId, null);
    setMeetGreetSuccess(requestId, null);

    try {
      if (kind === "exclusive_session") {
        await rejectExclusiveSessionRequest({
          requestId,
          rejectionReason: rejectReasonMap[requestId] ?? null,
        });
      } else {
        await rejectMeetGreetRequest({
          requestId,
          rejectionReason: rejectReasonMap[requestId] ?? null,
        });
      }

      setMeetGreetSuccess(requestId, "✅ Solicitud rechazada.");

      setRejectOpenMap((prev) => ({
        ...prev,
        [requestId]: false,
      }));
    } catch (e: any) {
      setMeetGreetError(
        requestId,
        e?.message ?? "No se pudo rechazar la solicitud."
      );
    } finally {
      setMeetGreetBusy(requestId, false);
    }
  }

  async function handleCreatorSchedule(
    requestId: string,
    kind: ScheduledServiceKind
  ) {
    const parts = schedulePartsMap[requestId];
    const scheduledAt = parts ? schedulePartsToIso(parts) : null;

    if (!scheduledAt) {
      setMeetGreetError(requestId, "Selecciona día, mes, año, hora y minuto.");
      return;
    }
    const selectedScheduleDate = new Date(scheduledAt);
const calendarItems = buildOwnerCalendarItems();

const scheduleConflict = getWalletScheduleConflictResult(
  {
    id: requestId,
    source: kind,
    scheduledAt: selectedScheduleDate,
    durationMinutes: kind === "exclusive_session" ? 60 : 30,
  },
  calendarItems
);

if (scheduleConflict.hasConflict) {
  setMeetGreetError(
    requestId,
    scheduleConflict.message ??
      "Ese horario ya está ocupado. Selecciona otra hora disponible."
  );
  return;
}

    setMeetGreetBusy(requestId, true);
    setMeetGreetError(requestId, null);
    setMeetGreetSuccess(requestId, null);

    try {
      const payload = {
        requestId,
        scheduledAt,
        note: scheduleNoteMap[requestId] ?? null,
      };

      if (kind === "exclusive_session") {
        await proposeExclusiveSessionSchedule(payload);
      } else {
        await proposeMeetGreetSchedule(payload);
      }

      setMeetGreetSuccess(
        requestId,
        "✅ Fecha propuesta/agendada correctamente."
      );

      setScheduleOpenMap((prev) => ({
        ...prev,
        [requestId]: false,
      }));
    } catch (e: any) {
      setMeetGreetError(
        requestId,
        e?.message ?? "No se pudo guardar la fecha."
      );
    } finally {
      setMeetGreetBusy(requestId, false);
    }
  }

  async function handlePrepare(
    requestId: string,
    role: "creator",
    kind: ScheduledServiceKind
  ) {
    setMeetGreetBusy(requestId, true);
    setMeetGreetError(requestId, null);
    setMeetGreetSuccess(requestId, null);

    try {
      if (kind === "exclusive_session") {
        await setExclusiveSessionPreparing({ requestId, role });
      } else {
        await setMeetGreetPreparing({ requestId, role });
      }

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
    req: MeetGreetRequestDoc | ExclusiveSessionRequestDoc,
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

  function buildOwnerCalendarItems(): WalletServiceItem[] {
    const groupNameById = new Map(
      myGroups.map((group) => [group.id, group.name ?? null])
    );

    const meetGreetItems: WalletServiceItem[] = Object.entries(
      meetGreetsByGroup
    ).flatMap(([groupId, rows]) =>
      rows.map((row) => ({
        id: row.id,
        kind: "meet_greet",
        title: "Meet & Greet",
        groupId,
        groupName: groupNameById.get(groupId) ?? null,
        buyerId: row.data.buyerId ?? "",
        buyerDisplayName: (row.data as any).buyerDisplayName ?? null,
        buyerUsername: (row.data as any).buyerUsername ?? null,
        buyerAvatarUrl: (row.data as any).buyerAvatarUrl ?? null,
        targetName: null,
        requestText: row.data.buyerMessage ?? null,
        status: row.data.status,
        statusLabel: getMeetGreetStatusLabel(row.data.status),
        description: row.data.buyerMessage ?? null,
        creatorScheduleNote: getCreatorScheduleNote(row.data),
        creatorScheduleNoteUpdatedAt: toDateSafe(
          (row.data as any).creatorScheduleNoteUpdatedAt
        ),
        rejectionReason: row.data.rejectionReason ?? null,
        refundReason: row.data.refundReason ?? null,
        priceSnapshot:
          typeof row.data.priceSnapshot === "number"
            ? row.data.priceSnapshot
            : null,
        currency: getRequestCurrency(row.data) === "USD" ? "USD" : "MXN",
        durationMinutes:
          typeof row.data.durationMinutes === "number"
            ? row.data.durationMinutes
            : null,
        source: "meet_greet",
        scheduledAt: toDateSafe(row.data.scheduledAt),
        acceptedAt: toDateSafe((row.data as any).acceptedAt),
        rejectedAt: toDateSafe((row.data as any).rejectedAt),
        preparingBuyerAt: toDateSafe((row.data as any).preparingBuyerAt),
        preparingCreatorAt: toDateSafe((row.data as any).preparingCreatorAt),
        preparationOpenedAt: toDateSafe((row.data as any).preparationOpenedAt),
        noShowRejectAt: toDateSafe((row.data as any).noShowRejectAt),
        autoRejectedAt: toDateSafe((row.data as any).autoRejectedAt),
        autoRejectReason: (row.data as any).autoRejectReason ?? null,
        noShowRole: (row.data as any).noShowRole ?? null,
        createdAt: toDateSafe(row.data.createdAt),
        updatedAt: toDateSafe(row.data.updatedAt),
      }))
    );
        const exclusiveSessionItems: WalletServiceItem[] = Object.entries(
      exclusiveSessionsByGroup
    ).flatMap(([groupId, rows]) =>
      rows.map((row) => ({
        id: row.id,
        kind: "exclusive_session",
        title: "Sesión exclusiva",
        groupId,
        groupName: groupNameById.get(groupId) ?? null,
        buyerId: row.data.buyerId ?? "",
        buyerDisplayName: (row.data as any).buyerDisplayName ?? null,
        buyerUsername: (row.data as any).buyerUsername ?? null,
        buyerAvatarUrl: (row.data as any).buyerAvatarUrl ?? null,
        targetName: null,
        requestText: row.data.buyerMessage ?? null,
        status: row.data.status,
        statusLabel: getMeetGreetStatusLabel(row.data.status),
        description: row.data.buyerMessage ?? null,
        creatorScheduleNote: getCreatorScheduleNote(row.data),
        creatorScheduleNoteUpdatedAt: toDateSafe(
          (row.data as any).creatorScheduleNoteUpdatedAt
        ),
        rejectionReason: row.data.rejectionReason ?? null,
        refundReason: row.data.refundReason ?? null,
        priceSnapshot:
          typeof row.data.priceSnapshot === "number"
            ? row.data.priceSnapshot
            : null,
        currency: getRequestCurrency(row.data) === "USD" ? "USD" : "MXN",
        durationMinutes:
          typeof row.data.durationMinutes === "number"
            ? row.data.durationMinutes
            : null,
        source: "exclusive_session",
        scheduledAt: toDateSafe(row.data.scheduledAt),
        acceptedAt: toDateSafe((row.data as any).acceptedAt),
        rejectedAt: toDateSafe((row.data as any).rejectedAt),
        preparingBuyerAt: toDateSafe((row.data as any).preparingBuyerAt),
        preparingCreatorAt: toDateSafe((row.data as any).preparingCreatorAt),
        preparationOpenedAt: toDateSafe((row.data as any).preparationOpenedAt),
        noShowRejectAt: toDateSafe((row.data as any).noShowRejectAt),
        autoRejectedAt: toDateSafe((row.data as any).autoRejectedAt),
        autoRejectReason: (row.data as any).autoRejectReason ?? null,
        noShowRole: (row.data as any).noShowRole ?? null,
        createdAt: toDateSafe(row.data.createdAt),
        updatedAt: toDateSafe(row.data.updatedAt),
      }))
    );

    return [...meetGreetItems, ...exclusiveSessionItems];
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
            const exclusiveSessions = exclusiveSessionsByGroup[g.id] ?? [];

            const communityName = g.name ?? "(Sin nombre)";
            const avatarFallback = getInitials(communityName);

            const meetGreetServiceRequests = meetGreets
              .filter((row) => isServiceRequestAlertStatus(row.data.status))
              .map((row) => ({
                ...row,
                serviceKind: "meet_greet" as const,
              }));

            const exclusiveSessionServiceRequests = exclusiveSessions
              .filter((row) => isServiceRequestAlertStatus(row.data.status))
              .map((row) => ({
                ...row,
                serviceKind: "exclusive_session" as const,
              }));

            const scheduledServiceRequests = [
              ...meetGreetServiceRequests,
              ...exclusiveSessionServiceRequests,
            ];

            const upcomingScheduledServices = [
              ...meetGreets.map((row) => ({
                ...row,
                serviceKind: "meet_greet" as const,
              })),
              ...exclusiveSessions.map((row) => ({
                ...row,
                serviceKind: "exclusive_session" as const,
              })),
            ].filter((row) => {
              if (!isUpcomingServiceStatus(row.data.status)) return false;

              if (
                shouldHideExpiredPreparationAlert(
                  row.data.status,
                  row.data.scheduledAt
                )
              ) {
                return false;
              }

              return isPreparationVisibleWindow(row.data.scheduledAt);
            });
                        const greetingServiceCount = greetings.length;
            const scheduledServiceRequestCount = scheduledServiceRequests.length;
            const upcomingServiceCount = upcomingScheduledServices.length;

            const totalServiceCount =
              greetingServiceCount +
              scheduledServiceRequestCount +
              upcomingServiceCount;

            const sortedGreetings = [...greetings].sort((a, b) => {
              const aTime = toDateSafe(a.data.createdAt)?.getTime() ?? 0;
              const bTime = toDateSafe(b.data.createdAt)?.getTime() ?? 0;
              return aTime - bTime;
            });

            const sortedScheduledServiceRequests = [
              ...scheduledServiceRequests,
            ].sort((a, b) => {
              const aTime = toDateSafe(a.data.createdAt)?.getTime() ?? 0;
              const bTime = toDateSafe(b.data.createdAt)?.getTime() ?? 0;
              return aTime - bTime;
            });

            const sortedUpcomingScheduledServices = [
              ...upcomingScheduledServices,
            ].sort((a, b) => {
              const aTime = toDateSafe(a.data.scheduledAt)?.getTime() ?? 0;
              const bTime = toDateSafe(b.data.scheduledAt)?.getTime() ?? 0;
              return aTime - bTime;
            });

            const showJoinSection = !isPublic && joinRequests.length > 0;
            const showGreetingsSection = totalServiceCount > 0;
            const showUpcomingSection = upcomingServiceCount > 0;

            const greetingListOpen = greetingSectionOpen[g.id] === true;
            const joinListOpen = joinSectionOpen[g.id] === true;

            const hasSaludoAlert = greetings.some(
              (row) => row.data.type === "saludo"
            );

            const hasConsejoAlert = greetings.some(
              (row) => row.data.type === "consejo"
            );

            const hasMeetGreetServiceRequestAlert =
              scheduledServiceRequests.some(
                (row) => row.serviceKind === "meet_greet"
              );

            const hasExclusiveSessionServiceRequestAlert =
              scheduledServiceRequests.some(
                (row) => row.serviceKind === "exclusive_session"
              );

            const hasPreparingAlert = upcomingServiceCount > 0;

            const currentJoinCount = showJoinSection ? joinRequests.length : 0;

            const currentGreetingCount = showGreetingsSection
              ? greetings.length + scheduledServiceRequests.length
              : 0;

            const seen = seenCountsByGroup[g.id] ?? {
              join: 0,
              greeting: 0,
            };

            const hasNewJoin = currentJoinCount > seen.join;
            const hasNewGreeting = currentGreetingCount > seen.greeting;

            return (
              <div
                key={g.id}
                style={{
                  borderRadius: 16,
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
                          gap: 4,
                          flex: 1,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            minWidth: 0,
                            flexWrap: "wrap",
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
                              maxWidth: "100%",
                            }}
                          >
                            {communityName}
                          </span>

                          {hasNewJoin ? (
                            <span style={emojiAlertStyle}>🔵</span>
                          ) : null}

                          {hasNewGreeting && hasSaludoAlert ? (
                            <span style={emojiAlertStyle}>👋</span>
                          ) : null}

                          {hasNewGreeting && hasConsejoAlert ? (
                            <span style={emojiAlertStyle}>💡</span>
                          ) : null}

                          {hasNewGreeting && hasMeetGreetServiceRequestAlert ? (
                            <span style={emojiAlertStyle}>🤝</span>
                          ) : null}

                          {hasNewGreeting &&
                          hasExclusiveSessionServiceRequestAlert ? (
                            <span style={emojiAlertStyle}>👑</span>
                          ) : null}

                          {hasPreparingAlert ? (
                            <span style={emojiAlertStyle}>⚠️</span>
                          ) : null}
                        </div>
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
                                Genera un link con vigencia personalizada y
                                copia automática al portapapeles.
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
                                  const letter = getInitials(
                                    requester?.displayName
                                  );

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
                                              background:
                                                "rgba(255,255,255,0.05)",
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
                                            cursor: busy
                                              ? "not-allowed"
                                              : "pointer",
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
                                            cursor: busy
                                              ? "not-allowed"
                                              : "pointer",
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
                                minWidth: 0,
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

                              {totalServiceCount > 0 ? (
                                <span
                                  style={{
                                    width: 18,
                                    height: 18,
                                    minWidth: 18,
                                    borderRadius: "50%",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    background: "#ef4444",
                                    color: "#fff",
                                    fontSize: 10,
                                    fontWeight: 700,
                                    lineHeight: 1,
                                    boxShadow: "0 4px 12px rgba(0,0,0,0.22)",
                                  }}
                                >
                                  {totalServiceCount}
                                </span>
                              ) : null}
                            </div>

                            <Chevron open={greetingListOpen} />
                          </button>

                          {greetingListOpen && (
                            <div className="mini-vertical-scroll">
                              <div style={{ display: "grid", gap: 10 }}>
                                {sortedGreetings.length > 0 ? (
                                  <div
                                    style={{
                                      fontSize: 11,
                                      fontWeight: 700,
                                      color: "rgba(255,255,255,0.42)",
                                      textTransform: "uppercase",
                                      letterSpacing: 0.5,
                                      padding: "2px 2px 0",
                                    }}
                                  >
                                    Saludos, consejos y mensajes
                                  </div>
                                ) : null}

                                {sortedGreetings.map((r) => {
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
                                            {getServiceEmoji(req.type)}{" "}
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
                                            borderRadius: 12,
                                            border:
                                              "1px solid rgba(255,255,255,0.08)",
                                            background: "rgba(255,255,255,0.03)",
                                            padding: "8px 10px",
                                            whiteSpace: "pre-wrap",
                                            fontSize: 12,
                                            lineHeight: 1.35,
                                            color: "rgba(255,255,255,0.9)",
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
                                            cursor: busy
                                              ? "not-allowed"
                                              : "pointer",
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
                                            cursor: busy
                                              ? "not-allowed"
                                              : "pointer",
                                          }}
                                        >
                                          {busy ? "Procesando..." : "Rechazar"}
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}

                                {sortedScheduledServiceRequests.length > 0 ? (
                                  <div
                                    style={{
                                      fontSize: 11,
                                      fontWeight: 700,
                                      color: "rgba(255,255,255,0.42)",
                                      textTransform: "uppercase",
                                      letterSpacing: 0.5,
                                      padding: "4px 2px 0",
                                    }}
                                  >
                                    Meet & Greet y sesiones exclusivas
                                  </div>
                                ) : null}

                                {sortedScheduledServiceRequests.map((r) => {
                                  const req = r.data;
                                  const isExclusiveSession =
                                    r.serviceKind === "exclusive_session";

                                  const chipType = isExclusiveSession
                                    ? "digital_exclusive_session"
                                    : "meet_greet_digital";

                                  const statusStyle = getMeetGreetStatusStyle(
                                    req.status
                                  );

                                  const createdAtText = formatUnknownDate(
                                    req.createdAt
                                  );

                                  const scheduledAtText = formatUnknownDate(
                                    req.scheduledAt
                                  );

                                  const prepareWindowOpen = isPrepareWindowOpen(
                                    req.scheduledAt
                                  );

                                  const noShowExpired = isNoShowExpired(
                                    req.scheduledAt
                                  );

                                  const busy = !!meetGreetBusyMap[r.id];
                                  const creatorScheduleNote =
                                    getCreatorScheduleNote(req);

                                  const canAccept =
                                    req.status === "pending_creator_response";

                                  const canReject =
                                    req.status === "pending_creator_response" ||
                                    req.status === "accepted_pending_schedule" ||
                                    req.status === "reschedule_requested";

                                  const canSchedule =
                                    req.status === "accepted_pending_schedule" ||
                                    req.status === "reschedule_requested";

                                  const canPrepare =
                                    (req.status === "scheduled" ||
                                      req.status === "ready_to_prepare" ||
                                      req.status === "in_preparation") &&
                                    prepareWindowOpen &&
                                    !noShowExpired;
                                                                      const scheduleParts =
                                    schedulePartsMap[r.id] ??
                                    getSchedulePartsFromDate(
                                      toDateSafe(req.scheduledAt)
                                    );

                                  const updateScheduleParts = (nextParts: ScheduleParts) => {
  setSchedulePartsMap((prev) => ({
    ...prev,
    [r.id]: nextParts,
  }));

  setMeetGreetError(r.id, null);
  setMeetGreetSuccess(r.id, null);
};

                                  const selectedScheduleIso =
                                    schedulePartsToIso(scheduleParts);

                                  const selectedScheduleDate = selectedScheduleIso
                                    ? new Date(selectedScheduleIso)
                                    : null;
                                    const scheduleConflict = getWalletScheduleConflictResult(
  {
    id: r.id,
    source: r.serviceKind,
    scheduledAt: selectedScheduleDate,
    durationMinutes:
  typeof req.durationMinutes === "number" && req.durationMinutes > 0
    ? req.durationMinutes
    : null,
  },
  buildOwnerCalendarItems()
);

const scheduleConflictMessage = scheduleConflict.message;

                                  return (
                                    <div
                                      key={`${r.serviceKind}-${r.id}`}
                                      style={{
                                        ...styles.miniItem,
                                        background: "rgba(255,255,255,0.02)",
                                        border:
                                          "1px solid rgba(255,255,255,0.07)",
                                        borderRadius: 16,
                                        padding: 10,
                                      }}
                                    >
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
                                              ...getTypeChipStyle(chipType),
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
                                            {isExclusiveSession
                                              ? "👑 Sesión exclusiva"
                                              : "🤝 Meet & Greet"}
                                          </span>

                                          <div
                                            style={{
                                              fontSize: 12,
                                              fontWeight: 700,
                                              color: "#fff",
                                              lineHeight: 1.25,
                                            }}
                                          >
                                            {req.status === "reschedule_requested"
                                              ? "Cambio de fecha solicitado"
                                              : "Solicitud recibida"}
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
                                          🤝 Ya puedes entrar a preparación.
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

                                      {creatorScheduleNote ? (
                                        <div
                                          style={{
                                            borderRadius: 10,
                                            border:
                                              "1px solid rgba(96,165,250,0.18)",
                                            background: "rgba(96,165,250,0.08)",
                                            padding: "7px 8px",
                                            whiteSpace: "pre-wrap",
                                            fontSize: 12,
                                            lineHeight: 1.3,
                                            color: "#bfdbfe",
                                          }}
                                        >
                                          Mensaje al comprador:{" "}
                                          {creatorScheduleNote}
                                        </div>
                                      ) : null}

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
                                          Motivo de rechazo:{" "}
                                          {req.rejectionReason}
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
                                          Motivo de devolución:{" "}
                                          {req.refundReason}
                                        </div>
                                      ) : null}

                                      {scheduledAtText ? (
                                        <div style={styles.subtle}>
                                          Fecha propuesta/agendada:{" "}
                                          {scheduledAtText}
                                        </div>
                                      ) : null}

                                      {createdAtText ? (
                                        <div style={styles.subtle}>
                                          {createdAtText}
                                        </div>
                                      ) : null}
                                                                            {canAccept ||
                                      canReject ||
                                      canSchedule ||
                                      canPrepare ? (
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
                                              onClick={() =>
                                                handleCreatorAccept(
                                                  r.id,
                                                  r.serviceKind
                                                )
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
                                                : "Aceptar"}
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
                                              {req.status ===
                                              "accepted_pending_schedule"
                                                ? "Poner fecha"
                                                : "Proponer nueva fecha"}
                                            </button>
                                          ) : null}

                                          {canPrepare ? (
                                            <button
                                              type="button"
                                              onClick={() =>
                                                handlePrepare(
                                                  r.id,
                                                  "creator",
                                                  r.serviceKind
                                                )
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
                                                : "Prepararse"}
                                            </button>
                                          ) : null}
                                        </div>
                                      ) : null}

                                      {rejectOpenMap[r.id] ? (
                                        <div
                                          style={{
                                            display: "grid",
                                            gap: 8,
                                          }}
                                        >
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
                                                handleCreatorReject(
                                                  r.id,
                                                  r.serviceKind
                                                )
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
    <button
      type="button"
      onClick={() =>
        setCalendarOpenMap((prev) => ({
          ...prev,
          [r.id]: true,
        }))
      }
      disabled={busy}
      style={{
        ...styles.buttonSecondary,
        opacity: busy ? 0.7 : 1,
        cursor: busy ? "not-allowed" : "pointer",
        width: "fit-content",
      }}
    >
      Ver calendario
    </button>

    <ScheduleDateTimeSelector
      value={scheduleParts}
      onChange={updateScheduleParts}
      disabled={busy}
    />

    {scheduleConflictMessage ? (
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
    {scheduleConflictMessage}
  </div>
) : null}

    <textarea
      value={scheduleNoteMap[r.id] ?? getCreatorScheduleNote(req) ?? ""}
      onChange={(e) =>
        setScheduleNoteMap((prev) => ({
          ...prev,
          [r.id]: e.target.value,
        }))
      }
      placeholder="Mensaje o instrucciones para el comprador sobre esta fecha."
      style={{
        ...styles.input,
        height: 92,
        resize: "vertical",
      }}
    />

    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button
  type="button"
  onClick={() => handleCreatorSchedule(r.id, r.serviceKind)}
  disabled={busy || scheduleConflict.hasConflict}
  style={{
    ...styles.buttonPrimary,
    opacity: busy || scheduleConflict.hasConflict ? 0.55 : 1,
    cursor: busy || scheduleConflict.hasConflict ? "not-allowed" : "pointer",
  }}
>
  {busy ? "Procesando..." : "Guardar fecha"}
</button>

      <button
        type="button"
        onClick={() => {
          setScheduleOpenMap((prev) => ({
            ...prev,
            [r.id]: false,
          }));
          setCalendarOpenMap((prev) => ({
            ...prev,
            [r.id]: false,
          }));
          setCalendarEventOpenKey(null);
        }}
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

   <ScheduleCalendarOverlay
  open={!!calendarOpenMap[r.id]}
  title="Calendario del creador"
  items={buildOwnerCalendarItems()}
  excludeId={r.id}
  selectedDate={selectedScheduleDate}
  conflictMessage={scheduleConflictMessage}
  onSelectDate={(date) => {
    updateScheduleParts(getSchedulePartsFromDate(date));
  }}
  onClose={() => {
    setCalendarOpenMap((prev) => ({
      ...prev,
      [r.id]: false,
    }));
    setCalendarEventOpenKey(null);
  }}
  renderItem={(calendarRow) => {
    const calendarRowKey = `${calendarRow.source}-${calendarRow.id}`;
    const isCalendarRowOpen = calendarEventOpenKey === calendarRowKey;

    return (
      <WalletServiceRow
        row={calendarRow}
        open={isCalendarRowOpen}
        calendarItems={buildOwnerCalendarItems()}
        onToggle={() =>
          setCalendarEventOpenKey((prev) =>
            prev === calendarRowKey ? null : calendarRowKey
          )
        }
      />
    );
  }}
  footer={
    <div style={{ display: "grid", gap: 8 }}>
      <ScheduleDateTimeSelector
        value={scheduleParts}
        onChange={updateScheduleParts}
        disabled={busy}
      />
      {scheduleConflictMessage ? (
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
    {scheduleConflictMessage}
  </div>
) : null}

      <textarea
        value={scheduleNoteMap[r.id] ?? getCreatorScheduleNote(req) ?? ""}
        onChange={(e) =>
          setScheduleNoteMap((prev) => ({
            ...prev,
            [r.id]: e.target.value,
          }))
        }
        placeholder="Mensaje o instrucciones para el comprador sobre esta fecha."
        style={{
          ...styles.input,
          height: 92,
          resize: "vertical",
        }}
      />

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
  type="button"
  onClick={() => handleCreatorSchedule(r.id, r.serviceKind)}
  disabled={busy || scheduleConflict.hasConflict}
  style={{
    ...styles.buttonPrimary,
    opacity: busy || scheduleConflict.hasConflict ? 0.55 : 1,
    cursor: busy || scheduleConflict.hasConflict ? "not-allowed" : "pointer",
  }}
>
  {busy ? "Procesando..." : "Guardar fecha"}
</button>

        <button
          type="button"
          onClick={() => {
            setCalendarOpenMap((prev) => ({
              ...prev,
              [r.id]: false,
            }));
            setCalendarEventOpenKey(null);
          }}
          disabled={busy}
          style={{
            ...styles.buttonSecondary,
            opacity: busy ? 0.7 : 1,
            cursor: busy ? "not-allowed" : "pointer",
          }}
        >
          Cerrar calendario
        </button>
      </div>
    </div>
  }
/>
  </div>
) : null}

                                      {renderMeetGreetFeedback(r.id)}

                                      {renderPreparationPanel(
                                        r.id,
                                        req,
                                        (preparationRoleMap[
                                          r.id
                                        ] as "creator") ?? "creator"
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {showUpcomingSection && (
                        <div style={styles.sectionPanel}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 10,
                              width: "100%",
                              color: "#fff",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                minWidth: 0,
                              }}
                            >
                              <span
                                style={{
                                  fontSize: 12,
                                  color: "#fff",
                                  fontWeight: 700,
                                }}
                              >
                                Próximo a iniciar
                              </span>

                              <span
                                style={{
                                  width: 18,
                                  height: 18,
                                  minWidth: 18,
                                  borderRadius: "50%",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  background: "#f59e0b",
                                  color: "#111827",
                                  fontSize: 10,
                                  fontWeight: 900,
                                  lineHeight: 1,
                                  boxShadow: "0 4px 12px rgba(0,0,0,0.22)",
                                }}
                              >
                                {upcomingServiceCount}
                              </span>
                            </div>
                          </div>
                                                    <div className="mini-vertical-scroll">
                            <div style={{ display: "grid", gap: 10 }}>
                              {sortedUpcomingScheduledServices.map((r) => {
                                const req = r.data;
                                const isExclusiveSession =
                                  r.serviceKind === "exclusive_session";

                                const chipType = isExclusiveSession
                                  ? "digital_exclusive_session"
                                  : "meet_greet_digital";

                                const statusStyle = getMeetGreetStatusStyle(
                                  req.status
                                );

                                const scheduledAtText = formatUnknownDate(
                                  req.scheduledAt
                                );

                                const prepareWindowOpen = isPrepareWindowOpen(
                                  req.scheduledAt
                                );

                                const noShowExpired = isNoShowExpired(
                                  req.scheduledAt
                                );

                                const busy = !!meetGreetBusyMap[r.id];

                                const canPrepare =
                                  (req.status === "scheduled" ||
                                    req.status === "ready_to_prepare" ||
                                    req.status === "in_preparation") &&
                                  prepareWindowOpen &&
                                  !noShowExpired;

                                return (
                                  <div
                                    key={`upcoming-${r.serviceKind}-${r.id}`}
                                    style={{
                                      ...styles.miniItem,
                                      background: "rgba(250,204,21,0.06)",
                                      border:
                                        "1px solid rgba(250,204,21,0.16)",
                                      borderRadius: 16,
                                      padding: 10,
                                    }}
                                  >
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
                                            ...getTypeChipStyle(chipType),
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
                                          {isExclusiveSession
                                            ? "👑 Sesión exclusiva"
                                            : "🤝 Meet & Greet"}
                                        </span>

                                        <div
                                          style={{
                                            fontSize: 12,
                                            fontWeight: 700,
                                            color: "#fff",
                                            lineHeight: 1.25,
                                          }}
                                        >
                                          ⚠️ Próximo a iniciar
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
                                      ⚠️ Este servicio empieza en menos de 15
                                      minutos.
                                    </div>

                                    {scheduledAtText ? (
                                      <div style={styles.subtle}>
                                        Fecha agendada: {scheduledAtText}
                                      </div>
                                    ) : null}

                                    {canPrepare ? (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handlePrepare(
                                            r.id,
                                            "creator",
                                            r.serviceKind
                                          )
                                        }
                                        disabled={busy}
                                        style={{
                                          ...styles.buttonPrimary,
                                          opacity: busy ? 0.8 : 1,
                                          cursor: busy
                                            ? "not-allowed"
                                            : "pointer",
                                          width: "fit-content",
                                        }}
                                      >
                                        {busy ? "Procesando..." : "Prepararse"}
                                      </button>
                                    ) : null}

                                    {renderMeetGreetFeedback(r.id)}

                                    {renderPreparationPanel(
                                      r.id,
                                      req,
                                      (preparationRoleMap[
                                        r.id
                                      ] as "creator") ?? "creator"
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      )}

                      <div
                        style={{
                          fontSize: 10,
                          lineHeight: 1.35,
                          color: "rgba(255,255,255,0.36)",
                          padding: "0 2px 2px",
                        }}
                      ></div>
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