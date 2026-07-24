// Wrapper cliente del callable `payGreeting` (cobro de saludo/consejo con MP).
// Espejo de `lib/greetings/greetingRequests.ts`.

import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

export type PayGreetingInput = {
  greetingRequestId: string;
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
