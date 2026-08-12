// Cliente de la DEVOLUCIÓN EN EFECTIVO del saldo a favor (B7). Invoca los callables del
// backend (`requestCashout` para el comprador, `resolveCashout` para el superadmin).

import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

export type CashoutOrigin = {
  sourceType: string;
  sourceId: string;
  creatorId: string;
  type: string;
  reason: string;
  amount: number;
  chargedAmount: number;
  stripePaymentIntentId: string;
};

export type CashoutRequestDoc = {
  id: string;
  buyerId: string;
  buyerName: string;
  buyerUsername: string;
  amount: number;
  currency: string;
  status: "pending" | "approved" | "rejected";
  origins: CashoutOrigin[];
  refundedAmount?: number;
  rejectionNote?: string;
  lastError?: string;
  createdAt?: { toDate: () => Date } | null;
  resolvedAt?: { toDate: () => Date } | null;
};

/** El comprador pide su saldo a favor en efectivo. Devuelve el monto reservado. */
export async function requestCashout(): Promise<{ ok: boolean; amount: number }> {
  const fn = httpsCallable<Record<string, never>, { ok: boolean; amount: number }>(
    functions,
    "requestCashout"
  );
  const res = await fn({});
  return res.data;
}

/** 🧪 Solo-moderador (QA): captura un hold por su `pi_...` y emite crédito reembolsable. */
export async function devCaptureAndCredit(
  stripePaymentIntentId: string
): Promise<{ ok: boolean; credited: number; externalReference: string }> {
  const fn = httpsCallable<
    { stripePaymentIntentId: string },
    { ok: boolean; credited: number; externalReference: string }
  >(functions, "devCaptureAndCredit");
  const res = await fn({ stripePaymentIntentId });
  return res.data;
}

/** El superadmin aprueba (dispara reembolsos) o rechaza (revierte) una solicitud. */
export async function resolveCashout(
  cashoutId: string,
  action: "approve" | "reject",
  note?: string
): Promise<{ ok: boolean; refundedAmount?: number }> {
  const fn = httpsCallable<
    { cashoutId: string; action: "approve" | "reject"; note?: string },
    { ok: boolean; refundedAmount?: number }
  >(functions, "resolveCashout");
  const res = await fn({ cashoutId, action, note });
  return res.data;
}
