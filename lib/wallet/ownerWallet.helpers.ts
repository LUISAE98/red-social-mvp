// Tipos y lógica pura del wallet del creador (horarios, conflictos, estados,
// filtros, formato). Capa HOJA sin React ni auth/db; los hooks viven en
// ownerWallet.ts, que re-exporta este módulo (barrel). Extraído para <1000 líneas.

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
import { auth, db } from "@/lib/firebase";
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
import type { PostLiveData } from "@/lib/posts/types";

export type FirestoreTimestampLike =
  | Timestamp
  | { toDate: () => Date }
  | string
  | number
  | Date
  | null
  | undefined;

export type ScheduledStatus = MeetGreetStatus | ExclusiveSessionStatus;

export type WalletScheduledDoc = {
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

export type GreetingType = "saludo" | "consejo";
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
  | "live";

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
  source: "meet_greet" | "exclusive_session" | "greeting" | "live";
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
  /** Solo para lives: true = "Horario abierto" (solo fecha, sin hora). */
  liveOpenSchedule?: boolean;
};

export type WalletHistoryFilter =
  | "all"
  | "rejected"
  | "meet_greet"
  | "exclusive_session"
  | "saludo"
  | "consejo";

export type OwnerWalletDataResult = {
  loading: boolean;
  error: string | null;
  all: WalletServiceItem[];
  calendar: WalletServiceItem[];
  /** Lives del creador (solo para mostrar en el calendario, no en conflictos). */
  lives: WalletServiceItem[];
  pendingCurrent: WalletServiceItem[];
  history: WalletServiceItem[];
};

export function toDateSafe(value: FirestoreTimestampLike): Date | null {
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

export function compareDesc(a: Date | null, b: Date | null): number {
  return (b?.getTime() ?? 0) - (a?.getTime() ?? 0);
}

export function compareAsc(a: Date | null, b: Date | null): number {
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

export function formatWalletTimeOnly(value: Date): string {
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

      // Los lives son solo guía: nunca bloquean (no cuentan como conflicto duro).
      if (row.source === "live") return false;

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
      : conflictItem.source === "live"
        ? "transmisión en vivo"
        : "Tiempo contigo";

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

export function getGreetingTypeLabel(type: GreetingType): string {
  if (type === "saludo") return "Saludo";
  if (type === "consejo") return "Consejo";
  // Tipos legacy (p. ej. el extinto "mensaje") caen aquí sin romper la fila.
  return "Solicitud";
}

export function getGreetingStatusLabel(status: GreetingStatus): string {
  if (status === "pending") return "Pendiente";
  if (status === "accepted") return "Aceptado";
  if (status === "rejected") return "Rechazado";
  return status;
}

export function getAutoRejectedFallbackReason(noShowRole: WalletServiceItem["noShowRole"]): string {
  if (noShowRole === "buyer") {
    return "El comprador no se conectó dentro de los 15 minutos posteriores a la hora agendada.";
  }

  if (noShowRole === "both") {
    return "Ni el creador ni el comprador se conectaron dentro de los 15 minutos posteriores a la hora agendada.";
  }

  return "El creador no se conectó dentro de los 15 minutos posteriores a la hora agendada.";
}

export function shouldTreatAsAutoRejected(
  row: Pick<
    WalletServiceItem,
    | "status"
    | "noShowRejectAt"
    | "autoRejectedAt"
    | "preparingCreatorAt"
    | "preparingBuyerAt"
    | "preparationOpenedAt"
  >
): boolean {
  if (row.status === "rejected") return true;
  if (row.autoRejectedAt) return true;

  // "completed" sin sala de preparación abierta = no-show que el webhook marcó incorrectamente
  if (row.status === "completed" && !row.preparationOpenedAt) return true;

  if (!isCalendarScheduledStatus(row.status)) return false;
  if (!row.noShowRejectAt) return false;
  if (row.noShowRejectAt.getTime() > Date.now()) return false;

  return !row.preparingCreatorAt || !row.preparingBuyerAt;
}

export function normalizeScheduledRow(
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
    preparationOpenedAt,
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
    title: isExclusive ? "Sesión exclusiva" : "Tiempo contigo",
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

export function normalizeGreetingRow(
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

export function isCalendarScheduledStatus(status: string): boolean {
  return (
    status === "scheduled" ||
    status === "ready_to_prepare" ||
    status === "in_preparation"
  );
}

export function isPendingCurrentScheduledStatus(status: string): boolean {
  return [
    "pending_creator_response",
    "accepted_pending_schedule",
    "scheduled",
    "reschedule_requested",
    "ready_to_prepare",
    "in_preparation",
  ].includes(status);
}

/**
 * Estado "seguro" de una experiencia pendiente: aún requiere atención y no está
 * cerrada (rechazada / reembolsada / cancelada / completada). Fuente única para
 * la bandeja de pendientes y para el gate del subnav de notificaciones.
 */
export function isSafePendingStatus(status: string): boolean {
  return ![
    "rejected",
    "refund_requested",
    "refund_review",
    "cancelled",
    "completed",
  ].includes(status);
}

/**
 * Una sesión agendada cuyo margen de no-show (15 min tras la hora) ya venció se
 * considera "no pendiente": el cron la auto-rechazará. Evita que una sesión
 * caduca mantenga vivo el subnav / la bandeja.
 */
export function isExpiredScheduledService(
  item: Pick<WalletServiceItem, "source" | "status" | "scheduledAt">
): boolean {
  const isScheduledService =
    item.source === "meet_greet" || item.source === "exclusive_session";
  if (!isScheduledService) return false;
  if (
    item.status !== "scheduled" &&
    item.status !== "ready_to_prepare" &&
    item.status !== "in_preparation"
  ) {
    return false;
  }
  if (!item.scheduledAt) return false;
  return Date.now() >= item.scheduledAt.getTime() + 15 * 60 * 1000;
}

export function isHistoryScheduledStatus(status: string): boolean {
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

// Mapea un post de tipo live (del propio creador) a un item de calendario.
// Devuelve null si el live no debe calendarizarse (sin fecha, o ya terminado).
export type LivePostRowData = {
  liveData?: PostLiveData | null;
  authorName?: string | null;
  authorAvatarUrl?: string | null;
  createdAt?: FirestoreTimestampLike;
  updatedAt?: FirestoreTimestampLike;
};

export function normalizeLiveRow(id: string, data: LivePostRowData): WalletServiceItem | null {
  const live = data.liveData ?? null;
  if (!live) return null;

  const scheduledAt = toDateSafe(live.scheduledStartAt);
  if (!scheduledAt) return null; // sin fecha (o solo hora) → no se calendariza

  const status = live.status ?? "upcoming";
  // Solo mientras esté por realizarse o en curso; al terminar/cancelar se cae del calendario.
  if (status !== "scheduled" && status !== "upcoming" && status !== "live") {
    return null;
  }

  const hasTime = live.scheduleHasTime !== false; // undefined (lives viejos) = con hora
  const title = (live.title && live.title.trim()) || "Transmisión en vivo";
  const description = (live.description && live.description.trim()) || null;
  const createdAt = toDateSafe(data.createdAt);
  const updatedAt = toDateSafe(data.updatedAt);

  return {
    id,
    kind: "live",
    title,
    groupId: null,
    groupName: null,
    profileUserId: null,
    profileDisplayName: null,
    profileUsername: null,
    requestSource: null,
    buyerId: "",
    // Para lives reutilizamos estos campos para el avatar/nombre del CREADOR.
    buyerDisplayName: (typeof data.authorName === "string" && data.authorName.trim()) || null,
    buyerUsername: null,
    buyerAvatarUrl: (typeof data.authorAvatarUrl === "string" && data.authorAvatarUrl.trim()) || null,
    sourceAvatarUrl: (live.coverUrl && live.coverUrl.trim()) || null,
    muxPlaybackId: null,
    videoDuration: null,
    deliveredAt: null,
    targetName: null,
    requestText: description,
    // Se normaliza a "scheduled" para fluir por la lógica de calendario/conflicto.
    status: "scheduled",
    statusLabel: "Programado",
    description,
    creatorScheduleNote: null,
    creatorScheduleNoteUpdatedAt: null,
    rejectionReason: null,
    refundReason: null,
    priceSnapshot: typeof live.ticketPrice === "number" ? live.ticketPrice : null,
    currency: live.currency === "MXN" || live.currency === "USD" ? live.currency : null,
    // Con hora: 60 min para medir traslape; solo fecha ("Horario abierto"): sin duración → no choca.
    durationMinutes: hasTime ? 60 : null,
    source: "live",
    scheduledAt,
    acceptedAt: null,
    rejectedAt: null,
    preparingBuyerAt: null,
    preparingCreatorAt: null,
    preparationOpenedAt: null,
    noShowRejectAt: null,
    autoRejectedAt: null,
    autoRejectReason: null,
    noShowRole: null,
    createdAt,
    updatedAt,
    creatorScheduleCount: 0,
    scheduleHistory: [],
    rescheduleHistory: [],
    recordingStatus: null,
    recordingUrl: null,
    recordingDurationSeconds: null,
    recordingExpiresAt: null,
    liveOpenSchedule: !hasTime,
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
