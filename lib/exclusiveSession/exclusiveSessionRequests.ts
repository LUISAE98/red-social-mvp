import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import type { ExclusiveSessionUserRole } from "./types";

type CallablePayload = Record<string, unknown>;

export type ExpireExclusiveSessionNoShowsResult = {
  ok: boolean;
  expiredCount: number;
};

async function callExclusiveSessionFunction<T = unknown>(
  name: string,
  payload: CallablePayload
): Promise<T> {
  const callable = httpsCallable<CallablePayload, T>(functions, name);
  const result = await callable(payload);
  return result.data;
}

export function createExclusiveSessionRequest(payload: {
  groupId: string;
  buyerMessage?: string | null;
  priceSnapshot?: number | null;
  durationMinutes?: number | null;
}) {
  return callExclusiveSessionFunction("createExclusiveSessionRequest", payload);
}

export function acceptExclusiveSessionRequest(payload: { requestId: string }) {
  return callExclusiveSessionFunction("acceptExclusiveSessionRequest", payload);
}

export function rejectExclusiveSessionRequest(payload: {
  requestId: string;
  rejectionReason?: string | null;
}) {
  return callExclusiveSessionFunction("rejectExclusiveSessionRequest", payload);
}

export function proposeExclusiveSessionSchedule(payload: {
  requestId: string;
  scheduledAt: string;
  note?: string | null;
}) {
  return callExclusiveSessionFunction("proposeExclusiveSessionSchedule", payload);
}

export function requestExclusiveSessionReschedule(payload: {
  requestId: string;
  reason?: string | null;
}) {
  return callExclusiveSessionFunction("requestExclusiveSessionReschedule", payload);
}

export function requestExclusiveSessionRefund(payload: {
  requestId: string;
  refundReason?: string | null;
}) {
  return callExclusiveSessionFunction("requestExclusiveSessionRefund", payload);
}

export function setExclusiveSessionPreparing(payload: {
  requestId: string;
  role: ExclusiveSessionUserRole;
}) {
  return callExclusiveSessionFunction("setExclusiveSessionPreparing", payload);
}

export function expireExclusiveSessionNoShows() {
  return callExclusiveSessionFunction<ExpireExclusiveSessionNoShowsResult>(
    "expireExclusiveSessionNoShows",
    {}
  );
}