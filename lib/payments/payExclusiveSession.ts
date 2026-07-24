// Wrapper cliente del callable `payExclusiveSession` (cobro de sesión exclusiva).

import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

export type PayExclusiveSessionInput = {
  requestId: string;
  token: string;
  paymentMethodId: string;
  paymentType?: string;
  installments?: number;
  payerEmail?: string;
};

export type PayExclusiveSessionResult = {
  status: "approved" | "pending" | "rejected" | "unknown";
  orderId: string | null;
  statusDetail: string | null;
};

export async function payExclusiveSession(
  input: PayExclusiveSessionInput
): Promise<PayExclusiveSessionResult> {
  const fn = httpsCallable<PayExclusiveSessionInput, PayExclusiveSessionResult>(
    functions,
    "payExclusiveSession"
  );
  const res = await fn(input);
  return res.data;
}
