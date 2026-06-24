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

// ── Supercomentarios ───────────────────────────────────────────────────────

export type SuperCommentTier = {
  id: string;
  name: string;
  maxChars: number;
  price: number;
  color: string;
  displaySeconds: number;
};

export type SuperCommentConfig = {
  enabled: boolean;
  currency: "MXN";
  tiers: SuperCommentTier[];
};

export type SuperCommentStatus = "paid" | "failed";

export type SuperComment = {
  id: string;
  userId: string;
  username: string;
  avatarUrl: string | null;
  text: string;
  tierId: string;
  tierName: string;
  color: string;
  displaySeconds: number;
  amount: number;
  currency: "MXN";
  status: SuperCommentStatus;
  hidden: boolean;
  isDeleted: boolean;
  played: boolean;
  playedAt?: Timestamp | null;
  scheduledAt?: Timestamp | null;
  createdAt: Timestamp | null;
};

export const DEFAULT_SUPER_COMMENT_TIERS: SuperCommentTier[] = [
  { id: "t1", name: "Chispa",    maxChars: 60,  price: 15,  color: "#a855f7", displaySeconds: 10 },
  { id: "t2", name: "Llama",     maxChars: 120, price: 35,  color: "#ec4899", displaySeconds: 15 },
  { id: "t3", name: "Fuego",     maxChars: 240, price: 75,  color: "#f59e0b", displaySeconds: 20 },
  { id: "t4", name: "Explosión", maxChars: 400, price: 150, color: "#ef4444", displaySeconds: 25 },
  { id: "t5", name: "Volcán",    maxChars: 600, price: 300, color: "#14b8a6", displaySeconds: 30 },
];

export const DEFAULT_SUPER_COMMENT_CONFIG: SuperCommentConfig = {
  enabled: true,
  currency: "MXN",
  tiers: DEFAULT_SUPER_COMMENT_TIERS,
};
