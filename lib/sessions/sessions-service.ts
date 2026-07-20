import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type Timestamp,
  type Unsubscribe,
} from "firebase/firestore";

import { db } from "@/lib/firebase";
import {
  buildApproxLocationLabel,
  buildDeviceLabel,
  getBrowserTimezone,
} from "@/lib/sessions/deviceLabel";
import { SESSION_ID_STORAGE_KEY, type UserSession } from "@/types/session";

function sessionsCollection(uid: string) {
  return collection(db, "users", uid, "sessions");
}

function sessionDoc(uid: string, sessionId: string) {
  return doc(db, "users", uid, "sessions", sessionId);
}

function generateSessionId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // continúa al fallback
  }

  // Fallback razonablemente único para entornos sin crypto.randomUUID.
  return `sess_${Math.random().toString(36).slice(2)}${Math.random()
    .toString(36)
    .slice(2)}`;
}

/**
 * Devuelve el id de sesión de este dispositivo, generándolo y persistiéndolo en
 * localStorage la primera vez. Devuelve null en SSR / sin localStorage.
 */
export function getOrCreateSessionId(): string | null {
  if (typeof window === "undefined") return null;

  try {
    const existing = window.localStorage.getItem(SESSION_ID_STORAGE_KEY);
    if (existing && existing.trim()) return existing.trim();

    const next = generateSessionId();
    window.localStorage.setItem(SESSION_ID_STORAGE_KEY, next);
    return next;
  } catch {
    // Sin acceso a localStorage: usamos un id efímero (no persistente).
    return generateSessionId();
  }
}

/** Olvida el id de sesión local; el próximo login genera uno nuevo. */
export function clearStoredSessionId(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(SESSION_ID_STORAGE_KEY);
  } catch {
    // ignorar
  }
}

function collectDeviceMetadata() {
  const userAgent =
    typeof navigator !== "undefined" ? navigator.userAgent : null;
  const timezone = getBrowserTimezone();

  return {
    userAgent,
    deviceLabel: buildDeviceLabel(userAgent),
    timezone,
    locationLabel: buildApproxLocationLabel(timezone),
  };
}

/**
 * Registra (o refresca) el documento de esta sesión. Se llama al iniciar sesión
 * / montar la app. Fija `createdAt` solo si el doc no existía y siempre limpia
 * `revoked` a false (un login/registro fresco en este dispositivo es una sesión
 * válida). El heartbeat posterior NUNCA toca `revoked`.
 */
export async function registerSession(
  uid: string,
  sessionId: string
): Promise<void> {
  const ref = sessionDoc(uid, sessionId);
  const metadata = collectDeviceMetadata();

  const snap = await getDoc(ref);

  if (!snap.exists()) {
    await setDoc(ref, {
      ...metadata,
      createdAt: serverTimestamp(),
      lastSeenAt: serverTimestamp(),
      revoked: false,
      revokedAt: null,
    });
    return;
  }

  await updateDoc(ref, {
    ...metadata,
    lastSeenAt: serverTimestamp(),
    revoked: false,
    revokedAt: null,
  });
}

/** Actualiza únicamente el heartbeat (lastSeenAt) de esta sesión. */
export async function touchSession(
  uid: string,
  sessionId: string
): Promise<void> {
  try {
    await updateDoc(sessionDoc(uid, sessionId), {
      lastSeenAt: serverTimestamp(),
    });
  } catch {
    // El doc puede no existir todavía; el registro se encarga de crearlo.
  }
}

/**
 * Escucha SOLO el documento de la sesión actual y avisa cuando queda marcado
 * como `revoked`. El hook lo usa para cerrar sesión automáticamente.
 */
export function subscribeOwnSessionRevoked(
  uid: string,
  sessionId: string,
  onRevoked: () => void
): Unsubscribe {
  return onSnapshot(
    sessionDoc(uid, sessionId),
    (snap) => {
      const data = snap.data();
      if (data && data.revoked === true) {
        onRevoked();
      }
    },
    () => {
      // Silencioso: un error de permisos/red no debe tirar la app.
    }
  );
}

function toTimestamp(value: unknown): Timestamp | null {
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    return value as Timestamp;
  }
  return null;
}

function mapSession(id: string, data: Record<string, unknown>): UserSession {
  return {
    id,
    createdAt: toTimestamp(data.createdAt),
    lastSeenAt: toTimestamp(data.lastSeenAt),
    userAgent: typeof data.userAgent === "string" ? data.userAgent : null,
    deviceLabel:
      typeof data.deviceLabel === "string" && data.deviceLabel.trim()
        ? data.deviceLabel
        : "Dispositivo desconocido",
    timezone: typeof data.timezone === "string" ? data.timezone : null,
    locationLabel:
      typeof data.locationLabel === "string" ? data.locationLabel : null,
    revoked: data.revoked === true,
    revokedAt: toTimestamp(data.revokedAt),
  };
}

/**
 * Suscribe a todas las sesiones del usuario, ordenadas por actividad reciente.
 * Excluye las ya revocadas (ya no cuentan como "abiertas").
 */
export function subscribeUserSessions(
  uid: string,
  onChange: (sessions: UserSession[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const cleanUid = uid.trim();

  if (!cleanUid) {
    onChange([]);
    return () => undefined;
  }

  return onSnapshot(
    sessionsCollection(cleanUid),
    (snapshot) => {
      const sessions = snapshot.docs
        .map((docSnap) =>
          mapSession(docSnap.id, docSnap.data() as Record<string, unknown>)
        )
        .filter((session) => !session.revoked);

      sessions.sort((a, b) => {
        const aTime = a.lastSeenAt?.toMillis?.() ?? 0;
        const bTime = b.lastSeenAt?.toMillis?.() ?? 0;
        return bTime - aTime;
      });

      onChange(sessions);
    },
    (error) => {
      onError?.(error);
      onChange([]);
    }
  );
}

/** Marca una sesión como revocada (el dispositivo dueño cerrará sesión solo). */
export async function revokeSession(
  uid: string,
  sessionId: string
): Promise<void> {
  await updateDoc(sessionDoc(uid, sessionId), {
    revoked: true,
    revokedAt: serverTimestamp(),
  });
}

/**
 * Marca como revocadas todas las sesiones excepto la actual. La sesión de este
 * dispositivo permanece activa.
 */
export async function revokeOtherSessions(
  uid: string,
  currentSessionId: string
): Promise<void> {
  const snapshot = await getDocs(sessionsCollection(uid));
  const batch = writeBatch(db);
  let count = 0;

  snapshot.docs.forEach((docSnap) => {
    if (docSnap.id === currentSessionId) return;
    const data = docSnap.data() as Record<string, unknown>;
    if (data.revoked === true) return;

    batch.update(docSnap.ref, {
      revoked: true,
      revokedAt: serverTimestamp(),
    });
    count += 1;
  });

  if (count > 0) {
    await batch.commit();
  }
}
