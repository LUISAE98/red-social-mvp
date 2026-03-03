// lib/groups/updateOfferings.ts
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";

export type OfferingType = "saludo" | "consejo" | "mensaje";

export type GroupOffering = {
  type: OfferingType;
  enabled: boolean;
  price?: number | null;
  currency?: "MXN" | "USD" | null;
};

export async function updateOfferings(groupId: string, offerings: GroupOffering[]) {
  const gref = doc(db, "groups", groupId);

  // Normalizamos por si llega enabled undefined
  const cleaned = offerings.map((o) => ({
    type: o.type,
    enabled: !!o.enabled,
    price: o.price ?? null,
    currency: o.currency ?? null,
  }));

  await updateDoc(gref, {
    offerings: cleaned,
    updatedAt: serverTimestamp(),
  });
}