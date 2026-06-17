// Hook para obtener el token LiveKit de una sesión y gestionar el estado de la solicitud.
// Centraliza el fetch para que LiveKitVideoRoom y la ruta /sessions/[id]/call lo reutilicen.

import { useState, useEffect } from "react";
import {
  getLivekitToken,
  LivekitAccessError,
  type LivekitSessionType,
  type LivekitErrorCode,
} from "./getLivekitToken";
import type { LiveKitTokenResponse } from "./types";

type RoomTokenState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: LiveKitTokenResponse }
  | { status: "error"; message: string; errorCode: LivekitErrorCode };

export function useLivekitRoom(params: {
  sessionId: string | null;
  sessionType: LivekitSessionType | null;
  enabled?: boolean;
}): RoomTokenState {
  const { sessionId, sessionType, enabled = true } = params;
  const [state, setState] = useState<RoomTokenState>({ status: "idle" });

  useEffect(() => {
    if (!enabled || !sessionId || !sessionType) return;

    let cancelled = false;

    // Wrapping en async para que todo setState ocurra en callbacks asincrónicos.
    async function fetchToken() {
      // Primer microtask: marcar loading (después del primer await).
      await Promise.resolve();
      if (cancelled) return;

      setState({ status: "loading" });

      try {
        const data = await getLivekitToken({ sessionId: sessionId!, sessionType: sessionType! });
        if (!cancelled) setState({ status: "ready", data });
      } catch (err: unknown) {
        if (!cancelled) {
          const isAccessError = err instanceof LivekitAccessError;
          const errorCode: LivekitErrorCode = isAccessError ? err.code : "unknown";
          const msg = err instanceof Error
            ? err.message
            : "Error al obtener acceso a la videollamada.";
          setState({ status: "error", message: msg, errorCode });
        }
      }
    }

    fetchToken();

    return () => {
      cancelled = true;
    };
  }, [sessionId, sessionType, enabled]);

  return state;
}
