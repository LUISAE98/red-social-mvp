export const MEET_GREET_MAX_RESCHEDULE_REQUESTS = 2;
export const MEET_GREET_PREPARE_WINDOW_MINUTES = 10;

export type MeetGreetStatus =
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

export type MeetGreetUserRole = "buyer" | "creator";

export type MeetGreetPaymentMode = "simulated_no_real_payment";
export type MeetGreetPaymentStatus = "simulated_paid";

export type MeetGreetScheduleHistoryItem = {
  proposedAt: string | null;
  proposedBy: string | null;
  startsAt: string | null;
  note: string | null;
};

export type MeetGreetRescheduleHistoryItem = {
  requestedAt: string | null;
  requestedBy: string | null;
  reason: string | null;
  countAfterRequest: number;
};

export type MeetGreetRequestRecord = {
  id: string;
  type: "digital_meet_greet";
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

  status: MeetGreetStatus;

  buyerMessage: string | null;
  rejectionReason: string | null;
  refundReason: string | null;

  priceSnapshot: number | null;
  durationMinutes: number | null;

  acceptedAt: string | null;
  rejectedAt: string | null;

  scheduledAt: string | null;
  scheduledBy: string | null;
  scheduleProposedAt: string | null;
  scheduleHistory: MeetGreetScheduleHistoryItem[];

  rescheduleRequestsUsed: number;
  rescheduleRequestedAt: string | null;
  rescheduleHistory: MeetGreetRescheduleHistoryItem[];

  preparingBuyerAt: string | null;
  preparingCreatorAt: string | null;
  preparationOpenedAt: string | null;

  paymentMode: MeetGreetPaymentMode;
  paymentStatus: MeetGreetPaymentStatus;

  createdAt: string | null;
  updatedAt: string | null;
};

export type MeetGreetListItem = MeetGreetRequestRecord;

export function isMeetGreetPendingCreatorResponse(status: MeetGreetStatus): boolean {
  return status === "pending_creator_response";
}

export function isMeetGreetRejected(status: MeetGreetStatus): boolean {
  return status === "rejected";
}

export function isMeetGreetAcceptedPendingSchedule(status: MeetGreetStatus): boolean {
  return status === "accepted_pending_schedule";
}

export function isMeetGreetScheduled(status: MeetGreetStatus): boolean {
  return status === "scheduled" || status === "ready_to_prepare" || status === "in_preparation";
}

export function isMeetGreetRescheduleRequested(status: MeetGreetStatus): boolean {
  return status === "reschedule_requested";
}

export function isMeetGreetRefundRequested(status: MeetGreetStatus): boolean {
  return status === "refund_requested" || status === "refund_review";
}

export function canBuyerRequestRefund(record: Pick<MeetGreetRequestRecord, "status">): boolean {
  return record.status === "rejected";
}

export function canBuyerRetryMeetGreet(record: Pick<MeetGreetRequestRecord, "status">): boolean {
  return record.status === "rejected";
}

export function canCreatorAcceptMeetGreet(record: Pick<MeetGreetRequestRecord, "status">): boolean {
  return record.status === "pending_creator_response";
}

export function canCreatorRejectMeetGreet(record: Pick<MeetGreetRequestRecord, "status">): boolean {
  return (
    record.status === "pending_creator_response" ||
    record.status === "accepted_pending_schedule" ||
    record.status === "reschedule_requested"
  );
}

export function canCreatorProposeSchedule(
  record: Pick<MeetGreetRequestRecord, "status">
): boolean {
  return (
    record.status === "accepted_pending_schedule" ||
    record.status === "reschedule_requested" ||
    record.status === "scheduled" ||
    record.status === "ready_to_prepare"
  );
}

export function canBuyerRequestReschedule(
  record: Pick<MeetGreetRequestRecord, "status" | "rescheduleRequestsUsed">
): boolean {
  return (
    (record.status === "scheduled" || record.status === "ready_to_prepare") &&
    record.rescheduleRequestsUsed < MEET_GREET_MAX_RESCHEDULE_REQUESTS
  );
}

export function canEnterMeetGreetPreparation(
  record: Pick<MeetGreetRequestRecord, "status">
): boolean {
  return (
    record.status === "scheduled" ||
    record.status === "ready_to_prepare" ||
    record.status === "in_preparation"
  );
}

export function getMeetGreetRemainingRescheduleRequests(
  used: number | null | undefined
): number {
  const safeUsed = typeof used === "number" && !Number.isNaN(used) ? used : 0;
  return Math.max(0, MEET_GREET_MAX_RESCHEDULE_REQUESTS - safeUsed);
}

export function getMeetGreetStatusLabel(status: MeetGreetStatus): string {
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

export function getMeetGreetStatusTone(
  status: MeetGreetStatus
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