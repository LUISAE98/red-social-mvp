// lib/greetings/greetingRequests.ts
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

export type GreetingType = "saludo" | "consejo" | "mensaje";
export type GreetingSource = "group" | "profile";
export type GreetingStatus = "pending" | "accepted" | "rejected";

export async function createGreetingRequest(input: {
  groupId?: string | null;
  profileUserId?: string | null;
  creatorId?: string | null;
  type: GreetingType;
  toName: string;
  instructions: string;
  source?: GreetingSource;
  requestSource?: GreetingSource;
}) {
  const source: GreetingSource = input.source ?? (input.profileUserId ? "profile" : "group");

  if (source === "group" && !input.groupId) {
    throw new Error("Falta el ID del grupo para crear la solicitud.");
  }

  if (source === "profile" && !input.profileUserId && !input.creatorId) {
    throw new Error("Falta el ID del perfil para crear la solicitud.");
  }

  const fn = httpsCallable(functions, "createGreetingRequest");

const res = await fn({
  groupId: input.groupId ?? null,
  profileUserId: input.profileUserId ?? input.creatorId ?? null,
  creatorId: input.creatorId ?? input.profileUserId ?? null,
  type: input.type,
  toName: input.toName,
  instructions: input.instructions,
  source,
  requestSource: input.requestSource ?? source,
});

  return res.data as {
    ok: true;
    requestId: string;
    creatorId: string;
    source: GreetingSource;
    requestSource?: GreetingSource;
    groupId?: string | null;
    profileUserId?: string | null;
  };
}

export async function respondGreetingRequest(input: {
  requestId: string;
  action: "accept" | "reject";
}) {
  const fn = httpsCallable(functions, "respondGreetingRequest");

  const res = await fn({
    requestId: input.requestId,
    action: input.action,
  });

  return res.data as { ok: true };
}