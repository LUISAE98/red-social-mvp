import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

export type MeetGreetUserRole = "buyer" | "creator";

export type CreateMeetGreetRequestInput = {
  groupId: string;
  buyerMessage?: string | null;
  priceSnapshot?: number | null;
  durationMinutes?: number | null;
};

export type CreateMeetGreetRequestResult = {
  ok: boolean;
  requestId: string;
  status: string;
  creatorId: string;
};

export type AcceptMeetGreetRequestInput = {
  requestId: string;
};

export type AcceptMeetGreetRequestResult = {
  ok: boolean;
  requestId: string;
  status: string;
};

export type RejectMeetGreetRequestInput = {
  requestId: string;
  rejectionReason?: string | null;
};

export type RejectMeetGreetRequestResult = {
  ok: boolean;
  requestId: string;
  status: string;
};

export type ProposeMeetGreetScheduleInput = {
  requestId: string;
  scheduledAt: string;
  note?: string | null;
};

export type ProposeMeetGreetScheduleResult = {
  ok: boolean;
  requestId: string;
  status: string;
  scheduledAt: string;
  prepareWindowStartsAt: string;
  noShowAutoRejectAt?: string;
};

export type RequestMeetGreetRescheduleInput = {
  requestId: string;
  reason?: string | null;
};

export type RequestMeetGreetRescheduleResult = {
  ok: boolean;
  requestId: string;
  status: string;
  rescheduleRequestsUsed: number;
  maxRescheduleRequests: number;
};

export type RequestMeetGreetRefundInput = {
  requestId: string;
  refundReason?: string | null;
};

export type RequestMeetGreetRefundResult = {
  ok: boolean;
  requestId: string;
  status: string;
};

export type SetMeetGreetPreparingInput = {
  requestId: string;
  role: MeetGreetUserRole;
};

export type SetMeetGreetPreparingResult = {
  ok: boolean;
  requestId: string;
  status: string;
  role: MeetGreetUserRole;
};

export type ExpireMeetGreetNoShowsResult = {
  ok: boolean;
  expiredCount: number;
};

function normalizeOptionalString(value?: string | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function assertNonEmptyString(value: string, fieldName: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error(`El campo ${fieldName} es obligatorio.`);
  }

  return trimmed;
}

function assertOptionalNumber(
  value: number | null | undefined,
  fieldName: string,
  options?: { min?: number; max?: number }
): number | null {
  if (value == null) return null;

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`El campo ${fieldName} debe ser un número válido.`);
  }

  if (options?.min != null && value < options.min) {
    throw new Error(`El campo ${fieldName} debe ser mayor o igual a ${options.min}.`);
  }

  if (options?.max != null && value > options.max) {
    throw new Error(`El campo ${fieldName} debe ser menor o igual a ${options.max}.`);
  }

  return value;
}

function assertIsoDateString(value: string, fieldName: string): string {
  const trimmed = assertNonEmptyString(value, fieldName);
  const date = new Date(trimmed);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`El campo ${fieldName} debe ser una fecha válida en formato ISO.`);
  }

  return date.toISOString();
}

function normalizeCallableError(error: any): Error {
  const message =
    error?.message ||
    error?.details?.message ||
    error?.details ||
    "Ocurrió un error al ejecutar la operación.";

  return message instanceof Error ? message : new Error(String(message));
}

export async function createMeetGreetRequest(
  input: CreateMeetGreetRequestInput
): Promise<CreateMeetGreetRequestResult> {
  try {
    const callable = httpsCallable<
      {
        groupId: string;
        buyerMessage: string | null;
        priceSnapshot: number | null;
        durationMinutes: number | null;
      },
      CreateMeetGreetRequestResult
    >(functions, "createMeetGreetRequest");

    const payload = {
      groupId: assertNonEmptyString(input.groupId, "groupId"),
      buyerMessage: normalizeOptionalString(input.buyerMessage),
      priceSnapshot: assertOptionalNumber(input.priceSnapshot, "priceSnapshot", {
        min: 0,
        max: 1000000,
      }),
      durationMinutes: assertOptionalNumber(
        input.durationMinutes,
        "durationMinutes",
        {
          min: 1,
          max: 600,
        }
      ),
    };

    const result = await callable(payload);
    return result.data;
  } catch (error: any) {
    throw normalizeCallableError(error);
  }
}

export async function acceptMeetGreetRequest(
  input: AcceptMeetGreetRequestInput
): Promise<AcceptMeetGreetRequestResult> {
  try {
    const callable = httpsCallable<
      { requestId: string },
      AcceptMeetGreetRequestResult
    >(functions, "acceptMeetGreetRequest");

    const result = await callable({
      requestId: assertNonEmptyString(input.requestId, "requestId"),
    });

    return result.data;
  } catch (error: any) {
    throw normalizeCallableError(error);
  }
}

export async function rejectMeetGreetRequest(
  input: RejectMeetGreetRequestInput
): Promise<RejectMeetGreetRequestResult> {
  try {
    const callable = httpsCallable<
      { requestId: string; rejectionReason: string | null },
      RejectMeetGreetRequestResult
    >(functions, "rejectMeetGreetRequest");

    const result = await callable({
      requestId: assertNonEmptyString(input.requestId, "requestId"),
      rejectionReason: normalizeOptionalString(input.rejectionReason),
    });

    return result.data;
  } catch (error: any) {
    throw normalizeCallableError(error);
  }
}

export async function proposeMeetGreetSchedule(
  input: ProposeMeetGreetScheduleInput
): Promise<ProposeMeetGreetScheduleResult> {
  try {
    const callable = httpsCallable<
      { requestId: string; scheduledAt: string; note: string | null },
      ProposeMeetGreetScheduleResult
    >(functions, "proposeMeetGreetSchedule");

    const result = await callable({
      requestId: assertNonEmptyString(input.requestId, "requestId"),
      scheduledAt: assertIsoDateString(input.scheduledAt, "scheduledAt"),
      note: normalizeOptionalString(input.note),
    });

    return result.data;
  } catch (error: any) {
    throw normalizeCallableError(error);
  }
}

export async function requestMeetGreetReschedule(
  input: RequestMeetGreetRescheduleInput
): Promise<RequestMeetGreetRescheduleResult> {
  try {
    const callable = httpsCallable<
      { requestId: string; reason: string | null },
      RequestMeetGreetRescheduleResult
    >(functions, "requestMeetGreetReschedule");

    const result = await callable({
      requestId: assertNonEmptyString(input.requestId, "requestId"),
      reason: normalizeOptionalString(input.reason),
    });

    return result.data;
  } catch (error: any) {
    throw normalizeCallableError(error);
  }
}

export async function requestMeetGreetRefund(
  input: RequestMeetGreetRefundInput
): Promise<RequestMeetGreetRefundResult> {
  try {
    const callable = httpsCallable<
      { requestId: string; refundReason: string | null },
      RequestMeetGreetRefundResult
    >(functions, "requestMeetGreetRefund");

    const result = await callable({
      requestId: assertNonEmptyString(input.requestId, "requestId"),
      refundReason: normalizeOptionalString(input.refundReason),
    });

    return result.data;
  } catch (error: any) {
    throw normalizeCallableError(error);
  }
}

export async function setMeetGreetPreparing(
  input: SetMeetGreetPreparingInput
): Promise<SetMeetGreetPreparingResult> {
  try {
    const callable = httpsCallable<
      { requestId: string; role: MeetGreetUserRole },
      SetMeetGreetPreparingResult
    >(functions, "setMeetGreetPreparing");

    if (input.role !== "buyer" && input.role !== "creator") {
      throw new Error("El campo role debe ser buyer o creator.");
    }

    const result = await callable({
      requestId: assertNonEmptyString(input.requestId, "requestId"),
      role: input.role,
    });

    return result.data;
  } catch (error: any) {
    throw normalizeCallableError(error);
  }
}

export async function expireMeetGreetNoShows(): Promise<ExpireMeetGreetNoShowsResult> {
  try {
    const callable = httpsCallable<Record<string, never>, ExpireMeetGreetNoShowsResult>(
      functions,
      "expireMeetGreetNoShows"
    );

    const result = await callable({});

    return result.data;
  } catch (error: any) {
    throw normalizeCallableError(error);
  }
}
