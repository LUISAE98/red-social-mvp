// Limpiador de RESERVAS de saldo a favor abandonadas.
//
// Cuando el comprador elige pagar con crédito y TARJETA NUEVA, el crédito se RESERVA al
// crear el intent, pero el cargo a la tarjeta se confirma después (cliente). Si abandona
// (nunca confirma), la reserva quedaría colgada. Este cron la revierte: busca los
// `paymentIntents` que siguen `awaiting_payment` con `creditApplied > 0` y ya viejos, y
// devuelve el crédito. Los pagos EXITOSOS pasan a `paid`/`authorized` (no los toca); los
// pagados 100% con crédito pasan a `paid` de inmediato (tampoco los toca).

import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { revertBuyerCreditSpend } from "../../wallet/buyerCredit";
import { stripeFetch } from "./stripeClient";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

// Un checkout de tarjeta nueva se confirma en la misma sesión (minutos). Pasadas estas
// horas sin confirmarse, se considera abandonado y se libera la reserva. Margen amplio
// para NO revertir un pago que aún esté en vuelo.
const ABANDON_HOURS = 6;

/** Estados en los que Stripe todavía deja cancelar un cobro sin confirmar. */
const CANCELABLES = new Set([
  "requires_payment_method",
  "requires_confirmation",
  "requires_action",
  "requires_capture",
]);

/**
 * Deja el cobro imposible de confirmar. Devuelve `true` si quedó muerto.
 *
 * Un cobro ya cancelado cuenta como éxito (el cron reintenta). Uno ya
 * confirmado NO: ahí la compra es buena y el saldo debe seguir gastado.
 */
async function cancelIntentIfCancelable(paymentIntentId: string): Promise<boolean> {
  const actual = await stripeFetch<{ status?: string }>(`/payment_intents/${paymentIntentId}`);
  if (!actual.ok) return false;

  const estado = actual.data.status ?? "";
  if (estado === "canceled") return true;
  if (!CANCELABLES.has(estado)) return false;

  const res = await stripeFetch(`/payment_intents/${paymentIntentId}/cancel`, {
    method: "POST",
    idempotencyKey: `cleanup_cancel_${paymentIntentId}`,
  });
  return res.ok;
}

export async function cleanupAbandonedCreditReservationsHandler(): Promise<number> {
  const cutoffMs = Date.now() - ABANDON_HOURS * 60 * 60 * 1000;
  const snap = await db
    .collection("paymentIntents")
    .where("status", "==", "awaiting_payment")
    .where("creditApplied", ">", 0)
    .limit(300)
    .get();
  if (snap.empty) return 0;

  let reverted = 0;
  await Promise.all(
    snap.docs.map(async (d) => {
      const data = d.data();
      if (data.creditReverted === true) return; // ya liberada
      const createdMs =
        typeof data.createdAt?.toMillis === "function" ? data.createdAt.toMillis() : 0;
      if (createdMs > cutoffMs) return; // aún dentro de la ventana → puede estar en vuelo

      const uid = typeof data.buyerId === "string" ? data.buyerId : null;
      const sourceType = typeof data.sourceType === "string" ? data.sourceType : null;
      const sourceId = typeof data.sourceId === "string" ? data.sourceId : null;
      if (!uid || !sourceType || !sourceId) return;

      // ⚠️ PRIMERO se mata el cobro en Stripe, y solo después se devuelve el
      // crédito. El orden importa y antes estaba al revés —de hecho ni siquiera
      // se cancelaba—, y eso era gratis para el comprador:
      //
      //   1. empieza un pago cubierto a medias con saldo a favor,
      //   2. se guarda el `client_secret` y no confirma,
      //   3. a las 6 h este cron le devuelve el saldo,
      //   4. confirma el cobro viejo, que seguía vivo,
      //   5. se lleva el producto pagando solo la parte de la tarjeta Y conserva
      //      el saldo.
      //
      // Cancelar primero cierra la puerta: si la cancelación falla —porque el
      // pago ya se confirmó mientras tanto— NO se devuelve nada y se deja para
      // la siguiente vuelta.
      const stripePaymentIntentId =
        typeof data.stripePaymentIntentId === "string" ? data.stripePaymentIntentId : null;

      if (stripePaymentIntentId) {
        const cancelado = await cancelIntentIfCancelable(stripePaymentIntentId);
        if (!cancelado) {
          logger.warn("credit_cleanup: no se pudo cancelar el cobro, no se devuelve el saldo", {
            externalReference: d.id,
            stripePaymentIntentId,
          });
          return;
        }
      }

      // Relectura DENTRO de la transacción: entre la consulta de arriba y este
      // punto el pago puede haberse confirmado. Sin esto se devolvía el saldo de
      // una compra que acababa de pagarse.
      const devuelto = await db.runTransaction(async (tx) => {
        const fresco = await tx.get(d.ref);
        const actual = fresco.data() ?? {};
        if (actual.status !== "awaiting_payment") return false;
        if (actual.creditReverted === true) return false;

        tx.set(
          d.ref,
          { creditReverted: true, creditRevertedAt: admin.firestore.FieldValue.serverTimestamp() },
          { merge: true }
        );
        return true;
      });

      if (!devuelto) return;

      const amount = await revertBuyerCreditSpend(uid, { sourceType, sourceId });
      if (amount > 0) reverted++;
    })
  );

  logger.info("credit_reservations_cleanup", { reverted, scanned: snap.size });
  return reverted;
}
