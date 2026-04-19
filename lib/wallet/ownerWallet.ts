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

type FirestoreTimestampLike =
  | Timestamp
  | { toDate: () => Date }
  | string
  | number
  | Date
  | null
  | undefined;

export type WalletMeetGreetDoc = {
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
  status: MeetGreetStatus;
  buyerMessage: string | null;
  rejectionReason: string | null;
  refundReason: string | null;
  priceSnapshot: number | null;
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

export type WalletServiceKind = "meet_greet" | "saludo" | "consejo" | "mensaje";

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
  status: string;
  statusLabel: string;
  description: string | null;
  rejectionReason: string | null;
  refundReason: string | null;
  priceSnapshot: number | null;
  durationMinutes: number | null;
  source: "meet_greet" | "greeting";
  scheduledAt: Date | null;
  acceptedAt: Date | null;
  rejectedAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type OwnerWalletDataResult = {
  loading: boolean;
  error: string | null;
  all: WalletServiceItem[];
  calendar: WalletServiceItem[];
  pendingCurrent: WalletServiceItem[];
  pendingRejected: WalletServiceItem[];
  history: WalletServiceItem[];
};

function toDateSafe(value: FirestoreTimestampLike): Date | null {
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

function compareDesc(a: Date | null, b: Date | null): number {
  const aTime = a?.getTime() ?? 0;
  const bTime = b?.getTime() ?? 0;
  return bTime - aTime;
}

function compareAsc(a: Date | null, b: Date | null): number {
  const aTime = a?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const bTime = b?.getTime() ?? Number.MAX_SAFE_INTEGER;
  return aTime - bTime;
}

function getGreetingTypeLabel(type: GreetingType): string {
  switch (type) {
    case "saludo":
      return "Saludo";
    case "consejo":
      return "Consejo";
    case "mensaje":
      return "Mensaje";
    default:
      return "Solicitud";
  }
}

function getGreetingStatusLabel(status: GreetingStatus): string {
  switch (status) {
    case "pending":
      return "Pendiente";
    case "accepted":
      return "Aceptado";
    case "rejected":
      return "Rechazado";
    default:
      return status;
  }
}

function normalizeMeetGreetRow(
  id: string,
  data: Partial<WalletMeetGreetDoc>
): WalletServiceItem {
  const status = (data.status ?? "pending_creator_response") as MeetGreetStatus;

  return {
    id,
    kind: "meet_greet",
    title: "Meet & Greet",
    groupId: data.groupId ?? "",
    groupName: data.groupName ?? null,
    buyerId: data.buyerId ?? "",
    buyerDisplayName: data.buyerDisplayName ?? null,
    buyerUsername: data.buyerUsername ?? null,
    buyerAvatarUrl: data.buyerAvatarUrl ?? null,
    status,
    statusLabel: getMeetGreetStatusLabel(status),
    description: data.buyerMessage ?? null,
    rejectionReason: data.rejectionReason ?? null,
    refundReason: data.refundReason ?? null,
    priceSnapshot: typeof data.priceSnapshot === "number" ? data.priceSnapshot : null,
    durationMinutes:
      typeof data.durationMinutes === "number" ? data.durationMinutes : null,
    source: "meet_greet",
    scheduledAt: toDateSafe(data.scheduledAt),
    acceptedAt: toDateSafe(data.acceptedAt),
    rejectedAt: toDateSafe(data.rejectedAt),
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
    status,
    statusLabel: getGreetingStatusLabel(status),
    description:
      data.instructions?.trim() ||
      (data.toName ? `Para: ${data.toName}` : null),
    rejectionReason: null,
    refundReason: null,
    priceSnapshot: null,
    durationMinutes: null,
    source: "greeting",
    scheduledAt: null,
    acceptedAt: status === "accepted" ? toDateSafe(data.updatedAt) : null,
    rejectedAt: status === "rejected" ? toDateSafe(data.updatedAt) : null,
    createdAt: toDateSafe(data.createdAt),
    updatedAt: toDateSafe(data.updatedAt),
  };
}

function isCalendarMeetGreetStatus(status: string): boolean {
  return (
    status === "scheduled" ||
    status === "ready_to_prepare" ||
    status === "in_preparation"
  );
}

function isPendingCurrentMeetGreetStatus(status: string): boolean {
  return (
    status === "pending_creator_response" ||
    status === "accepted_pending_schedule" ||
    status === "scheduled" ||
    status === "reschedule_requested" ||
    status === "ready_to_prepare" ||
    status === "in_preparation"
  );
}

function isPendingRejectedMeetGreetStatus(status: string): boolean {
  return (
    status === "rejected" ||
    status === "refund_requested" ||
    status === "refund_review" ||
    status === "cancelled"
  );
}

function isHistoryMeetGreetStatus(status: string): boolean {
  return status === "completed";
}

function isPendingCurrentGreetingStatus(status: string): boolean {
  return status === "pending";
}

function isPendingRejectedGreetingStatus(status: string): boolean {
  return status === "rejected";
}

function isHistoryGreetingStatus(status: string): boolean {
  return status === "accepted";
}

export function useOwnerWalletData(
  creatorId: string | null | undefined
): OwnerWalletDataResult {
  const [loadingMeetGreets, setLoadingMeetGreets] = useState(true);
  const [loadingGreetings, setLoadingGreetings] = useState(true);
  const [meetGreetError, setMeetGreetError] = useState<string | null>(null);
  const [greetingError, setGreetingError] = useState<string | null>(null);
  const [meetGreetRows, setMeetGreetRows] = useState<WalletServiceItem[]>([]);
  const [greetingRows, setGreetingRows] = useState<WalletServiceItem[]>([]);

  useEffect(() => {
    if (!creatorId) {
      setMeetGreetRows([]);
      setMeetGreetError(null);
      setLoadingMeetGreets(false);
      return;
    }

    setLoadingMeetGreets(true);
    setMeetGreetError(null);

    const q = query(
      collection(db, "meetGreetRequests"),
      where("creatorId", "==", creatorId),
      limit(100)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const next = snap.docs.map((d) =>
          normalizeMeetGreetRow(d.id, d.data() as Partial<WalletMeetGreetDoc>)
        );
        setMeetGreetRows(next);
        setMeetGreetError(null);
        setLoadingMeetGreets(false);
      },
      (err: any) => {
        setMeetGreetRows([]);
        setMeetGreetError(
          err?.message ?? "No se pudieron cargar los Meet & Greet de la wallet."
        );
        setLoadingMeetGreets(false);
      }
    );

    return () => unsub();
  }, [creatorId]);

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
        const next = snap.docs.map((d) =>
          normalizeGreetingRow(d.id, d.data() as Partial<WalletGreetingDoc>)
        );
        setGreetingRows(next);
        setGreetingError(null);
        setLoadingGreetings(false);
      },
      (err: any) => {
        setGreetingRows([]);
        setGreetingError(
          err?.message ?? "No se pudieron cargar los saludos y consejos de la wallet."
        );
        setLoadingGreetings(false);
      }
    );

    return () => unsub();
  }, [creatorId]);

  const derived = useMemo(() => {
    const all = [...meetGreetRows, ...greetingRows].sort((a, b) =>
      compareDesc(a.createdAt, b.createdAt)
    );

    const calendar = meetGreetRows
      .filter((row) => isCalendarMeetGreetStatus(row.status))
      .sort((a, b) => compareAsc(a.scheduledAt, b.scheduledAt));

    const pendingCurrent = [...meetGreetRows, ...greetingRows]
      .filter((row) => {
        if (row.source === "meet_greet") {
          return isPendingCurrentMeetGreetStatus(row.status);
        }
        return isPendingCurrentGreetingStatus(row.status);
      })
      .sort((a, b) => {
        const aPrimary = a.scheduledAt ?? a.createdAt;
        const bPrimary = b.scheduledAt ?? b.createdAt;
        return compareAsc(aPrimary, bPrimary);
      });

    const pendingRejected = [...meetGreetRows, ...greetingRows]
      .filter((row) => {
        if (row.source === "meet_greet") {
          return isPendingRejectedMeetGreetStatus(row.status);
        }
        return isPendingRejectedGreetingStatus(row.status);
      })
      .sort((a, b) => compareDesc(a.updatedAt, b.updatedAt));

    const history = [...meetGreetRows, ...greetingRows]
      .filter((row) => {
        if (row.source === "meet_greet") {
          return isHistoryMeetGreetStatus(row.status);
        }
        return isHistoryGreetingStatus(row.status);
      })
      .sort((a, b) => compareDesc(a.updatedAt, b.updatedAt));

    return {
      all,
      calendar,
      pendingCurrent,
      pendingRejected,
      history,
    };
  }, [greetingRows, meetGreetRows]);

  const error = useMemo(() => {
    const parts = [meetGreetError, greetingError].filter(Boolean);
    return parts.length > 0 ? parts.join(" ") : null;
  }, [greetingError, meetGreetError]);

  return {
    loading: loadingMeetGreets || loadingGreetings,
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
  if (row.source === "meet_greet" && row.status === "accepted_pending_schedule") {
    return "Pendiente de asignar fecha";
  }

  if (row.scheduledAt) {
    return formatWalletDateTime(row.scheduledAt);
  }

  if (row.updatedAt) {
    return formatWalletDateTime(row.updatedAt);
  }

  if (row.createdAt) {
    return formatWalletDateTime(row.createdAt);
  }

  return "Sin fecha";
}