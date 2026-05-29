import {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import type {
  GroupMemberBlock,
  GroupMemberBlockRelationship,
} from "@/lib/posts/types";

function assertValidId(value: string | null | undefined, label: string) {
  if (!value || !value.trim()) {
    throw new Error(`Falta ${label}.`);
  }
}

export function getGroupMemberBlockDocId(
  blockerUid: string,
  blockedUid: string
): string {
  return `${blockerUid}_${blockedUid}`;
}

export async function getGroupMemberBlockRelationship(params: {
  groupId: string;
  currentUserId: string;
  targetUserId: string;
}): Promise<GroupMemberBlockRelationship> {
  const groupId = params.groupId.trim();
  const currentUserId = params.currentUserId.trim();
  const targetUserId = params.targetUserId.trim();

  if (!groupId || !currentUserId || !targetUserId || currentUserId === targetUserId) {
    return {
      hasBlocked: false,
      isBlockedBy: false,
    };
  }

  const [hasBlockedSnap, isBlockedBySnap] = await Promise.all([
    getDoc(
      doc(
        db,
        "groups",
        groupId,
        "memberBlocks",
        getGroupMemberBlockDocId(currentUserId, targetUserId)
      )
    ),
    getDoc(
      doc(
        db,
        "groups",
        groupId,
        "memberBlocks",
        getGroupMemberBlockDocId(targetUserId, currentUserId)
      )
    ),
  ]);

  return {
    hasBlocked: hasBlockedSnap.exists(),
    isBlockedBy: isBlockedBySnap.exists(),
  };
}

export async function blockGroupMemberForCurrentUser(params: {
  groupId: string;
  targetUserId: string;
}): Promise<GroupMemberBlock> {
  const authUserId = auth.currentUser?.uid ?? null;

  assertValidId(authUserId, "currentUserId");
  assertValidId(params.groupId, "groupId");
  assertValidId(params.targetUserId, "targetUserId");

  const currentUserId = String(authUserId).trim();
  const groupId = params.groupId.trim();
  const targetUserId = params.targetUserId.trim();

  if (currentUserId === targetUserId) {
    throw new Error("No puedes bloquearte a ti mismo.");
  }

  const blockId = getGroupMemberBlockDocId(currentUserId, targetUserId);
  const blockRef = doc(db, "groups", groupId, "memberBlocks", blockId);

  const payload = {
    groupId,
    blockerId: currentUserId,
    blockedUserId: targetUserId,
    createdAt: serverTimestamp(),
  };

  await setDoc(blockRef, payload, { merge: false });

  return {
    id: blockId,
    groupId,
    blockerId: currentUserId,
    blockedUserId: targetUserId,
    createdAt: null,
  };
}

export async function unblockGroupMemberForCurrentUser(params: {
  groupId: string;
  targetUserId: string;
}): Promise<void> {
  const authUserId = auth.currentUser?.uid ?? null;

  assertValidId(authUserId, "currentUserId");
  assertValidId(params.groupId, "groupId");
  assertValidId(params.targetUserId, "targetUserId");

 const currentUserId = String(authUserId).trim();
  const groupId = params.groupId.trim();
  const targetUserId = params.targetUserId.trim();

  if (currentUserId === targetUserId) {
    return;
  }

  const blockId = getGroupMemberBlockDocId(currentUserId, targetUserId);

  await deleteDoc(doc(db, "groups", groupId, "memberBlocks", blockId));
}