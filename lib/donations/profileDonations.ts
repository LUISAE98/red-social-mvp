"use client";

import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { SETTLEMENT_CURRENCY } from "@/lib/currency/catalog";
import { db } from "@/lib/firebase";

/**
 * Registra una donación a un perfil (pago simulado). El trigger de wallet
 * `onProfileDonationLedger` la convierte en ganancia del creador.
 */
export async function createProfileDonation(params: {
  creatorId: string;
  buyerId: string;
  amount: number;
  currency?: string | null;
}): Promise<string> {
  const ref = await addDoc(collection(db, "profileDonations"), {
    creatorId: params.creatorId,
    buyerId: params.buyerId,
    amount: params.amount,
    currency: params.currency ?? SETTLEMENT_CURRENCY,
    source: "profile",
    paymentStatus: "simulated_paid",
    paymentMode: "simulated_no_real_payment",
    createdAt: serverTimestamp(),
  });
  return ref.id;
}
