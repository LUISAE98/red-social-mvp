// Wrapper cliente del callable `paySuperComment` (supercomentario en vivo).
// Espejo de `lib/payments/payLiveDonation.ts`, pero con monto fijo (precio del
// tier) y texto: el precio lo resuelve el backend contra la config del live.

import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

export type PaySuperCommentInput = {
  /** Id del live (= id del post). */
  postId: string;
  /** Nivel elegido (define el precio server-side). */
  tierId: string;
  /** Mensaje del supercomentario (obligatorio). */
  text: string;
  /** Token de tarjeta (nunca el número). */
  token: string;
  /** Marca/método (ej. "visa", "master"). Solo tarjeta nueva. */
  paymentMethodId?: string;
  paymentType?: string;
  installments?: number;
  payerEmail?: string;
  /** Segundo token para guardar la tarjeta nueva. */
  saveToken?: string;
  /** Id de la tarjeta guardada, si se paga con una. */
  savedCardId?: string;
};

export type PaySuperCommentResult = {
  status: "approved" | "pending" | "rejected" | "unknown";
  orderId: string | null;
  statusDetail: string | null;
};

export async function paySuperComment(
  input: PaySuperCommentInput
): Promise<PaySuperCommentResult> {
  const fn = httpsCallable<PaySuperCommentInput, PaySuperCommentResult>(
    functions,
    "paySuperComment"
  );
  const res = await fn(input);
  return res.data;
}
