/**
 * Cancela en Stripe las suscripciones de una comunidad que se borra.
 *
 * ── El problema (B6-H05) ─────────────────────────────────────────────────────
 * `softDeleteGroup` ocultaba la comunidad, revocaba las invitaciones y quitaba
 * las membresías, pero **nadie tocaba Stripe**. Las suscripciones seguían vivas:
 * los compradores seguían pagando cada mes por una comunidad que ya no existe. Y
 * al llegar la renovación, el webhook —que solo comprobaba que el documento del
 * grupo existiera— volvía a crear la membresía.
 *
 * Es el peor tipo de fallo de cobro: silencioso, recurrente y descubierto por el
 * comprador en su estado de cuenta.
 *
 * ⚠️ Se cancela AL INSTANTE, no al final del periodo. La comunidad ya no está;
 * cobrar por el resto del mes de algo que no se puede usar es indefendible.
 */

import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import { stripeFetch } from "./stripeClient";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();

/** Estados en los que la suscripción todavía puede cobrar. */
const VIVAS = new Set(["active", "trialing", "past_due", "unpaid", "incomplete"]);

/**
 * Devuelve cuántas se cancelaron.
 *
 * Nunca lanza: el borrado de la comunidad ya se hizo y no debe deshacerse porque
 * Stripe falle. Lo que no se pueda cancelar queda registrado para revisarlo.
 */
export async function cancelGroupSubscriptions(groupId: string): Promise<number> {
  let canceladas = 0;

  try {
    const snap = await db
      .collection("groupSubscriptions")
      .where("groupId", "==", groupId)
      .get();

    if (snap.empty) return 0;

    await Promise.all(
      snap.docs.map(async (doc) => {
        const subId = String(doc.get("stripeSubscriptionId") ?? "").trim();
        if (!subId) return;

        try {
          const actual = await stripeFetch<{ status?: string }>(`/subscriptions/${subId}`);
          // Si ya no está viva no hay nada que cancelar, pero sí hay que dejar el
          // documento coherente: es lo que mira el resto del sistema.
          if (actual.ok && !VIVAS.has(actual.data.status ?? "")) {
            await marcarCancelada(doc.ref);
            return;
          }

          const res = await stripeFetch(`/subscriptions/${subId}`, { method: "DELETE" });
          if (!res.ok) {
            logger.error("cancelGroupSubscriptions: Stripe rechazó la cancelación", {
              groupId,
              subId,
              status: res.status,
            });
            return;
          }

          await marcarCancelada(doc.ref);
          canceladas++;
        } catch (error) {
          logger.error("cancelGroupSubscriptions: fallo al cancelar", { groupId, subId, error });
        }
      })
    );
  } catch (error) {
    logger.error("cancelGroupSubscriptions: no se pudieron listar", { groupId, error });
  }

  return canceladas;
}

async function marcarCancelada(ref: admin.firestore.DocumentReference): Promise<void> {
  await ref.set(
    {
      active: false,
      status: "cancelled",
      cancelledReason: "group_deleted",
      cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}
