// Wrapper cliente del callable `payPremiumPost` (desbloqueo de post premium / VOD).
// Espejo de `lib/payments/payGreeting.ts`.

import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

export type PayPremiumPostInput = {
  postId: string;
  /** Token de tarjeta (nunca el número). */
  token: string;
  /** Marca/método (ej. "visa", "master"). */
  paymentMethodId?: string;
  paymentType?: string;
  installments?: number;
  payerEmail?: string;
  /** Segundo token para guardar la tarjeta nueva. */
  saveToken?: string;
  /** Id de la tarjeta guardada, si se paga con una. */
  savedCardId?: string;
};

export type PayPremiumPostResult = {
  status: "approved" | "pending" | "rejected" | "unknown";
  orderId: string | null;
  statusDetail: string | null;
};

export async function payPremiumPost(
  input: PayPremiumPostInput
): Promise<PayPremiumPostResult> {
  const fn = httpsCallable<PayPremiumPostInput, PayPremiumPostResult>(
    functions,
    "payPremiumPost"
  );
  const res = await fn(input);
  return res.data;
}
