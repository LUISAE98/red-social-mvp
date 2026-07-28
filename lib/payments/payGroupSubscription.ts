// Wrappers cliente de la suscripción a comunidades (Mercado Pago preapproval).
// El cobro y la activación de la membresía son server-authoritative: el cliente
// solo entrega el token de tarjeta (de la pasarela) y el backend crea el
// preapproval mensual. Ver `backend/src/payments/groupSubscription.ts`.

import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

export type PayGroupSubscriptionInput = {
  groupId: string;
  /** Token de tarjeta (nunca el número). Sirve para tarjeta nueva o guardada. */
  token: string;
  payerEmail?: string;
  /** Token de invitación — obligatorio para comunidades ocultas (invite-only). */
  inviteToken?: string;
  /** 🧾 IVA — país fiscal del comprador (por IP); el backend suma el IVA al cobro mensual. */
  taxCountry?: string | null;
};

export type PayGroupSubscriptionResult = {
  status: "authorized" | "pending" | "rejected";
  subscriptionId: string;
};

export async function payGroupSubscription(
  input: PayGroupSubscriptionInput
): Promise<PayGroupSubscriptionResult> {
  const fn = httpsCallable<PayGroupSubscriptionInput, PayGroupSubscriptionResult>(
    functions,
    "payGroupSubscription"
  );
  const res = await fn(input);
  return res.data;
}

export type CancelGroupSubscriptionResult = {
  status: string;
  /** Fecha hasta la que conservas acceso (fin del periodo pagado). */
  accessUntil: unknown;
};

export async function cancelGroupSubscription(
  groupId: string
): Promise<CancelGroupSubscriptionResult> {
  const fn = httpsCallable<{ groupId: string }, CancelGroupSubscriptionResult>(
    functions,
    "cancelGroupSubscription"
  );
  const res = await fn({ groupId });
  return res.data;
}
