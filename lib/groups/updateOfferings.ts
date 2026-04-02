import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type {
  GroupDonationSettings,
  GroupOffering,
} from "@/types/group";

export async function updateOfferings(
  groupId: string,
  offerings: GroupOffering[],
  donation?: Partial<GroupDonationSettings> | null
) {
  if (!groupId?.trim()) {
    throw new Error("groupId requerido.");
  }

  const safeOfferings = Array.isArray(offerings) ? offerings : [];

  const payload: Record<string, unknown> = {
    offerings: safeOfferings,
    updatedAt: serverTimestamp(),
  };

  if (typeof donation !== "undefined") {
    payload.donation = donation ?? null;
  }

  const saludo = safeOfferings.find((item) => item?.type === "saludo");
  payload.greetingsEnabled = saludo?.enabled === true;

  await updateDoc(doc(db, "groups", groupId), payload);
}