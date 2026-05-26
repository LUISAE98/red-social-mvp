import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

type JoinRequestAdminParams = {
  groupId: string;
  userId: string;
};

type JoinRequestAdminResult = {
  ok?: boolean;
};

function normalizeRequiredId(value: string, label: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";

  if (!normalized) {
    throw new Error(`${label} es requerido.`);
  }

  return normalized;
}

export const approveJoinRequest = async (groupId: string, userId: string) => {
  const normalizedGroupId = normalizeRequiredId(groupId, "groupId");
  const normalizedUserId = normalizeRequiredId(userId, "userId");

  const fn = httpsCallable<JoinRequestAdminParams, JoinRequestAdminResult>(
    functions,
    "approveJoinRequest"
  );

  await fn({
    groupId: normalizedGroupId,
    userId: normalizedUserId,
  });
};

export const rejectJoinRequest = async (groupId: string, userId: string) => {
  const normalizedGroupId = normalizeRequiredId(groupId, "groupId");
  const normalizedUserId = normalizeRequiredId(userId, "userId");

  const fn = httpsCallable<JoinRequestAdminParams, JoinRequestAdminResult>(
    functions,
    "rejectJoinRequest"
  );

  await fn({
    groupId: normalizedGroupId,
    userId: normalizedUserId,
  });
};