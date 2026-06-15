import type { Timestamp } from "firebase/firestore";

export type LiveChatMessageType = "message";

export type LiveChatMessage = {
  id: string;
  liveId: string;
  userId: string;
  username: string;
  avatarUrl?: string | null;
  text: string;
  createdAt?: Timestamp | null;
  type: LiveChatMessageType;
  isDeleted: boolean;
  deletedAt?: Timestamp | null;
  deletedBy?: string | null;
  futureFlags?: {
    isSuperComment?: boolean;
  };
};
