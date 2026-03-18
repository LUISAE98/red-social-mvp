import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";

type ModerationPayload = {
  groupId: string;
  targetUserId: string;
};

type ModerationResponse = {
  success: boolean;
  status?: "active" | "muted" | "banned";
  removed?: boolean;
  alreadyApplied?: boolean;
};

function normalizeError(error: any): Error {
  const message =
    error?.message ||
    error?.details ||
    "No se pudo completar la acción de moderación.";

  return new Error(String(message));
}

async function callModerationFunction(
  functionName:
    | "muteGroupMember"
    | "unmuteGroupMember"
    | "banGroupMember"
    | "unbanGroupMember"
    | "removeGroupMember",
  payload: ModerationPayload
): Promise<ModerationResponse> {
  try {
    const callable = httpsCallable<ModerationPayload, ModerationResponse>(
      functions,
      functionName
    );

    const result = await callable(payload);
    return result.data;
  } catch (error: any) {
    throw normalizeError(error);
  }
}

export async function muteGroupMember(groupId: string, targetUserId: string) {
  return callModerationFunction("muteGroupMember", { groupId, targetUserId });
}

export async function unmuteGroupMember(groupId: string, targetUserId: string) {
  return callModerationFunction("unmuteGroupMember", { groupId, targetUserId });
}

export async function banGroupMember(groupId: string, targetUserId: string) {
  return callModerationFunction("banGroupMember", { groupId, targetUserId });
}

export async function unbanGroupMember(groupId: string, targetUserId: string) {
  return callModerationFunction("unbanGroupMember", { groupId, targetUserId });
}

export async function removeGroupMember(groupId: string, targetUserId: string) {
  return callModerationFunction("removeGroupMember", { groupId, targetUserId });
}