// Wrapper cliente del callable `payGreeting` (cobro de saludo/consejo con MP).
// Espejo de `lib/greetings/greetingRequests.ts`.

import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

export type PayGreetingInput = {
  greetingRequestId: string;
  /** Token de tarjeta generado por el Payment Brick (nunca el número). */
  token: string;
  /** Marca/método (ej. "visa", "master") que devuelve el Brick. */
  paymentMethodId: string;
  /** "credit_card" | "debit_card" (selectedPaymentMethod del Brick). */
  paymentType?: string;
  installments?: number;
  payerEmail?: string;
};

export type PayGreetingResult = {
  status: "approved" | "pending" | "rejected" | "unknown";
  orderId: string | null;
  statusDetail: string | null;
};

export async function payGreeting(
  input: PayGreetingInput
): Promise<PayGreetingResult> {
  const fn = httpsCallable<PayGreetingInput, PayGreetingResult>(
    functions,
    "payGreeting"
  );
  const res = await fn(input);
  return res.data;
}
