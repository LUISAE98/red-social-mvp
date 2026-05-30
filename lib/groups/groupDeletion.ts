import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

export type SoftDeleteGroupInput = {
  groupId: string;
  reason?: string | null;
};

export type SoftDeleteGroupResult = {
  ok: boolean;
  groupId: string;
  alreadyDeleted: boolean;
  postsUpdated: number;
  membersUpdated: number;
  userMembershipsUpdated: number;
  homeFeedDeleted: number;
  joinRequestsUpdated: number;
  userJoinRequestsDeleted: number;
  inviteLinksUpdated: number;
};

export async function softDeleteGroup(
  input: SoftDeleteGroupInput
): Promise<SoftDeleteGroupResult> {
  const groupId = input.groupId.trim();

  if (!groupId) {
    throw new Error("groupId es requerido.");
  }

  const callable = httpsCallable<SoftDeleteGroupInput, SoftDeleteGroupResult>(
    functions,
    "softDeleteGroup"
  );

  const result = await callable({
    groupId,
    reason: input.reason?.trim() || null,
  });

  return result.data;
}