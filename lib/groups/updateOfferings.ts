import { doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { buildNormalizedGroupCommerceState } from "@/lib/groups/groupServiceCatalog";
import type {
  Group,
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

  const groupRef = doc(db, "groups", groupId);
  const groupSnap = await getDoc(groupRef);

  if (!groupSnap.exists()) {
    throw new Error("El grupo no existe.");
  }

  const groupData = groupSnap.data() as Partial<Group>;

  const commerce = buildNormalizedGroupCommerceState({
    offerings: Array.isArray(offerings) ? offerings : [],
    monetization: groupData.monetization,
    donation:
      typeof donation === "undefined" ? groupData.donation : donation,
    legacyGreetingsEnabled:
      typeof groupData.greetingsEnabled === "boolean"
        ? groupData.greetingsEnabled
        : undefined,
    currency: groupData.monetization?.currency ?? null,
  });

  const payload: Record<string, unknown> = {
    offerings: commerce.offerings,
    monetization: commerce.monetization,
    donation: commerce.donation,

    // Legacy temporal controlado
    greetingsEnabled: commerce.monetization.greetingsEnabled,

    updatedAt: serverTimestamp(),
  };

  await updateDoc(groupRef, payload);
}