// Wrapper cliente del callable `payLiveDonation` (donación en vivo).
// Espejo de `lib/payments/payProfileDonation.ts`, pero ligado a un post/live.

import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

export type PayLiveDonationInput = {
  /** Id del live (= id del post). */
  postId: string;
  amount: number;
  currency?: string;
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

export type PayLiveDonationResult = {
  status: "approved" | "pending" | "rejected" | "unknown";
  orderId: string | null;
  statusDetail: string | null;
};

export async function payLiveDonation(
  input: PayLiveDonationInput
): Promise<PayLiveDonationResult> {
  const fn = httpsCallable<PayLiveDonationInput, PayLiveDonationResult>(
    functions,
    "payLiveDonation"
  );
  const res = await fn(input);
  return res.data;
}
