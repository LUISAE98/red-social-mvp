import type { Timestamp } from "firebase/firestore";
import type { PostContextType, PostPremiumCurrency } from "./types";

export type PostAccessStatus =
  | "pending_payment"
  | "active"
  | "revoked"
  | "refunded"
  | "failed";

export type PostAccessSource = "mercado_pago" | null;

export type PostAccessPurchaseType = "one_time";

export type PostAccess = {
  id: string;

  postId: string;
  buyerId: string;
  creatorId: string;

  groupId?: string | null;
  profileId?: string | null;
  contextType: PostContextType;

  status: PostAccessStatus;
  source?: PostAccessSource;

  paymentId?: string | null;
  orderId?: string | null;

  purchaseType: PostAccessPurchaseType;
  price: number;
  currency: PostPremiumCurrency;

  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
  paidAt?: Timestamp | null;
  revokedAt?: Timestamp | null;

  /**
   * Compra única: no expira.
   */
  expiresAt?: null;
};