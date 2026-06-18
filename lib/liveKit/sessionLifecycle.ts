// Callers frontend para joinSession y endSession.
// joinSession: registra la conexión LiveKit de un participante.
// endSession: finaliza la sesión desde el botón "Finalizar sesión".

import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import type { LivekitSessionType } from "./getLivekitToken";

type SessionLifecyclePayload = {
  sessionId: string;
  sessionType: LivekitSessionType;
};

export async function callJoinSession(payload: SessionLifecyclePayload): Promise<void> {
  const fn = httpsCallable<SessionLifecyclePayload, { success: boolean }>(
    functions,
    "joinSession"
  );
  await fn(payload);
}

export async function callEndSession(payload: SessionLifecyclePayload): Promise<void> {
  const fn = httpsCallable<SessionLifecyclePayload, { success: boolean }>(
    functions,
    "endSession"
  );
  await fn(payload);
}

export async function callGetRecordingDownloadUrl(
  payload: SessionLifecyclePayload
): Promise<string> {
  const fn = httpsCallable<SessionLifecyclePayload, { url: string }>(
    functions,
    "getRecordingDownloadUrl"
  );
  const result = await fn(payload);
  return result.data.url;
}
