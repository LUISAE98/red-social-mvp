// lib/greetings/greetingRequests.ts
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

export type GreetingType = "saludo" | "consejo" | "mensaje";
export type GreetingSource = "group" | "profile";
export type GreetingStatus = "pending" | "accepted" | "rejected";

type CreateGreetingRequestParams = {
  groupId: string | null;
  profileUserId: string | null;
  creatorId: string | null;
  type: GreetingType;
  toName: string;
  instructions: string;
  source: GreetingSource;
  requestSource: GreetingSource;
  allowCreatorStory: boolean;
};

type CreateGreetingRequestResult = {
  ok: true;
  requestId: string;
  creatorId: string;
  /** Precio autoritativo del servidor (para cobrar exactamente esto en el Brick). */
  priceSnapshot?: number | null;
  source: GreetingSource;
  requestSource?: GreetingSource;
  groupId?: string | null;
  profileUserId?: string | null;
};

type RespondGreetingRequestParams = {
  requestId: string;
  action: "accept" | "reject";
};

type RespondGreetingRequestResult = {
  ok: true;
};

function normalizeOptionalId(value: string | null | undefined): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

function normalizeRequiredText(value: string, label: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";

  if (!normalized) {
    throw new Error(`${label} es requerido.`);
  }

  return normalized;
}

export async function createGreetingRequest(input: {
  groupId?: string | null;
  profileUserId?: string | null;
  creatorId?: string | null;
  type: GreetingType;
  toName: string;
  instructions: string;
  source?: GreetingSource;
  requestSource?: GreetingSource;
  allowCreatorStory?: boolean;
}) {
  const groupId = normalizeOptionalId(input.groupId);
  const profileUserId = normalizeOptionalId(input.profileUserId);
  const creatorId = normalizeOptionalId(input.creatorId);
  const source: GreetingSource =
    input.source ?? (profileUserId ? "profile" : "group");
  const requestSource: GreetingSource = input.requestSource ?? source;

  if (source === "group" && !groupId) {
    throw new Error("Falta el ID del grupo para crear la solicitud.");
  }

  if (source === "profile" && !profileUserId && !creatorId) {
    throw new Error("Falta el ID del perfil para crear la solicitud.");
  }

  const payload: CreateGreetingRequestParams = {
    groupId,
    profileUserId: profileUserId ?? creatorId,
    creatorId: creatorId ?? profileUserId,
    type: input.type,
    toName: normalizeRequiredText(input.toName, "El nombre del destinatario"),
    instructions: normalizeRequiredText(input.instructions, "Las instrucciones del saludo"),
    source,
    requestSource,
    allowCreatorStory: input.allowCreatorStory ?? false,
  };

  const fn = httpsCallable<
    CreateGreetingRequestParams,
    CreateGreetingRequestResult
  >(functions, "createGreetingRequest");

  const res = await fn(payload);

  return res.data;
}

export async function createGreetingMuxUpload(input: {
  greetingRequestId: string;
}): Promise<{ uploadId: string; uploadUrl: string }> {
  const greetingRequestId = normalizeRequiredText(
    input.greetingRequestId,
    "greetingRequestId"
  );

  const fn = httpsCallable<
    { greetingRequestId: string },
    { uploadId: string; uploadUrl: string }
  >(functions, "createGreetingMuxUpload");

  const res = await fn({ greetingRequestId });
  return res.data;
}

export async function respondGreetingRequest(input: {
  requestId: string;
  action: "accept" | "reject";
}) {
  const requestId = normalizeRequiredText(input.requestId, "requestId");

  const fn = httpsCallable<
    RespondGreetingRequestParams,
    RespondGreetingRequestResult
  >(functions, "respondGreetingRequest");

  const res = await fn({
    requestId,
    action: input.action,
  });

  return res.data;
}