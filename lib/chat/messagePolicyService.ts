import { doc, serverTimestamp, updateDoc } from "firebase/firestore";

import { db } from "@/lib/firebase";
import { isMessagePolicy, type MessagePolicy } from "./types";

/**
 * Guarda quién puede abrirme un DM.
 *
 * El campo vive en `users/{uid}.messagePolicy`. Las Firestore Rules lo validan
 * de nuevo (whitelist de `changedKeys` + los 3 valores permitidos): esta
 * comprobación es solo para fallar temprano y con un mensaje claro, NUNCA es la
 * barrera real — el gate de verdad está en el `create` de `conversations`.
 */
export async function updateMessagePolicy(
  userId: string,
  policy: MessagePolicy
): Promise<void> {
  const uid = userId?.trim();

  if (!uid) {
    throw new Error("Falta el ID del perfil.");
  }

  if (!isMessagePolicy(policy)) {
    throw new Error("Política de mensajes inválida.");
  }

  await updateDoc(doc(db, "users", uid), {
    messagePolicy: policy,
    updatedAt: serverTimestamp(),
  });
}
