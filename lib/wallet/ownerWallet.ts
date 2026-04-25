import { useEffect, useMemo, useState } from "react";
import {
  collection,
  limit,
  onSnapshot,
  query,
  where,
  type Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
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
  groupId: string;
  groupName: string | null;
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
  rescheduleRequestsUsed: number;
  rescheduleRequestedAt: FirestoreTimestampLike;
  preparingBuyerAt: FirestoreTimestampLike;
  preparingCreatorAt: FirestoreTimestampLike;
  preparationOpenedAt: FirestoreTimestampLike;
  createdAt: FirestoreTimestampLike;
  updatedAt: FirestoreTimestampLike;
};

export type WalletMeetGreetDoc = WalletScheduledDoc & {
  status: MeetGreetStatus;
};

export type WalletExclusiveSessionDoc = WalletScheduledDoc & {
  status: ExclusiveSessionStatus;
};

export type GreetingType = "saludo" | "consejo" | "mensaje";
export type GreetingSource = "group" | "profile";
export type GreetingStatus = "pending" | "accepted" | "rejected";

export type WalletGreetingDoc = {
  id: string;
  groupId: string;
  creatorId: string;
  buyerId: string;
  type: GreetingType;
  toName: string | null;
  instructions: string | null;
  source: GreetingSource | null;
  status: GreetingStatus;
  createdAt: FirestoreTimestampLike;
  updatedAt: FirestoreTimestampLike;
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
  groupId: string;
  groupName: string | null;
  buyerId: string;
  buyerDisplayName: string | null;
  buyerUsername: string | null;
  buyerAvatarUrl: string | null;
  targetName: string | null;
  requestText: string | null;
  status: string;
  statusLabel: string;
  description: string | null;
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
  createdAt: Date | null;
  updatedAt: Date | null;
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

function normalizeScheduledRow(
  id: string,
  data: Partial<WalletScheduledDoc>,
  source: "meet_greet" | "exclusive_session"
): WalletServiceItem {
  const status = (data.status ?? "pending_creator_response") as ScheduledStatus;
  const isExclusive = source === "exclusive_session";

  return {
    id,
    kind: isExclusive ? "exclusive_session" : "meet_greet",
    title: isExclusive ? "Sesión exclusiva" : "Meet & Greet",
    groupId: data.groupId ?? "",
    groupName: data.groupName ?? null,
    buyerId: data.buyerId ?? "",
    buyerDisplayName: data.buyerDisplayName ?? null,
    buyerUsername: data.buyerUsername ?? null,
    buyerAvatarUrl: data.buyerAvatarUrl ?? null,
    targetName: null,
    requestText: data.buyerMessage ?? null,
    status,
    statusLabel: isExclusive
      ? getExclusiveSessionStatusLabel(status as ExclusiveSessionStatus)
      : getMeetGreetStatusLabel(status as MeetGreetStatus),
    description: data.buyerMessage ?? null,
    rejectionReason: data.rejectionReason ?? null,
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
    scheduledAt: toDateSafe(data.scheduledAt),
    acceptedAt: toDateSafe(data.acceptedAt),
    rejectedAt: toDateSafe(data.rejectedAt),
    preparingBuyerAt: toDateSafe(data.preparingBuyerAt),
    preparingCreatorAt: toDateSafe(data.preparingCreatorAt),
    preparationOpenedAt: toDateSafe(data.preparationOpenedAt),
    createdAt: toDateSafe(data.createdAt),
    updatedAt: toDateSafe(data.updatedAt),
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
    groupId: data.groupId ?? "",
    groupName: null,
    buyerId: data.buyerId ?? "",
    buyerDisplayName: null,
    buyerUsername: null,
    buyerAvatarUrl: null,
    targetName: data.toName?.trim() || null,
    requestText: data.instructions?.trim() || null,
    status,
    statusLabel: getGreetingStatusLabel(status),
    description: data.instructions?.trim() || null,
    rejectionReason: null,
    refundReason: null,
    priceSnapshot: null,
    durationMinutes: null,
    source: "greeting",
    scheduledAt: null,
    acceptedAt: status === "accepted" ? toDateSafe(data.updatedAt) : null,
    rejectedAt: status === "rejected" ? toDateSafe(data.updatedAt) : null,
    preparingBuyerAt: null,
    preparingCreatorAt: null,
    preparationOpenedAt: null,
    createdAt: toDateSafe(data.createdAt),
    updatedAt: toDateSafe(data.updatedAt),
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
      (err: any) => {
        setRows([]);
        setError(err?.message ?? `No se pudo cargar ${collectionName}.`);
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
      (snap) => {
        setGreetingRows(
          snap.docs.map((d) =>
            normalizeGreetingRow(d.id, d.data() as Partial<WalletGreetingDoc>)
          )
        );
        setGreetingError(null);
        setLoadingGreetings(false);
      },
      (err: any) => {
        setGreetingRows([]);
        setGreetingError(
          err?.message ??
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
      .filter((row) => isCalendarScheduledStatus(row.status))
      .sort((a, b) => compareAsc(a.scheduledAt, b.scheduledAt));

    const pendingCurrent = combined
      .filter((row) =>
        row.source === "greeting"
          ? row.status === "pending"
          : isPendingCurrentScheduledStatus(row.status)
      )
      .sort((a, b) =>
        compareAsc(a.scheduledAt ?? a.createdAt, b.scheduledAt ?? b.createdAt)
      );

    const history = combined
      .filter((row) =>
        row.source === "greeting"
          ? row.status === "accepted" || row.status === "rejected"
          : isHistoryScheduledStatus(row.status)
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