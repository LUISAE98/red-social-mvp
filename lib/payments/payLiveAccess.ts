// Wrapper cliente del callable `payLiveAccess` (ticket de acceso a un en vivo).
// Espejo de `lib/payments/payPremiumPost.ts`.

import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

export type PayLiveAccessInput = {
  postId: string; // el en vivo es un post
  /** Token de tarjeta (nunca el número). */
  token: string;
  paymentMethodId?: string;
  paymentType?: string;
  installments?: number;
  payerEmail?: string;
  saveToken?: string;
  savedCardId?: string;
};

export type PayLiveAccessResult = {
  status: "approved" | "pending" | "rejected" | "unknown";
  orderId: string | null;
  statusDetail: string | null;
};

export async function payLiveAccess(
  input: PayLiveAccessInput
): Promise<PayLiveAccessResult> {
  const fn = httpsCallable<PayLiveAccessInput, PayLiveAccessResult>(
    functions,
    "payLiveAccess"
  );
  const res = await fn(input);
  return res.data;
}
