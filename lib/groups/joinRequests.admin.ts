import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

// Nota: estos exports SON runtime (no types), así que Next los detecta sí o sí.
export const approveJoinRequest = async (groupId: string, userId: string) => {
  const fn = httpsCallable(functions, "approveJoinRequest");
  await fn({ groupId, userId });
};

export const rejectJoinRequest = async (groupId: string, userId: string) => {
  const fn = httpsCallable(functions, "rejectJoinRequest");
  await fn({ groupId, userId });
};