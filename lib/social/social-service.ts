import {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";

import { db } from "@/lib/firebase";

import type {
  BlockUserInput,
  FollowUserInput,
  GetSocialRelationshipInput,
  SocialRelationshipStatus,
  UnblockUserInput,
  UnfollowUserInput,
  UserBlockedDoc,
  UserFollowerDoc,
  UserFollowingDoc,
} from "@/types/social";

function getFollowingDocRef(userId: string, targetUserId: string) {
  return doc(db, "users", userId, "following", targetUserId);
}

function getFollowerDocRef(userId: string, followerUserId: string) {
  return doc(db, "users", userId, "followers", followerUserId);
}

function getBlockedUserDocRef(userId: string, blockedUserId: string) {
  return doc(db, "users", userId, "blockedUsers", blockedUserId);
}

export async function getSocialRelationship(
  input: GetSocialRelationshipInput
): Promise<SocialRelationshipStatus> {
  const { currentUserId, targetUserId } = input;

  if (!currentUserId || !targetUserId) {
    return {
      isFollowing: false,
      isFollowedBy: false,
      hasBlocked: false,
      isBlockedBy: false,
      canInteract: false,
      canFollow: false,
    };
  }

  if (currentUserId === targetUserId) {
    return {
      isFollowing: false,
      isFollowedBy: false,
      hasBlocked: false,
      isBlockedBy: false,
      canInteract: true,
      canFollow: false,
    };
  }

  const [
    followingDoc,
    followerDoc,
    blockedDoc,
    blockedByDoc,
  ] = await Promise.all([
    getDoc(getFollowingDocRef(currentUserId, targetUserId)),
    getDoc(getFollowerDocRef(currentUserId, targetUserId)),
    getDoc(getBlockedUserDocRef(currentUserId, targetUserId)),
    getDoc(getBlockedUserDocRef(targetUserId, currentUserId)),
  ]);

  const isFollowing = followingDoc.exists();
  const isFollowedBy = followerDoc.exists();
  const hasBlocked = blockedDoc.exists();
  const isBlockedBy = blockedByDoc.exists();

  const canInteract = !hasBlocked && !isBlockedBy;

  return {
    isFollowing,
    isFollowedBy,
    hasBlocked,
    isBlockedBy,
    canInteract,
    canFollow: canInteract,
  };
}

export async function followUser(
  input: FollowUserInput
): Promise<void> {
  const { currentUserId, targetUserId } = input;

  if (!currentUserId || !targetUserId) {
    throw new Error("Missing required user ids.");
  }

  if (currentUserId === targetUserId) {
    throw new Error("Users cannot follow themselves.");
  }

  const relationship = await getSocialRelationship({
    currentUserId,
    targetUserId,
  });

  if (!relationship.canFollow) {
    throw new Error("Follow is not allowed.");
  }

  const batch = writeBatch(db);

  const followingRef = getFollowingDocRef(
    currentUserId,
    targetUserId
  );

  const followerRef = getFollowerDocRef(
    targetUserId,
    currentUserId
  );

  const followingData: UserFollowingDoc = {
    userId: currentUserId,
    targetUserId,
    createdAt: serverTimestamp() as never,
  };

  const followerData: UserFollowerDoc = {
    userId: targetUserId,
    followerUserId: currentUserId,
    createdAt: serverTimestamp() as never,
  };

  batch.set(followingRef, followingData);
  batch.set(followerRef, followerData);

  await batch.commit();
}

export async function unfollowUser(
  input: UnfollowUserInput
): Promise<void> {
  const { currentUserId, targetUserId } = input;

  if (!currentUserId || !targetUserId) {
    throw new Error("Missing required user ids.");
  }

  const batch = writeBatch(db);

  batch.delete(
    getFollowingDocRef(currentUserId, targetUserId)
  );

  batch.delete(
    getFollowerDocRef(targetUserId, currentUserId)
  );

  await batch.commit();
}

export async function blockUser(
  input: BlockUserInput
): Promise<void> {
  const { currentUserId, targetUserId } = input;

  if (!currentUserId || !targetUserId) {
    throw new Error("Missing required user ids.");
  }

  if (currentUserId === targetUserId) {
    throw new Error("Users cannot block themselves.");
  }

  const batch = writeBatch(db);

  const blockedUserRef = getBlockedUserDocRef(
    currentUserId,
    targetUserId
  );

  const blockedUserData: UserBlockedDoc = {
    userId: currentUserId,
    blockedUserId: targetUserId,
    createdAt: serverTimestamp() as never,
  };

  batch.set(blockedUserRef, blockedUserData);

  batch.delete(
    getFollowingDocRef(currentUserId, targetUserId)
  );

  batch.delete(
    getFollowerDocRef(targetUserId, currentUserId)
  );

  batch.delete(
    getFollowingDocRef(targetUserId, currentUserId)
  );

  batch.delete(
    getFollowerDocRef(currentUserId, targetUserId)
  );

  await batch.commit();
}

export async function unblockUser(
  input: UnblockUserInput
): Promise<void> {
  const { currentUserId, targetUserId } = input;

  if (!currentUserId || !targetUserId) {
    throw new Error("Missing required user ids.");
  }

  await deleteDoc(
    getBlockedUserDocRef(currentUserId, targetUserId)
  );
}