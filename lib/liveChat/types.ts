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

/**
 * Moneda de un súper comentario. `USD` es la de liquidación desde el corte a Vibra On,
 * LLC (2026-08-18); `MXN` sigue en el tipo porque los registros ANTERIORES la llevan y
 * hay que poder leerlos. Estrecharlo a solo USD rompería la lectura del histórico.
 */
export type SuperCommentCurrency = "USD" | "MXN";

export type SuperCommentConfig = {
  enabled: boolean;
  currency: SuperCommentCurrency;
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
  currency: SuperCommentCurrency;
  status: SuperCommentStatus;
  hidden: boolean;
  isDeleted: boolean;
  played: boolean;
  playedAt?: Timestamp | null;
  scheduledAt?: Timestamp | null;
  createdAt: Timestamp | null;
};

// 💵 Precios en USD desde el corte a Vibra On, LLC. ⚠️ DUPLICADO en el backend
// (payments/stripe/superCommentStripeIntent.ts, DEFAULT_TIERS): el precio del cobro lo
// resuelve SIEMPRE el servidor, así que si los dos se separan el fan ve un precio y se
// le cobra otro.
export const DEFAULT_SUPER_COMMENT_TIERS: SuperCommentTier[] = [
  { id: "t1", name: "Chispa",    maxChars: 60,  price: 1.5,  color: "#a855f7", displaySeconds: 10 },
  { id: "t2", name: "Llama",     maxChars: 140, price: 2.5,  color: "#f72fbe", displaySeconds: 15 },
  { id: "t3", name: "Fuego",     maxChars: 220, price: 5,    color: "#3b82f6", displaySeconds: 20 },
  { id: "t4", name: "Explosión", maxChars: 300, price: 12.5, color: "#facc15", displaySeconds: 25 },
  { id: "t5", name: "Volcán",    maxChars: 380, price: 25,   color: "#4ade80", displaySeconds: 30 },
];

export const DEFAULT_SUPER_COMMENT_CONFIG: SuperCommentConfig = {
  enabled: true,
  currency: "USD",
  tiers: DEFAULT_SUPER_COMMENT_TIERS,
};
