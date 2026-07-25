// Wrapper cliente del callable `payProfileDonation` (donación/contribución a perfil).
// Espejo de `lib/payments/payGreeting.ts`.

import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

export type PayProfileDonationInput = {
  creatorId: string;
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

export type PayProfileDonationResult = {
  status: "approved" | "pending" | "rejected" | "unknown";
  orderId: string | null;
  statusDetail: string | null;
};

export async function payProfileDonation(
  input: PayProfileDonationInput
): Promise<PayProfileDonationResult> {
  const fn = httpsCallable<PayProfileDonationInput, PayProfileDonationResult>(
    functions,
    "payProfileDonation"
  );
  const res = await fn(input);
  return res.data;
}
