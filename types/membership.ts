import { Timestamp } from "firebase/firestore";

export type GroupRole = "owner" | "moderator" | "member";
export type MemberStatus = "active" | "muted" | "banned";

export type GroupMember = {
  userId: string;
  roleInGroup: GroupRole;
  status: MemberStatus;
  joinedAt: Timestamp;
  updatedAt: Timestamp;
};