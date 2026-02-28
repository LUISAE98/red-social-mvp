import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";

export interface UpdateGroupInput {
  groupId: string;
  name: string;
  description: string;
  category?: string;
  tags?: string[];
  visibility: "public" | "private" | "hidden";
  greetingsEnabled?: boolean;
  welcomeMessage?: string | null;
  ageMin?: number | null;
  ageMax?: number | null;
  permissions: {
    postingMode: "members" | "owner_only";
    commentsEnabled: boolean;
  };
  monetization: {
    isPaid: boolean;
    priceMonthly: number | null;
    currency: "MXN" | "USD" | null;
  };
}

export async function updateGroup(data: UpdateGroupInput) {
  const groupRef = doc(db, "groups", data.groupId);

  // Regla adicional cliente (doble validación)
  if (data.visibility === "public" && data.monetization.isPaid) {
    throw new Error("Un grupo público no puede ser de pago.");
  }

  if (
    data.ageMin !== null &&
    data.ageMax !== null &&
    data.ageMin > data.ageMax
  ) {
    throw new Error("Edad mínima no puede ser mayor que la máxima.");
  }

  await updateDoc(groupRef, {
    ...data,
    updatedAt: serverTimestamp(),
  });
}