"use client";

import { useEffect } from "react";
import type { User } from "firebase/auth";
import { signOut } from "firebase/auth";

import { auth } from "@/lib/firebase";
import {
  clearStoredSessionId,
  getOrCreateSessionId,
  registerSession,
  subscribeOwnSessionRevoked,
  touchSession,
} from "@/lib/sessions/sessions-service";

// Cada cuánto refrescamos el heartbeat (lastSeenAt) de la sesión.
const HEARTBEAT_MS = 5 * 60 * 1000;

/**
 * Registra la sesión de este dispositivo mientras haya un usuario autenticado,
 * mantiene su heartbeat y cierra sesión automáticamente si otro dispositivo la
 * marca como revocada. Se monta una sola vez dentro del AuthProvider.
 */
export function useSessionRegistry(user: User | null) {
  const uid = user?.uid ?? null;

  useEffect(() => {
    if (!uid) return;

    const sessionId = getOrCreateSessionId();
    if (!sessionId) return;

    let cancelled = false;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let unsubscribeRevoked: (() => void) | null = null;

    async function handleRevoked() {
      // Olvidamos el id local para que un futuro login en este dispositivo
      // genere una sesión nueva y no reutilice un doc revocado.
      clearStoredSessionId();

      try {
        await signOut(auth);
      } catch {
        // ignorar: la redirección de todas formas saca al usuario.
      }

      window.location.replace("/login");
    }

    (async () => {
      try {
        // Regla del proyecto: esperar a que Auth esté listo antes de escribir a
        // Firestore, o request.auth llega null en el servidor.
        await auth.authStateReady();
        if (cancelled) return;

        await registerSession(uid, sessionId);
      } catch {
        // Si el registro falla (permisos/red), no bloqueamos la app.
      }

      if (cancelled) return;

      unsubscribeRevoked = subscribeOwnSessionRevoked(uid, sessionId, () => {
        void handleRevoked();
      });
    })();

    function beat() {
      void touchSession(uid as string, sessionId as string);
    }

    heartbeat = setInterval(beat, HEARTBEAT_MS);

    function onVisibility() {
      if (document.visibilityState === "visible") beat();
    }

    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      if (heartbeat) clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", onVisibility);
      if (unsubscribeRevoked) unsubscribeRevoked();
    };
  }, [uid]);
}
