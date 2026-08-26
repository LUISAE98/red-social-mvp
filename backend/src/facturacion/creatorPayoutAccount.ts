// País de la cuenta donde cobra el creador — dato FISCAL, no logístico.
//
// 🚨 Dispara por sí solo la retención del 100% del IVA. Un creador mexicano que cobra en una
// cuenta fuera de México pasa de 50% a 100% de retención, y eso son 8 puntos de su liquidación.
//
// Lo que decide es **dónde cobra él**, no dónde estén las cuentas de Vibra: pagar desde una
// cuenta estadounidense a un creador mexicano con cuenta mexicana NO lo activa.
//
// Por eso se reevalúa cada vez que lo cambia, y el cambio queda fechado: las ventas anteriores
// se liquidaron con la tasa vigente entonces y no se recalculan hacia atrás.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();
const REGION = "us-central1";

const PAIS_RE = /^[A-Z]{2}$/;

export const setCreatorPayoutAccountCountry = onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");

    const country = String((request.data as { country?: unknown })?.country ?? "")
      .trim()
      .toUpperCase();
    if (!PAIS_RE.test(country)) {
      throw new HttpsError("invalid-argument", "País de la cuenta inválido.");
    }

    const ref = db.collection("creatorTaxProfiles").doc(uid);
    const snap = await ref.get();
    const prev = snap.exists ? snap.data() ?? {} : {};
    const anterior = typeof prev.payoutAccountCountry === "string" ? prev.payoutAccountCountry : null;

    if (anterior === country) {
      return { ok: true, country, changed: false, raisesRetention: country !== "MX" };
    }

    await ref.set(
      {
        creatorId: uid,
        payoutAccountCountry: country,
        payoutAccountCountryAt: admin.firestore.FieldValue.serverTimestamp(),
        ...(anterior ? { payoutAccountCountryChangedFrom: anterior } : {}),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    logger.info("creator_payout_country_set", { uid, country, anterior });
    // El aviso importa: el creador debe poder ver ANTES de guardar que cobrar fuera de
    // México le sube la retención. Enterarse en el estado de cuenta es peor.
    return { ok: true, country, changed: true, raisesRetention: country !== "MX" };
  }
);
