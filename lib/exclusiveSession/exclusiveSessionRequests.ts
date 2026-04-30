import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import type { ExclusiveSessionUserRole } from "./types";

type CallablePayload = Record<string, unknown>;

export type ExclusiveSessionSource = "group" | "profile";

export type ExpireExclusiveSessionNoShowsResult = {
  ok: boolean;
  expiredCount: number;
};

function normalizeCallableError(error: any): Error {
  const rawMessage =
    error?.details?.message ||
    error?.details ||
    error?.message ||
    "Ocurrió un error al ejecutar la operación.";

  const message = String(rawMessage).replace(/^FirebaseError:\s*/i, "");

  return new Error(message);
}

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

function resolveSource(input: {
  groupId?: string | null;
  profileUserId?: string | null;
  creatorId?: string | null;
  source?: ExclusiveSessionSource;
}): ExclusiveSessionSource {
  return input.source ?? (input.profileUserId || input.creatorId ? "profile" : "group");
}

async function callExclusiveSessionFunction<T = unknown>(
  name: string,
  payload: CallablePayload
): Promise<T> {
  try {
    const callable = httpsCallable<CallablePayload, T>(functions, name);
    const result = await callable(payload);
    return result.data;
  } catch (error: any) {
    throw normalizeCallableError(error);
  }
}

export function createExclusiveSessionRequest(payload: {
  groupId?: string | null;
  profileUserId?: string | null;
  creatorId?: string | null;
  source?: ExclusiveSessionSource;
  requestSource?: ExclusiveSessionSource;
  buyerMessage?: string | null;
  priceSnapshot?: number | null;
  durationMinutes?: number | null;
}) {
  const source = resolveSource(payload);

  if (source === "group" && !payload.groupId) {
    throw new Error("Falta el ID del grupo para crear la solicitud.");
  }

  if (source === "profile" && !payload.profileUserId && !payload.creatorId) {
    throw new Error("Falta el ID del perfil para crear la solicitud.");
  }

  return callExclusiveSessionFunction("createExclusiveSessionRequest", {
    groupId:
      source === "group"
        ? assertNonEmptyString(String(payload.groupId ?? ""), "groupId")
        : null,
    profileUserId:
      source === "profile"
        ? assertNonEmptyString(
            String(payload.profileUserId ?? payload.creatorId ?? ""),
            "profileUserId"
          )
        : null,
    creatorId:
      source === "profile"
        ? assertNonEmptyString(
            String(payload.creatorId ?? payload.profileUserId ?? ""),
            "creatorId"
          )
        : null,
source,
requestSource: payload.requestSource ?? source,
buyerMessage: normalizeOptionalString(payload.buyerMessage),
    priceSnapshot: assertOptionalNumber(payload.priceSnapshot, "priceSnapshot", {
      min: 0,
      max: 1000000,
    }),
    durationMinutes: assertOptionalNumber(
      payload.durationMinutes,
      "durationMinutes",
      {
        min: 1,
        max: 600,
      }
    ),
  });
}

export function acceptExclusiveSessionRequest(payload: { requestId: string }) {
  return callExclusiveSessionFunction("acceptExclusiveSessionRequest", {
    requestId: assertNonEmptyString(payload.requestId, "requestId"),
  });
}

export function rejectExclusiveSessionRequest(payload: {
  requestId: string;
  rejectionReason?: string | null;
}) {
  return callExclusiveSessionFunction("rejectExclusiveSessionRequest", {
    requestId: assertNonEmptyString(payload.requestId, "requestId"),
    rejectionReason: normalizeOptionalString(payload.rejectionReason),
  });
}

export function proposeExclusiveSessionSchedule(payload: {
  requestId: string;
  scheduledAt: string;
  note?: string | null;
}) {
  return callExclusiveSessionFunction("proposeExclusiveSessionSchedule", {
    requestId: assertNonEmptyString(payload.requestId, "requestId"),
    scheduledAt: assertNonEmptyString(payload.scheduledAt, "scheduledAt"),
    note: normalizeOptionalString(payload.note),
  });
}

export function requestExclusiveSessionReschedule(payload: {
  requestId: string;
  reason?: string | null;
}) {
  return callExclusiveSessionFunction("requestExclusiveSessionReschedule", {
    requestId: assertNonEmptyString(payload.requestId, "requestId"),
    reason: normalizeOptionalString(payload.reason),
  });
}

export function requestExclusiveSessionRefund(payload: {
  requestId: string;
  refundReason?: string | null;
}) {
  return callExclusiveSessionFunction("requestExclusiveSessionRefund", {
    requestId: assertNonEmptyString(payload.requestId, "requestId"),
    refundReason: normalizeOptionalString(payload.refundReason),
  });
}

export function setExclusiveSessionPreparing(payload: {
  requestId: string;
  role: ExclusiveSessionUserRole;
}) {
  return callExclusiveSessionFunction("setExclusiveSessionPreparing", {
    requestId: assertNonEmptyString(payload.requestId, "requestId"),
    role: payload.role,
  });
}

export function expireExclusiveSessionNoShows() {
  return callExclusiveSessionFunction<ExpireExclusiveSessionNoShowsResult>(
    "expireExclusiveSessionNoShows",
    {}
  );
}