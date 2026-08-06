// Wrappers cliente de las invitaciones a moderar una comunidad.
// La lógica real (permisos, alta como miembro, ascenso y notificaciones) vive en
// `backend/src/moderatorInvites.ts`.

import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

function requireId(value: string, label: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(`${label} es requerido.`);
  return normalized;
}

/** El dueño invita a alguien a moderar (sea o no integrante de la comunidad). */
export async function inviteGroupModerator(
  groupId: string,
  userId: string
): Promise<void> {
  const fn = httpsCallable<{ groupId: string; userId: string }, { success: boolean }>(
    functions,
    "inviteGroupModerator"
  );

  await fn({
    groupId: requireId(groupId, "groupId"),
    userId: requireId(userId, "userId"),
  });
}

/**
 * El invitado responde. Aceptar lo mete a la comunidad (si no estaba) y lo deja
 * como moderador en la misma operación.
 */
export async function respondGroupModeratorInvite(
  groupId: string,
  accept: boolean
): Promise<void> {
  const fn = httpsCallable<
    { groupId: string; accept: boolean },
    { success: boolean; accepted: boolean }
  >(functions, "respondGroupModeratorInvite");

  await fn({ groupId: requireId(groupId, "groupId"), accept });
}
