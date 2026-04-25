export const EXCLUSIVE_SESSION_MAX_RESCHEDULE_REQUESTS = 2;
export const EXCLUSIVE_SESSION_PREPARE_WINDOW_MINUTES = 10;

export type ExclusiveSessionStatus =
  | "pending_creator_response"
  | "accepted_pending_schedule"
  | "scheduled"
  | "reschedule_requested"
  | "rejected"
  | "refund_requested"
  | "refund_review"
  | "ready_to_prepare"
  | "in_preparation"
  | "completed"
  | "cancelled";

export type ExclusiveSessionUserRole = "buyer" | "creator";

export type ExclusiveSessionPaymentMode = "simulated_no_real_payment";
export type ExclusiveSessionPaymentStatus = "simulated_paid";

export type ExclusiveSessionScheduleHistoryItem = {
  proposedAt: string | null;
  proposedBy: string | null;
  startsAt: string | null;
  note: string | null;
};

export type ExclusiveSessionRescheduleHistoryItem = {
  requestedAt: string | null;
  requestedBy: string | null;
  reason: string | null;
  countAfterRequest: number;
};

export type ExclusiveSessionRequestRecord = {
  id: string;
  type: "digital_exclusive_session";
  flowVersion: number;

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

  status: ExclusiveSessionStatus;

  buyerMessage: string | null;
  rejectionReason: string | null;
  refundReason: string | null;

    priceSnapshot: number | null;
  currency?: "MXN" | "USD" | null;
  durationMinutes: number | null;

  acceptedAt: string | null;
  rejectedAt: string | null;

  scheduledAt: string | null;
  scheduledBy: string | null;
  scheduleProposedAt: string | null;
  scheduleHistory: ExclusiveSessionScheduleHistoryItem[];

  rescheduleRequestsUsed: number;
  rescheduleRequestedAt: string | null;
  rescheduleHistory: ExclusiveSessionRescheduleHistoryItem[];

  preparingBuyerAt: string | null;
  preparingCreatorAt: string | null;
  preparationOpenedAt: string | null;

  paymentMode: ExclusiveSessionPaymentMode;
  paymentStatus: ExclusiveSessionPaymentStatus;

  createdAt: string | null;
  updatedAt: string | null;
};

export type ExclusiveSessionListItem = ExclusiveSessionRequestRecord;

export function isExclusiveSessionPendingCreatorResponse(status: ExclusiveSessionStatus): boolean {
  return status === "pending_creator_response";
}

export function isExclusiveSessionRejected(status: ExclusiveSessionStatus): boolean {
  return status === "rejected";
}

export function isExclusiveSessionAcceptedPendingSchedule(status: ExclusiveSessionStatus): boolean {
  return status === "accepted_pending_schedule";
}

export function isExclusiveSessionScheduled(status: ExclusiveSessionStatus): boolean {
  return status === "scheduled" || status === "ready_to_prepare" || status === "in_preparation";
}

export function isExclusiveSessionRescheduleRequested(status: ExclusiveSessionStatus): boolean {
  return status === "reschedule_requested";
}

export function isExclusiveSessionRefundRequested(status: ExclusiveSessionStatus): boolean {
  return status === "refund_requested" || status === "refund_review";
}

export function canBuyerRequestRefund(record: Pick<ExclusiveSessionRequestRecord, "status">): boolean {
  return record.status === "rejected";
}

export function canBuyerRetryExclusiveSession(record: Pick<ExclusiveSessionRequestRecord, "status">): boolean {
  return record.status === "rejected";
}

export function canCreatorAcceptExclusiveSession(record: Pick<ExclusiveSessionRequestRecord, "status">): boolean {
  return record.status === "pending_creator_response";
}

export function canCreatorRejectExclusiveSession(record: Pick<ExclusiveSessionRequestRecord, "status">): boolean {
  return (
    record.status === "pending_creator_response" ||
    record.status === "accepted_pending_schedule" ||
    record.status === "reschedule_requested"
  );
}

export function canCreatorProposeSchedule(
  record: Pick<ExclusiveSessionRequestRecord, "status">
): boolean {
  return (
    record.status === "accepted_pending_schedule" ||
    record.status === "reschedule_requested" ||
    record.status === "scheduled" ||
    record.status === "ready_to_prepare"
  );
}

export function canBuyerRequestReschedule(
  record: Pick<ExclusiveSessionRequestRecord, "status" | "rescheduleRequestsUsed">
): boolean {
  return (
    (record.status === "scheduled" || record.status === "ready_to_prepare") &&
    record.rescheduleRequestsUsed < EXCLUSIVE_SESSION_MAX_RESCHEDULE_REQUESTS
  );
}

export function canEnterExclusiveSessionPreparation(
  record: Pick<ExclusiveSessionRequestRecord, "status">
): boolean {
  return (
    record.status === "scheduled" ||
    record.status === "ready_to_prepare" ||
    record.status === "in_preparation"
  );
}

export function getExclusiveSessionRemainingRescheduleRequests(
  used: number | null | undefined
): number {
  const safeUsed = typeof used === "number" && !Number.isNaN(used) ? used : 0;
  return Math.max(0, EXCLUSIVE_SESSION_MAX_RESCHEDULE_REQUESTS - safeUsed);
}

export function getExclusiveSessionStatusLabel(status: ExclusiveSessionStatus): string {
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
      return "Estado desconocido";
  }
}

export function getExclusiveSessionStatusTone(
  status: ExclusiveSessionStatus
): "neutral" | "success" | "warning" | "danger" {
  switch (status) {
    case "scheduled":
    case "accepted_pending_schedule":
    case "completed":
      return "success";
    case "reschedule_requested":
    case "ready_to_prepare":
    case "refund_requested":
    case "refund_review":
      return "warning";
    case "rejected":
    case "cancelled":
      return "danger";
    case "pending_creator_response":
    case "in_preparation":
    default:
      return "neutral";
  }
}