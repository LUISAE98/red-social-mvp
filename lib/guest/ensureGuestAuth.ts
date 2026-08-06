"use client";

import { signInAnonymously, type User } from "firebase/auth";
import { auth } from "@/lib/firebase";

/**
 * Garantiza una identidad para COMPRAR SIN LOGIN. Si ya hay sesión (real o anónima),
 * la devuelve; si no, firma anónimamente. El uid anónimo persiste por navegador
 * (IndexedDB) y sirve de `buyerId` server-authoritative en las compras de invitado
 * (donación, súper comentario, donación en vivo, tickets, premium).
 *
 * IMPORTANTE: el acceso a contenido de pago (ticket live/VOD, post premium) se verifica
 * SIEMPRE server-side contra este uid, nunca por una bandera device-wide en localStorage.
 * Así, si luego alguien se loguea con su cuenta real en el mismo navegador, NO hereda las
 * compras del invitado (uid distinto) — cierra el bug de desbloqueo entre sesiones.
 */
export async function ensureGuestAuth(): Promise<User> {
  if (auth.currentUser) return auth.currentUser;
  // authStateReady() evita la carrera donde currentUser aún no resolvió al montar
  // (ver feedback: authStateReady antes de cualquier write a Firestore).
  await auth.authStateReady().catch(() => undefined);
  if (auth.currentUser) return auth.currentUser;
  const cred = await signInAnonymously(auth);
  return cred.user;
}

/** ¿La sesión actual es un invitado (anónima) y no una cuenta real? */
export function isGuestUser(user: { isAnonymous?: boolean } | null | undefined): boolean {
  return !!user?.isAnonymous;
}
