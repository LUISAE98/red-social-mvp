import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

type UpdateProfileDisplayNameResponse = {
  ok: boolean;
  displayName: string;
  displayNameLastChangedAt: string;
};

export async function updateProfileDisplayName(nextDisplayName: string) {
  const trimmedName = nextDisplayName.trim();

  if (trimmedName.length < 3) {
    throw new Error("El nombre debe tener al menos 3 caracteres.");
  }

  const callable = httpsCallable<
    { displayName: string },
    UpdateProfileDisplayNameResponse
  >(functions, "updateProfileDisplayName");

  const result = await callable({
    displayName: trimmedName,
  });

  return result.data;
}