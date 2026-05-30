import type { Timestamp } from "firebase/firestore";

export type SocialRelationshipStatus = {
  isFollowing: boolean;
  isFollowedBy: boolean;
  hasBlocked: boolean;
  isBlockedBy: boolean;
  canInteract: boolean;
  canFollow: boolean;
};

export type UserFollowingDoc = {
  userId: string;
  targetUserId: string;
  createdAt: Timestamp;
};

export type UserFollowerDoc = {
  userId: string;
  followerUserId: string;
  createdAt: Timestamp;
};

export type UserBlockedDoc = {
  userId: string;
  blockedUserId: string;
  createdAt: Timestamp;
};

export type FollowUserInput = {
  currentUserId: string;
  targetUserId: string;
};

export type UnfollowUserInput = {
  currentUserId: string;
  targetUserId: string;
};

export type BlockUserInput = {
  currentUserId: string;
  targetUserId: string;
};

export type UnblockUserInput = {
  currentUserId: string;
  targetUserId: string;
};

export type GetSocialRelationshipInput = {
  currentUserId: string | null | undefined;
  targetUserId: string | null | undefined;
};

export type GetProfileFollowersInput = {
  currentUserId: string | null | undefined;
  profileUserId: string | null | undefined;
  limitCount?: number;
};

export type ProfileFollowerListItem = {
  uid: string;
  displayName: string;
  handle: string | null;
  avatarUrl: string | null;
};