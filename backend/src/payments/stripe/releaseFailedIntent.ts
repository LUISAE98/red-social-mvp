/**
 * Cierra un cobro que murió (rechazado o cancelado) y suelta lo que retenía.
 *
 * ── El problema ──────────────────────────────────────────────────────────────
 * `payment_intent.payment_failed` y `payment_intent.canceled` caían en el "otros
 * eventos: solo se registran" del webhook. Eso dejaba dos cosas colgando:
 *
 *  1. El `paymentIntents/{ref}` se quedaba en `awaiting_payment` para siempre,
 *     mintiendo sobre el estado de esa compra.
 *  2. Si el comprador había aplicado saldo a favor, ese saldo seguía RESERVADO
 *     —descontado de su bolsillo— hasta que el cron de las 6 h lo soltara.
 *
 * A quien le rechazan la tarjeta no se le puede tener el saldo secuestrado unas
 * horas: lo normal es que reintente enseguida, y se encontraba con menos saldo
 * del que tenía.
 *
 * ⚠️ Solo actúa si el intent sigue `awaiting_payment`. Un evento de fallo que
 * llega tarde —después de que otro cobro de la misma compra saliera bien— no
 * puede deshacer una compra pagada.
 */

import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import { revertBuyerCreditSpend } from "../../wallet/buyerCredit";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();

export async function releaseFailedIntent(
  externalReference: string,
  motivo: "failed" | "canceled"
): Promise<void> {
  const ref = db.collection("paymentIntents").doc(externalReference);

  const datos = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;

    const data = snap.data() ?? {};
    if (data.status !== "awaiting_payment") return null; // ya resuelto: no se toca
    if (data.creditReverted === true) return null; // el saldo ya se soltó

    tx.set(
      ref,
      {
        status: motivo,
        creditReverted: true,
        creditRevertedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return {
      uid: typeof data.buyerId === "string" ? data.buyerId : null,
      sourceType: typeof data.sourceType === "string" ? data.sourceType : null,
      sourceId: typeof data.sourceId === "string" ? data.sourceId : null,
      creditApplied: typeof data.creditApplied === "number" ? data.creditApplied : 0,
    };
  });

  if (!datos || !datos.uid || !datos.sourceType || !datos.sourceId) return;
  if (datos.creditApplied <= 0) return;

  const devuelto = await revertBuyerCreditSpend(datos.uid, {
    sourceType: datos.sourceType,
    sourceId: datos.sourceId,
  });

  logger.info("releaseFailedIntent: saldo devuelto", {
    externalReference,
    motivo,
    uid: datos.uid,
    devuelto,
  });
}
