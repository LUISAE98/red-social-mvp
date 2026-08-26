// Residencia fiscal del creador — la primera pieza del perfil fiscal (Bloque A).
//
// Es el dato que bifurca TODO el alta de cobro y, más adelante, el cálculo de retenciones:
//
//   · Creador MEXICANO   → verificación de identidad + sello digital. Sin ambos no retira,
//     porque sin sello Vibra no puede emitir sus facturas de venta.
//   · Creador EXTRANJERO → solo verificación de identidad. No emite CFDI, así que no hay sello
//     que pedirle.
//
// Se guarda declarado por el creador, no inferido por IP: la IP dice dónde está hoy, no dónde
// tributa. Un mexicano de viaje no deja de ser residente en México.
//
// ⚠️ Cambiarla NO es cosmético: mueve las tasas de retención. Por eso vive en el backend, se
// registra con fecha, y queda la marca de que hubo un cambio para poder auditarlo.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();
const REGION = "us-central1";

export type CreatorResidency = "MX" | "FOREIGN";

export const setCreatorResidency = onCall({ region: REGION, cors: true }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");

  const raw = String((request.data as { residency?: unknown })?.residency ?? "").trim().toUpperCase();
  if (raw !== "MX" && raw !== "FOREIGN") {
    throw new HttpsError("invalid-argument", "Residencia fiscal inválida.");
  }
  const residency = raw as CreatorResidency;

  const ref = db.collection("creatorTaxProfiles").doc(uid);
  const snap = await ref.get();
  const prev = snap.exists ? snap.data() ?? {} : {};
  const anterior = prev.residency as CreatorResidency | undefined;

  if (anterior === residency) return { ok: true, residency, changed: false };

  await ref.set(
    {
      creatorId: uid,
      residency,
      residencyDeclaredAt: admin.firestore.FieldValue.serverTimestamp(),
      // Marca de auditoría: un cambio de residencia con ventas ya hechas obliga a revisar
      // las retenciones aplicadas antes del cambio.
      ...(anterior ? { residencyChangedFrom: anterior } : {}),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  logger.info("creator_residency_set", { uid, residency, anterior: anterior ?? null });
  return { ok: true, residency, changed: true };
});
