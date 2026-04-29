import {
  doc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

import { db } from "@/lib/firebase";
import type {
  Currency,
  GroupDonationSettings,
  GroupOffering,
} from "@/types/group";

import type {
  ProfileMonetizationSettings,
} from "@/types/profile";

import {
  buildNormalizedProfileCommerceState,
} from "@/lib/profile/profileServiceCatalog";

type PartialOffering = Partial<GroupOffering> | null | undefined;
type PartialDonation = Partial<GroupDonationSettings> | null | undefined;

export type UpdateProfileOfferingsInput = {
  profileUserId: string;

  offerings?: PartialOffering[] | null;
  monetization?: Partial<ProfileMonetizationSettings> | null;
  donation?: PartialDonation;
  currency?: Currency | null;
};

export async function updateProfileOfferings(
  input: UpdateProfileOfferingsInput
): Promise<void> {
  const profileUserId = input.profileUserId?.trim();

  if (!profileUserId) {
    throw new Error("Falta el ID del perfil.");
  }

  const normalized = buildNormalizedProfileCommerceState({
    offerings: input.offerings,
    monetization: input.monetization,
    donation: input.donation,
    currency: input.currency,
  });

  const userRef = doc(db, "users", profileUserId);

  await updateDoc(userRef, {
    offerings: normalized.offerings,
    monetization: normalized.monetization,
    donation: normalized.donation,
    updatedAt: serverTimestamp(),
  });
}