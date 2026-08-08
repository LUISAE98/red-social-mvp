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

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

// Un checkout de tarjeta nueva se confirma en la misma sesión (minutos). Pasadas estas
// horas sin confirmarse, se considera abandonado y se libera la reserva. Margen amplio
// para NO revertir un pago que aún esté en vuelo.
const ABANDON_HOURS = 6;

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

      const amount = await revertBuyerCreditSpend(uid, { sourceType, sourceId });
      await d.ref.set(
        { creditReverted: true, creditRevertedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
      if (amount > 0) reverted++;
    })
  );

  logger.info("credit_reservations_cleanup", { reverted, scanned: snap.size });
  return reverted;
}
