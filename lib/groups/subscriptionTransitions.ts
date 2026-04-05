import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

type ApplySubscriptionTransitionInput = {
  groupId: string;
  nextSubscriptionEnabled: boolean;
  freeToSubscriptionPolicy?: "legacy_free" | "require_subscription";
  subscriptionToFreePolicy?: "keep_members_free" | "remove_all_members";
};

type ApplySubscriptionTransitionResponse = {
  ok: boolean;
  alreadyApplied: boolean;
  direction: "free_to_subscription" | "subscription_to_free";
  policy:
    | "legacy_free"
    | "require_subscription"
    | "keep_members_free"
    | "remove_all_members";
  transitionKey: string;
  updatedMembers: number;
  legacyGrantedMembers: number;
  removedMembers: number;
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