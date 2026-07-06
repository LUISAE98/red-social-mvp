import { useEffect, useMemo, useState } from "react";
import { orderBy, type FirestoreError } from "firebase/firestore";
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  query,
  where,
  type Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type {
  LiveKitRoomStatus,
  LiveKitSessionRecordingStatus,
} from "@/types/livekit";
import {
  getMeetGreetStatusLabel,
  type MeetGreetStatus,
} from "@/lib/meetGreet/types";
import {
  getExclusiveSessionStatusLabel,
  type ExclusiveSessionStatus,
} from "@/lib/exclusiveSession/types";

type FirestoreTimestampLike =
  | Timestamp
  | { toDate: () => Date }
  | string
  | number
  | Date
  | null
  | undefined;

type ScheduledStatus = MeetGreetStatus | ExclusiveSessionStatus;

type WalletScheduledDoc = {
  id: string;
  groupId?: string | null;
  groupName?: string | null;
  profileUserId?: string | null;
  profileDisplayName?: string | null;
  profileUsername?: string | null;
  source?: "group" | "profile" | null;
  buyerId: string;
  buyerDisplayName: string | null;
  buyerUsername: string | null;
  buyerAvatarUrl: string | null;
  creatorId: string;
  creatorDisplayName: string | null;
  creatorUsername: string | null;
  creatorAvatarUrl: string | null;
  status: ScheduledStatus;
  buyerMessage: string | null;
  rejectionReason: string | null;
  refundReason: string | null;
  priceSnapshot: number | null;
  currency?: "MXN" | "USD" | null;
  durationMinutes: number | null;
  acceptedAt: FirestoreTimestampLike;
  rejectedAt: FirestoreTimestampLike;
  scheduledAt: FirestoreTimestampLike;
  scheduledBy: string | null;
  scheduleProposedAt: FirestoreTimestampLike;
  creatorScheduleNote?: string | null;
  creatorScheduleNoteUpdatedAt?: FirestoreTimestampLike;
  rescheduleRequestsUsed: number;
  rescheduleRequestedAt: FirestoreTimestampLike;
  scheduleHistory?: Array<unknown>;
  rescheduleHistory?: Array<unknown>;
  preparingBuyerAt: FirestoreTimestampLike;
  preparingCreatorAt: FirestoreTimestampLike;
  preparationOpenedAt: FirestoreTimestampLike;
  noShowRejectAt?: FirestoreTimestampLike;
  autoRejectedAt?: FirestoreTimestampLike;
  autoRejectReason?: string | null;
  noShowRole?: "buyer" | "creator" | "both" | null;
  createdAt: FirestoreTimestampLike;
  updatedAt: FirestoreTimestampLike;

  // Campos LiveKit — opcionales para mantener compatibilidad con docs anteriores
  roomName?: string | null;
  livekitRoomId?: string | null;
  livekitEgressId?: string | null;
  roomStatus?: LiveKitRoomStatus;
  creatorJoinedAt?: FirestoreTimestampLike;
  buyerJoinedAt?: FirestoreTimestampLike;
  startedAt?: FirestoreTimestampLike;
  endedAt?: FirestoreTimestampLike;
  recordingStatus?: LiveKitSessionRecordingStatus;
  recordingUrl?: string | null;
  recordingDurationSeconds?: number | null;
  recordingExpiresAt?: string | null;
};

export type WalletMeetGreetDoc = WalletScheduledDoc & {
  status: MeetGreetStatus;
};

export type WalletExclusiveSessionDoc = WalletScheduledDoc & {
  status: ExclusiveSessionStatus;
};

export type GreetingType = "saludo" | "consejo" | "mensaje";
export type GreetingSource = "group" | "profile";
export type GreetingStatus = "pending" | "accepted" | "rejected" | "delivered";

export type WalletGreetingDoc = {
  id: string;
  groupId?: string | null;
  profileUserId?: string | null;
  profileDisplayName?: string | null;
  profileUsername?: string | null;
  creatorId: string;
  buyerId: string;
  type: GreetingType;
  toName: string | null;
  instructions: string | null;
  source: GreetingSource | null;
  status: GreetingStatus;
  priceSnapshot?: number | null;
  currency?: string | null;
  muxPlaybackId?: string | null;
  muxHlsUrl?: string | null;
  videoDuration?: number | null;
  deliveredAt?: FirestoreTimestampLike;
  createdAt: FirestoreTimestampLike;
  updatedAt: FirestoreTimestampLike;
  allowCreatorStory?: boolean;
};

export type WalletServiceKind =
  | "meet_greet"
  | "exclusive_session"
  | "saludo"
  | "consejo"
  | "mensaje";

export type WalletServiceItem = {
  id: string;
  kind: WalletServiceKind;
  title: string;
  groupId: string | null;
  groupName: string | null;
  profileUserId: string | null;
  profileDisplayName: string | null;
  profileUsername: string | null;
  requestSource: "group" | "profile" | null;
  buyerId: string;
  buyerDisplayName: string | null;
  buyerUsername: string | null;
  buyerAvatarUrl: string | null;
  sourceAvatarUrl: string | null;
  muxPlaybackId: string | null;
  videoDuration: number | null;
  deliveredAt: Date | null;
  targetName: string | null;
  requestText: string | null;
  status: string;
  statusLabel: string;
  description: string | null;
creatorScheduleNote: string | null;
creatorScheduleNoteUpdatedAt: Date | null;
rejectionReason: string | null;
  refundReason: string | null;
  priceSnapshot: number | null;
  currency?: "MXN" | "USD" | null;
  durationMinutes: number | null;
  source: "meet_greet" | "exclusive_session" | "greeting";
  scheduledAt: Date | null;
  acceptedAt: Date | null;
  rejectedAt: Date | null;
  preparingBuyerAt: Date | null;
  preparingCreatorAt: Date | null;
  preparationOpenedAt: Date | null;
  noShowRejectAt: Date | null;
  autoRejectedAt: Date | null;
  autoRejectReason: string | null;
  noShowRole: "buyer" | "creator" | "both" | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  allowCreatorStory?: boolean;
  creatorScheduleCount: number;
  scheduleHistory: Array<{ proposedAt?: unknown; proposedBy?: string | null; startsAt?: unknown; note?: string | null }>;
  rescheduleHistory: Array<{ requestedAt?: unknown; requestedBy?: string | null; reason?: string | null; countAfterRequest?: number | null }>;
  recordingStatus: LiveKitSessionRecordingStatus | null;
  recordingUrl: string | null;
  recordingDurationSeconds: number | null;
  recordingExpiresAt: string | null;
};

export type WalletHistoryFilter =
  | "all"
  | "rejected"
  | "meet_greet"
  | "exclusive_session"
  | "saludo"
  | "consejo"
  | "mensaje";

export type OwnerWalletDataResult = {
  loading: boolean;
  error: string | null;
  all: WalletServiceItem[];
  calendar: WalletServiceItem[];
  pendingCurrent: WalletServiceItem[];
  history: WalletServiceItem[];
};

function toDateSafe(value: FirestoreTimestampLike): Date | null {
  if (!value) return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    const date = (value as { toDate: () => Date }).toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  }

  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return !Number.isNaN(date.getTime()) ? date : null;
  }

  return null;
}

function compareDesc(a: Date | null, b: Date | null): number {
  return (b?.getTime() ?? 0) - (a?.getTime() ?? 0);
}

function compareAsc(a: Date | null, b: Date | null): number {
  return (
    (a?.getTime() ?? Number.MAX_SAFE_INTEGER) -
    (b?.getTime() ?? Number.MAX_SAFE_INTEGER)
  );
}

export function getWalletServiceDurationMinutes(row: WalletServiceItem): number {
  if (typeof row.durationMinutes === "number" && row.durationMinutes > 0) {
    return row.durationMinutes;
  }

  if (row.source === "exclusive_session") return 60;
  if (row.source === "meet_greet") return 30;

  return 0;
}

export type WalletScheduleConflictResult = {
  hasConflict: boolean;
  conflictItem: WalletServiceItem | null;
  message: string | null;
};

function formatWalletTimeOnly(value: Date): string {
  try {
    return new Intl.DateTimeFormat("es-MX", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(value);
  } catch {
    return value.toLocaleTimeString("es-MX", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
}

export function getWalletScheduleEndAt(
  scheduledAt: Date | null,
  durationMinutes: number
): Date | null {
  if (!scheduledAt || durationMinutes <= 0) return null;

  return new Date(scheduledAt.getTime() + durationMinutes * 60 * 1000);
}

export function getWalletScheduleConflictResult(
  target: {
    id?: string;
    source?: WalletServiceItem["source"];
    scheduledAt: Date | null;
    durationMinutes?: number | null;
  },
  existingRows: WalletServiceItem[]
): WalletScheduleConflictResult {
  if (!target.scheduledAt) {
    return {
      hasConflict: false,
      conflictItem: null,
      message: null,
    };
  }

  const targetDuration =
    typeof target.durationMinutes === "number" && target.durationMinutes > 0
      ? target.durationMinutes
      : target.source === "exclusive_session"
        ? 60
        : 30;

  const targetStart = target.scheduledAt.getTime();
  const targetEnd = targetStart + targetDuration * 60 * 1000;

  const conflictItem =
    existingRows.find((row) => {
      if (target.id && row.id === target.id && row.source === target.source) {
        return false;
      }

      if (!isCalendarScheduledStatus(row.status)) return false;
      if (shouldTreatAsAutoRejected(row)) return false;
      if (!row.scheduledAt) return false;

      const existingDuration = getWalletServiceDurationMinutes(row);
      if (existingDuration <= 0) return false;

      const existingStart = row.scheduledAt.getTime();
      const existingEnd = existingStart + existingDuration * 60 * 1000;

      return targetStart < existingEnd && targetEnd > existingStart;
    }) ?? null;

  if (!conflictItem || !conflictItem.scheduledAt) {
    return {
      hasConflict: false,
      conflictItem: null,
      message: null,
    };
  }

  const conflictDuration = getWalletServiceDurationMinutes(conflictItem);
  const conflictEndAt = getWalletScheduleEndAt(
    conflictItem.scheduledAt,
    conflictDuration
  );

  const serviceLabel =
    conflictItem.source === "exclusive_session"
      ? "sesión exclusiva"
      : "Meet & Greet";

  const startLabel = formatWalletTimeOnly(conflictItem.scheduledAt);
  const endLabel = conflictEndAt ? formatWalletTimeOnly(conflictEndAt) : null;

  const targetEndAt = getWalletScheduleEndAt(
  target.scheduledAt,
  targetDuration
);

const targetStartLabel = formatWalletTimeOnly(target.scheduledAt);
const targetEndLabel = targetEndAt ? formatWalletTimeOnly(targetEndAt) : null;

return {
  hasConflict: true,
  conflictItem,
  message:
    endLabel && targetEndLabel
      ? `No puedes agendar este evento de ${targetDuration} minutos de ${targetStartLabel} a ${targetEndLabel}, porque ya tienes una ${serviceLabel} que inicia a las ${startLabel}, dura ${conflictDuration} minutos y termina a las ${endLabel}. Los horarios se cruzan.`
      : `No puedes agendar este evento porque se cruza con una ${serviceLabel} existente.`,
};
}

export function hasWalletScheduleConflict(
  target: {
    id?: string;
    source?: WalletServiceItem["source"];
    scheduledAt: Date | null;
    durationMinutes?: number | null;
  },
  existingRows: WalletServiceItem[]
): boolean {
  return getWalletScheduleConflictResult(target, existingRows).hasConflict;
}

function getGreetingTypeLabel(type: GreetingType): string {
  if (type === "saludo") return "Saludo";
  if (type === "consejo") return "Consejo";
  if (type === "mensaje") return "Mensaje";
  return "Solicitud";
}

function getGreetingStatusLabel(status: GreetingStatus): string {
  if (status === "pending") return "Pendiente";
  if (status === "accepted") return "Aceptado";
  if (status === "rejected") return "Rechazado";
  return status;
}

function getAutoRejectedFallbackReason(noShowRole: WalletServiceItem["noShowRole"]): string {
  if (noShowRole === "buyer") {
    return "El comprador no se conectó dentro de los 15 minutos posteriores a la hora agendada.";
  }

  if (noShowRole === "both") {
    return "Ni el creador ni el comprador se conectaron dentro de los 15 minutos posteriores a la hora agendada.";
  }

  return "El creador no se conectó dentro de los 15 minutos posteriores a la hora agendada.";
}

function shouldTreatAsAutoRejected(
  row: Pick<
    WalletServiceItem,
    | "status"
    | "noShowRejectAt"
    | "autoRejectedAt"
    | "preparingCreatorAt"
    | "preparingBuyerAt"
  >
): boolean {
  if (row.status === "rejected") return true;
  if (row.autoRejectedAt) return true;
  if (!isCalendarScheduledStatus(row.status)) return false;
  if (!row.noShowRejectAt) return false;
  if (row.noShowRejectAt.getTime() > Date.now()) return false;

  return !row.preparingCreatorAt || !row.preparingBuyerAt;
}

function normalizeScheduledRow(
  id: string,
  data: Partial<WalletScheduledDoc>,
  source: "meet_greet" | "exclusive_session"
): WalletServiceItem {
  const rawStatus = (data.status ?? "pending_creator_response") as ScheduledStatus;
  const isExclusive = source === "exclusive_session";
  const scheduledAt = toDateSafe(data.scheduledAt);
  const acceptedAt = toDateSafe(data.acceptedAt);
  const rejectedAt = toDateSafe(data.rejectedAt);
  const preparingBuyerAt = toDateSafe(data.preparingBuyerAt);
  const preparingCreatorAt = toDateSafe(data.preparingCreatorAt);
  const preparationOpenedAt = toDateSafe(data.preparationOpenedAt);
  const noShowRejectAt =
  toDateSafe(data.noShowRejectAt) ??
  (scheduledAt ? new Date(scheduledAt.getTime() + 15 * 60 * 1000) : null);
  const autoRejectedAt = toDateSafe(data.autoRejectedAt);
  const createdAt = toDateSafe(data.createdAt);
  const updatedAt = toDateSafe(data.updatedAt);
  const creatorScheduleNoteUpdatedAt = toDateSafe(data.creatorScheduleNoteUpdatedAt);
  const creatorScheduleNote =
    typeof data.creatorScheduleNote === "string" && data.creatorScheduleNote.trim()
      ? data.creatorScheduleNote.trim()
      : null;
  const noShowRole =
    data.noShowRole === "buyer" ||
    data.noShowRole === "creator" ||
    data.noShowRole === "both"
      ? data.noShowRole
      : !preparingCreatorAt
      ? "creator"
      : !preparingBuyerAt
      ? "buyer"
      : null;

  const normalizedStatus = shouldTreatAsAutoRejected({
    status: rawStatus,
    noShowRejectAt,
    autoRejectedAt,
    preparingCreatorAt,
    preparingBuyerAt,
  })
    ? "rejected"
    : rawStatus;

  const normalizedRejectionReason =
    data.rejectionReason ??
    (normalizedStatus === "rejected" && (autoRejectedAt || noShowRejectAt)
      ? data.autoRejectReason ?? getAutoRejectedFallbackReason(noShowRole)
      : null);

  return {
    id,
    kind: isExclusive ? "exclusive_session" : "meet_greet",
    title: isExclusive ? "Sesión exclusiva" : "Meet & Greet",
    groupId: data.groupId ?? null,
    groupName: data.groupName ?? null,
    profileUserId: data.profileUserId ?? null,
    profileDisplayName: data.profileDisplayName ?? null,
    profileUsername: data.profileUsername ?? null,
    requestSource: data.source === "profile" ? "profile" : "group",
    buyerId: data.buyerId ?? "",
    buyerDisplayName: data.buyerDisplayName ?? null,
    buyerUsername: data.buyerUsername ?? null,
    buyerAvatarUrl: data.buyerAvatarUrl ?? null,
    sourceAvatarUrl: null,
    muxPlaybackId: null,
    videoDuration: null,
    deliveredAt: null,
    targetName: null,
    requestText: data.buyerMessage ?? null,
    status: normalizedStatus,
    statusLabel: isExclusive
      ? getExclusiveSessionStatusLabel(normalizedStatus as ExclusiveSessionStatus)
      : getMeetGreetStatusLabel(normalizedStatus as MeetGreetStatus),
    description: data.buyerMessage ?? null,
    creatorScheduleNote,
    creatorScheduleNoteUpdatedAt,
    rejectionReason: normalizedRejectionReason,
    refundReason: data.refundReason ?? null,
    priceSnapshot:
      typeof data.priceSnapshot === "number" ? data.priceSnapshot : null,
    currency:
      data.currency === "MXN" || data.currency === "USD"
        ? data.currency
        : "MXN",
    durationMinutes:
      typeof data.durationMinutes === "number" ? data.durationMinutes : null,
    source,
    scheduledAt,
    acceptedAt,
    rejectedAt: rejectedAt ?? autoRejectedAt ?? (normalizedStatus === "rejected" ? noShowRejectAt : null),
    preparingBuyerAt,
    preparingCreatorAt,
    preparationOpenedAt,
    noShowRejectAt,
    autoRejectedAt,
    autoRejectReason: data.autoRejectReason ?? null,
    noShowRole,
    createdAt,
    updatedAt: updatedAt ?? autoRejectedAt ?? rejectedAt ?? noShowRejectAt,
    creatorScheduleCount: Array.isArray(data.scheduleHistory) ? data.scheduleHistory.length : 0,
    scheduleHistory: Array.isArray(data.scheduleHistory) ? (data.scheduleHistory as WalletServiceItem["scheduleHistory"]) : [],
    rescheduleHistory: Array.isArray(data.rescheduleHistory) ? (data.rescheduleHistory as WalletServiceItem["rescheduleHistory"]) : [],
    recordingStatus: data.recordingStatus ?? null,
    recordingUrl: data.recordingUrl ?? null,
    recordingDurationSeconds: data.recordingDurationSeconds ?? null,
    recordingExpiresAt: data.recordingExpiresAt ?? null,
  };
}

function normalizeGreetingRow(
  id: string,
  data: Partial<WalletGreetingDoc>
): WalletServiceItem {
  const type = (data.type ?? "saludo") as GreetingType;
  const status = (data.status ?? "pending") as GreetingStatus;

  return {
    id,
    kind: type,
    title: getGreetingTypeLabel(type),
    groupId: data.groupId ?? null,
    groupName: null,
    profileUserId: data.profileUserId ?? null,
    profileDisplayName:
      typeof data.profileDisplayName === "string" && data.profileDisplayName.trim()
        ? data.profileDisplayName.trim()
        : null,
    profileUsername:
      typeof data.profileUsername === "string" && data.profileUsername.trim()
        ? data.profileUsername.trim()
        : null,
    requestSource: data.source === "profile" ? "profile" : "group",
    buyerId: data.buyerId ?? "",
    buyerDisplayName: null,
    buyerUsername: null,
    buyerAvatarUrl: null,
    sourceAvatarUrl: null,
    muxPlaybackId: typeof data.muxPlaybackId === "string" && data.muxPlaybackId.trim() ? data.muxPlaybackId.trim() : null,
    videoDuration: typeof data.videoDuration === "number" ? data.videoDuration : null,
    deliveredAt: toDateSafe(data.deliveredAt),
    targetName: data.toName?.trim() || null,
    requestText: data.instructions?.trim() || null,
    status,
    statusLabel: getGreetingStatusLabel(status),
    description: data.instructions?.trim() || null,
    creatorScheduleNote: null,
    creatorScheduleNoteUpdatedAt: null,
    rejectionReason: null,
    refundReason: null,
    priceSnapshot: typeof data.priceSnapshot === "number" ? data.priceSnapshot : null,
    currency: data.currency === "USD" ? "USD" : "MXN",
    durationMinutes: null,
    source: "greeting",
    scheduledAt: null,
    acceptedAt: status === "accepted" ? toDateSafe(data.updatedAt) : null,
    rejectedAt: status === "rejected" ? toDateSafe(data.updatedAt) : null,
    preparingBuyerAt: null,
    preparingCreatorAt: null,
    preparationOpenedAt: null,
    noShowRejectAt: null,
    autoRejectedAt: null,
    autoRejectReason: null,
    noShowRole: null,
    createdAt: toDateSafe(data.createdAt),
    updatedAt: toDateSafe(data.updatedAt),
    allowCreatorStory: typeof data.allowCreatorStory === "boolean" ? data.allowCreatorStory : undefined,
    creatorScheduleCount: 0,
    scheduleHistory: [],
    rescheduleHistory: [],
    recordingStatus: null,
    recordingUrl: null,
    recordingDurationSeconds: null,
    recordingExpiresAt: null,
  };
}

function isCalendarScheduledStatus(status: string): boolean {
  return (
    status === "scheduled" ||
    status === "ready_to_prepare" ||
    status === "in_preparation"
  );
}

function isPendingCurrentScheduledStatus(status: string): boolean {
  return [
    "pending_creator_response",
    "accepted_pending_schedule",
    "scheduled",
    "reschedule_requested",
    "ready_to_prepare",
    "in_preparation",
  ].includes(status);
}

function isHistoryScheduledStatus(status: string): boolean {
  return [
    "completed",
    "rejected",
    "refund_requested",
    "refund_review",
    "cancelled",
  ].includes(status);
}

export function filterWalletHistoryItems(
  rows: WalletServiceItem[],
  filter: WalletHistoryFilter
): WalletServiceItem[] {
  if (filter === "all") return rows;

  if (filter === "rejected") {
    return rows.filter((row) => {
      if (row.source === "meet_greet" || row.source === "exclusive_session") {
        return [
          "rejected",
          "refund_requested",
          "refund_review",
          "cancelled",
        ].includes(row.status);
      }

      return row.status === "rejected";
    });
  }

  return rows.filter((row) => row.kind === filter);
}

function useScheduledRows(
  creatorId: string | null | undefined,
  collectionName: "meetGreetRequests" | "exclusiveSessionRequests",
  source: "meet_greet" | "exclusive_session"
) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<WalletServiceItem[]>([]);

  useEffect(() => {
    if (!creatorId) {
      setRows([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const q = query(
  collection(db, collectionName),
  where("creatorId", "==", creatorId),
  orderBy("updatedAt", "desc"),
  limit(100)
);

    const unsub = onSnapshot(
      q,
      (snap) => {
        setRows(
          snap.docs.map((d) =>
            normalizeScheduledRow(
              d.id,
              d.data() as Partial<WalletScheduledDoc>,
              source
            )
          )
        );
        setError(null);
        setLoading(false);
      },
      (err: FirestoreError) => {
        setRows([]);
        setError(err.message ?? `No se pudo cargar ${collectionName}.`);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [collectionName, creatorId, source]);

  return { loading, error, rows };
}

export function useOwnerWalletData(
  creatorId: string | null | undefined
): OwnerWalletDataResult {
  const meet = useScheduledRows(
    creatorId,
    "meetGreetRequests",
    "meet_greet"
  );

  const exclusive = useScheduledRows(
    creatorId,
    "exclusiveSessionRequests",
    "exclusive_session"
  );

  const [loadingGreetings, setLoadingGreetings] = useState(true);
  const [greetingError, setGreetingError] = useState<string | null>(null);
  const [greetingRows, setGreetingRows] = useState<WalletServiceItem[]>([]);

  useEffect(() => {
    if (!creatorId) {
      setGreetingRows([]);
      setGreetingError(null);
      setLoadingGreetings(false);
      return;
    }

    setLoadingGreetings(true);
    setGreetingError(null);

    const q = query(
      collection(db, "greetingRequests"),
      where("creatorId", "==", creatorId),
      limit(100)
    );

    const unsub = onSnapshot(
      q,
      async (snap) => {
        const rows = snap.docs.map((d) =>
          normalizeGreetingRow(d.id, d.data() as Partial<WalletGreetingDoc>)
        );

        // Fetch buyer display info for all unique buyerIds
        const uniqueBuyerIds = [...new Set(rows.map((r) => r.buyerId).filter(Boolean))];
        const buyerMap: Record<string, { displayName: string | null; photoURL: string | null; username: string | null }> = {};

        await Promise.all(
          uniqueBuyerIds.map(async (uid) => {
            try {
              const snap = await getDoc(doc(db, "users", uid));
              if (!snap.exists()) return;
              const d = snap.data() as Record<string, unknown>;
              const displayName =
                typeof d.displayName === "string" && d.displayName.trim()
                  ? d.displayName.trim()
                  : [d.firstName, d.lastName]
                      .filter((v) => typeof v === "string" && (v as string).trim())
                      .map((v) => (v as string).trim())
                      .join(" ") || null;
              const photoURL =
                typeof d.photoURL === "string" && d.photoURL.trim()
                  ? d.photoURL.trim()
                  : null;
              const username =
                typeof d.handle === "string" && d.handle.trim()
                  ? d.handle.trim()
                  : null;
              buyerMap[uid] = { displayName, photoURL, username };
            } catch {
              // silently skip — row will show fallback
            }
          })
        );

        // Fetch source info: profile avatar or group avatar + name
        const uniqueProfileSourceIds = [
          ...new Set(
            rows
              .filter((r) => r.requestSource === "profile" && r.profileUserId)
              .map((r) => r.profileUserId!)
          ),
        ];
        const uniqueGroupIds = [
          ...new Set(
            rows
              .filter((r) => r.requestSource === "group" && r.groupId)
              .map((r) => r.groupId!)
          ),
        ];

        const profileSourceAvatarMap: Record<string, string | null> = {};
        const groupSourceMap: Record<string, { avatarUrl: string | null; name: string | null }> = {};

        await Promise.all([
          ...uniqueProfileSourceIds.map(async (uid) => {
            try {
              const uSnap = await getDoc(doc(db, "users", uid));
              if (!uSnap.exists()) return;
              const d = uSnap.data() as Record<string, unknown>;
              profileSourceAvatarMap[uid] =
                typeof d.photoURL === "string" && d.photoURL.trim()
                  ? d.photoURL.trim()
                  : null;
            } catch {
              // silently skip
            }
          }),
          ...uniqueGroupIds.map(async (gid) => {
            try {
              const gSnap = await getDoc(doc(db, "groups", gid));
              if (!gSnap.exists()) return;
              const d = gSnap.data() as Record<string, unknown>;
              groupSourceMap[gid] = {
                avatarUrl:
                  typeof d.avatarUrl === "string" && d.avatarUrl.trim()
                    ? d.avatarUrl.trim()
                    : null,
                name:
                  typeof d.name === "string" && d.name.trim()
                    ? d.name.trim()
                    : null,
              };
            } catch {
              // silently skip
            }
          }),
        ]);

        setGreetingRows(
          rows.map((r) => {
            const buyer = buyerMap[r.buyerId];

            let sourceAvatarUrl: string | null = null;
            let groupName = r.groupName;

            if (r.requestSource === "profile" && r.profileUserId) {
              sourceAvatarUrl = profileSourceAvatarMap[r.profileUserId] ?? null;
            } else if (r.requestSource === "group" && r.groupId) {
              const gi = groupSourceMap[r.groupId];
              sourceAvatarUrl = gi?.avatarUrl ?? null;
              groupName = gi?.name ?? r.groupName;
            }

            return {
              ...r,
              buyerDisplayName: buyer?.displayName ?? r.buyerDisplayName,
              buyerAvatarUrl: buyer?.photoURL ?? r.buyerAvatarUrl,
              buyerUsername: buyer?.username ?? r.buyerUsername,
              groupName,
              sourceAvatarUrl,
            };
          })
        );
        setGreetingError(null);
        setLoadingGreetings(false);
      },
      (err: FirestoreError) => {
        setGreetingRows([]);
        setGreetingError(
          err.message ??
            "No se pudieron cargar los saludos y consejos de la wallet."
        );
        setLoadingGreetings(false);
      }
    );

    return () => unsub();
  }, [creatorId]);

  const derived = useMemo(() => {
    const scheduledRows = [...meet.rows, ...exclusive.rows];
    const combined = [...scheduledRows, ...greetingRows];

    const all = [...combined].sort((a, b) =>
      compareDesc(a.createdAt, b.createdAt)
    );

    const calendar = scheduledRows
      .filter((row) =>
        isCalendarScheduledStatus(row.status) &&
        !shouldTreatAsAutoRejected(row)
      )
      .sort((a, b) => compareAsc(a.scheduledAt, b.scheduledAt));

    const pendingCurrent = combined
      .filter((row) =>
        row.source === "greeting"
          ? row.status === "pending"
          : isPendingCurrentScheduledStatus(row.status) &&
            !shouldTreatAsAutoRejected(row)
      )
      .sort((a, b) =>
        compareAsc(a.scheduledAt ?? a.createdAt, b.scheduledAt ?? b.createdAt)
      );

    const history = combined
      .filter((row) =>
        row.source === "greeting"
          ? row.status === "delivered" || row.status === "accepted" || row.status === "rejected"
          : isHistoryScheduledStatus(row.status) || shouldTreatAsAutoRejected(row)
      )
      .sort((a, b) => compareDesc(a.updatedAt, b.updatedAt));

    return { all, calendar, pendingCurrent, history };
  }, [exclusive.rows, greetingRows, meet.rows]);

  const error =
    [meet.error, exclusive.error, greetingError]
      .filter(Boolean)
      .join(" ") || null;

  return {
    loading: meet.loading || exclusive.loading || loadingGreetings,
    error,
    ...derived,
  };
}

export function formatWalletDateTime(value: Date | null): string {
  if (!value) return "Sin fecha";

  try {
    return new Intl.DateTimeFormat("es-MX", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(value);
  } catch {
    return value.toLocaleString("es-MX");
  }
}

export function formatWalletMoney(value: number | null): string {
  if (value == null) return "Sin precio";

  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: "MXN",
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `MXN ${value}`;
  }
}

export function getWalletServiceRowMeta(row: WalletServiceItem): string {
  if (
    (row.source === "meet_greet" || row.source === "exclusive_session") &&
    row.status === "accepted_pending_schedule"
  ) {
    return "Pendiente de asignar fecha";
  }

  if (row.scheduledAt) return formatWalletDateTime(row.scheduledAt);
  if (row.updatedAt) return formatWalletDateTime(row.updatedAt);
  if (row.createdAt) return formatWalletDateTime(row.createdAt);

  return "Sin fecha";
}
