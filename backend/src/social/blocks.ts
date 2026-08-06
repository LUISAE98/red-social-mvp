// Helper compartido de BLOQUEO de perfil (user↔user) para el backend.
// El bloqueo se guarda en users/{uid}/blockedUsers/{blockedUid} (unidireccional en
// almacenamiento), pero el enforcement es BIDIRECCIONAL: si A bloqueó a B o B bloqueó
// a A, se considera que hay bloqueo entre ambos.

import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Transaction } from "firebase-admin/firestore";

if (!getApps().length) {
  initializeApp();
}
const db = getFirestore();

function blockRefs(userA: string, userB: string) {
  return [
    db.collection("users").doc(userA).collection("blockedUsers").doc(userB),
    db.collection("users").doc(userB).collection("blockedUsers").doc(userA),
  ] as const;
}

/** true si A bloqueó a B o B bloqueó a A (bloqueo de perfil, bidireccional). */
export async function usersHaveBlockBetween(
  userA: string,
  userB: string
): Promise<boolean> {
  if (!userA?.trim() || !userB?.trim() || userA === userB) return false;

  const [refAB, refBA] = blockRefs(userA, userB);
  const [aBlockedB, bBlockedA] = await Promise.all([refAB.get(), refBA.get()]);

  return aBlockedB.exists || bBlockedA.exists;
}

/**
 * Igual que usersHaveBlockBetween, pero dentro de una transacción (las lecturas
 * deben ir antes de cualquier escritura de la transacción).
 */
export async function usersHaveBlockBetweenTx(
  tx: Transaction,
  userA: string,
  userB: string
): Promise<boolean> {
  if (!userA?.trim() || !userB?.trim() || userA === userB) return false;

  const [refAB, refBA] = blockRefs(userA, userB);
  const [aBlockedB, bBlockedA] = await Promise.all([tx.get(refAB), tx.get(refBA)]);

  return aBlockedB.exists || bBlockedA.exists;
}
