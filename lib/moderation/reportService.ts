import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import type { ReportTargetType, ReportReason } from "./types";

type SubmitReportPayload = {
  targetType: ReportTargetType;
  targetId: string;
  parentId?: string;
  targetOwnerId: string;
  reason: ReportReason;
  description?: string;
};

type SubmitReportResult = {
  ok: boolean;
  duplicate: boolean;
};

type ClaimReportPayload = { reportId: string };
type ResolveReportPayload = {
  reportId: string;
  action: string;
  notes?: string;
};

export async function submitReport(payload: SubmitReportPayload): Promise<SubmitReportResult> {
  const fn = httpsCallable<SubmitReportPayload, SubmitReportResult>(
    functions,
    "submitReport"
  );
  const result = await fn(payload);
  return result.data;
}

export async function claimReport(reportId: string): Promise<void> {
  const fn = httpsCallable<ClaimReportPayload, { ok: boolean }>(
    functions,
    "claimReport"
  );
  await fn({ reportId });
}

export async function resolveReport(
  reportId: string,
  action: string,
  notes?: string
): Promise<void> {
  const fn = httpsCallable<ResolveReportPayload, { ok: boolean }>(
    functions,
    "resolveReport"
  );
  await fn({ reportId, action, notes });
}
