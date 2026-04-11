import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

type ApplySubscriptionTransitionInput = {
  groupId: string;
  nextSubscriptionEnabled: boolean;
  freeToSubscriptionPolicy?: "legacy_free" | "require_subscription";
  subscriptionToFreePolicy?: "keep_members_free" | "remove_all_members";
  subscriptionPriceIncreasePolicy?:
    | "keep_legacy_price"
    | "require_resubscribe_new_price";
  previousSubscriptionPriceMonthly?: number;
  nextSubscriptionPriceMonthly?: number;
  subscriptionPriceChangeCurrency?: "MXN" | "USD";
};

type ApplySubscriptionTransitionResponse = {
  ok: boolean;
  alreadyApplied: boolean;
  direction:
    | "free_to_subscription"
    | "subscription_to_free"
    | "subscription_price_increase";
  policy:
    | "legacy_free"
    | "require_subscription"
    | "keep_members_free"
    | "remove_all_members"
    | "keep_legacy_price"
    | "require_resubscribe_new_price";
  transitionKey: string;
  updatedMembers: number;
  legacyGrantedMembers: number;
  removedMembers: number;
  skippedMembers: number;
  reminderMembers?: number;
  legacyPricedMembers?: number;
};

type RemoveLegacyFreeMembersAfterSubscriptionTransitionInput = {
  groupId: string;
};

type RemoveLegacyFreeMembersAfterSubscriptionTransitionResponse = {
  ok: boolean;
  groupId: string;
  transitionKey?: string;
  updatedMembers: number;
  removedMembers: number;
  reminderMembers: number;
  skippedMembers: number;
};

export async function applyGroupSubscriptionTransition(
  input: ApplySubscriptionTransitionInput
): Promise<ApplySubscriptionTransitionResponse> {
  const callable = httpsCallable<
    ApplySubscriptionTransitionInput,
    ApplySubscriptionTransitionResponse
  >(functions, "applyGroupSubscriptionTransition");

  const response = await callable(input);

  if (!response?.data) {
    throw new Error("No se recibió respuesta del servidor.");
  }

  return response.data;
}

export async function removeLegacyFreeMembersAfterSubscriptionTransition(
  input: RemoveLegacyFreeMembersAfterSubscriptionTransitionInput
): Promise<RemoveLegacyFreeMembersAfterSubscriptionTransitionResponse> {
  const callable = httpsCallable<
    RemoveLegacyFreeMembersAfterSubscriptionTransitionInput,
    RemoveLegacyFreeMembersAfterSubscriptionTransitionResponse
  >(functions, "removeLegacyFreeMembersAfterSubscriptionTransition");

  const response = await callable(input);

  if (!response?.data) {
    throw new Error("No se recibió respuesta del servidor.");
  }

  return response.data;
}