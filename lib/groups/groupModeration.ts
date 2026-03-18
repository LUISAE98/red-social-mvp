import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

type BasePayload = {
  groupId: string;
  targetUserId: string;
};

type MutePayload = BasePayload & {
  durationDays: number;
};

function assertIds(groupId: string, targetUserId: string) {
  if (!groupId?.trim()) {
    throw new Error("groupId es requerido.");
  }
  if (!targetUserId?.trim()) {
    throw new Error("targetUserId es requerido.");
  }
}

export async function muteGroupMember(
  groupId: string,
  targetUserId: string,
  durationDays: number
) {
  assertIds(groupId, targetUserId);

  if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 365) {
    throw new Error("durationDays debe ser un entero entre 1 y 365.");
  }

  const callable = httpsCallable<MutePayload, { ok: true; mutedUntil: string }>(
    functions,
    "muteGroupMember"
  );

  const res = await callable({ groupId, targetUserId, durationDays });
  return res.data;
}

export async function unmuteGroupMember(groupId: string, targetUserId: string) {
  assertIds(groupId, targetUserId);

  const callable = httpsCallable<BasePayload, { ok: true }>(
    functions,
    "unmuteGroupMember"
  );

  const res = await callable({ groupId, targetUserId });
  return res.data;
}

export async function banGroupMember(groupId: string, targetUserId: string) {
  assertIds(groupId, targetUserId);

  const callable = httpsCallable<BasePayload, { ok: true }>(
    functions,
    "banGroupMember"
  );

  const res = await callable({ groupId, targetUserId });
  return res.data;
}

export async function unbanGroupMember(groupId: string, targetUserId: string) {
  assertIds(groupId, targetUserId);

  const callable = httpsCallable<BasePayload, { ok: true }>(
    functions,
    "unbanGroupMember"
  );

  const res = await callable({ groupId, targetUserId });
  return res.data;
}

export async function removeGroupMember(groupId: string, targetUserId: string) {
  assertIds(groupId, targetUserId);

  const callable = httpsCallable<BasePayload, { ok: true }>(
    functions,
    "removeGroupMember"
  );

  const res = await callable({ groupId, targetUserId });
  return res.data;
}