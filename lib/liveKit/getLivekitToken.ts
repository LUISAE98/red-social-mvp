// Caller frontend para la Cloud Function getLivekitToken.
// Solicita al backend un JWT firmado para unirse a la sala LiveKit de una sesión.

import { httpsCallable, type FunctionsError } from "firebase/functions";
import { functions } from "@/lib/firebase";
import type { LiveKitTokenResponse } from "@/lib/liveKit/types";

export type LivekitSessionType = "exclusive_session" | "meet_greet";

type GetLivekitTokenPayload = {
  sessionId: string;
  sessionType: LivekitSessionType;
};

// Códigos de error Firebase Functions que el frontend puede recibir.
export type LivekitErrorCode =
  | "unauthenticated"
  | "permission-denied"
  | "not-found"
  | "failed-precondition"
  | "invalid-argument"
  | "internal"
  | "unknown";

export class LivekitAccessError extends Error {
  constructor(
    public readonly code: LivekitErrorCode,
    message: string
  ) {
    super(message);
    this.name = "LivekitAccessError";
  }
}

function extractErrorCode(error: unknown): LivekitErrorCode {
  const raw = error as { code?: string };
  if (typeof raw?.code !== "string") return "unknown";
  // Firebase wraps codes como "functions/permission-denied"
  const stripped = raw.code.replace(/^functions\//, "");
  const knownCodes: LivekitErrorCode[] = [
    "unauthenticated",
    "permission-denied",
    "not-found",
    "failed-precondition",
    "invalid-argument",
    "internal",
  ];
  return (knownCodes.includes(stripped as LivekitErrorCode)
    ? stripped
    : "unknown") as LivekitErrorCode;
}

function normalizeCallableError(error: unknown): LivekitAccessError {
  const fErr = error as FunctionsError;
  const code = extractErrorCode(error);
  const message =
    fErr?.message?.replace(/^FirebaseError:\s*/i, "") ??
    "Ocurrió un error al obtener el token de videollamada.";
  return new LivekitAccessError(code, message);
}

// Solicita un token LiveKit para que el usuario autenticado se una a la sesión.
// Lanza LivekitAccessError con código y mensaje específico si el acceso es denegado.
export async function getLivekitToken(
  payload: GetLivekitTokenPayload
): Promise<LiveKitTokenResponse> {
  try {
    const callable = httpsCallable<GetLivekitTokenPayload, LiveKitTokenResponse>(
      functions,
      "getLivekitToken"
    );
    const result = await callable(payload);
    return result.data;
  } catch (error) {
    throw normalizeCallableError(error);
  }
}
