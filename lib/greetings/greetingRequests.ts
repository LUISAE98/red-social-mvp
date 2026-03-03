// lib/greetings/greetingRequests.ts
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

export type GreetingType = "saludo" | "consejo" | "mensaje";
export type GreetingSource = "group" | "profile";
export type GreetingStatus = "pending" | "accepted" | "rejected";

export async function createGreetingRequest(input: {
  groupId: string;
  type: GreetingType;
  toName: string;
  instructions: string;
  source?: GreetingSource;
}) {
  const fn = httpsCallable(functions, "createGreetingRequest");
  const res = await fn({
    groupId: input.groupId,
    type: input.type,
    toName: input.toName,
    instructions: input.instructions,
    source: input.source ?? "group",
  });
  return res.data as { ok: true; requestId: string; creatorId: string };
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