// Migración de corrida única: saca los datos personales del documento público
// del perfil y los deja en `users/{uid}/private/identity`.
//
// `users/{uid}` es de lectura pública (perfiles, búsqueda, feeds) y Firestore no
// sabe ocultar campos sueltos: si el documento se lee, se leen TODOS. El correo,
// la fecha de nacimiento y el sexo de toda la base eran recolectables con una
// sola consulta. Los perfiles NUEVOS ya nacen bien; esto arregla los viejos.
//
// Es `onCall` con gate por correo de administrador, NUNCA `onRequest` abierto —
// mismo patrón que `backfillSavedPosts`. Idempotente: reejecutarla es inofensivo.

import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/v2/https";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const ADMIN_EMAIL = "luis@consumed.mx";

// Los campos que se mudan. `role` se queda: no es personal y vale "user".
const PRIVATE_FIELDS = [
  "email",
  "emailLower",
  "birthDate",
  "sex",
  "provider",
  "authProvider",
] as const;

export const migratePrivateProfile = onCall(
  { region: "us-central1", timeoutSeconds: 540, memory: "512MiB" },
  async (request) => {
    const email = request.auth?.token?.email;
    if (!email || email !== ADMIN_EMAIL) {
      throw new HttpsError("permission-denied", "Solo administración.");
    }

    // `dryRun` por defecto: la primera corrida solo cuenta, no toca nada.
    const dryRun = request.data?.dryRun !== false;

    let scanned = 0;
    let migrated = 0;
    let alreadyDone = 0;
    let nothingToMove = 0;

    const snap = await db.collection("users").get();

    let batch = db.batch();
    let pending = 0;

    for (const docSnap of snap.docs) {
      scanned += 1;
      const data = docSnap.data();

      const present = PRIVATE_FIELDS.filter((f) => data[f] !== undefined);
      if (present.length === 0) {
        nothingToMove += 1;
        continue;
      }

      const privateRef = docSnap.ref.collection("private").doc("identity");
      const privateSnap = await privateRef.get();
      if (privateSnap.exists) {
        alreadyDone += 1;
      }

      if (dryRun) {
        migrated += 1;
        continue;
      }

      const payload: Record<string, unknown> = {
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      for (const field of present) payload[field] = data[field];
      if (!privateSnap.exists) {
        payload.createdAt = admin.firestore.FieldValue.serverTimestamp();
      }

      // `merge` para no pisar lo que ya escribió un registro nuevo.
      batch.set(privateRef, payload, { merge: true });

      // Y se BORRAN del documento público, que es el objetivo de todo esto.
      const removal: Record<string, unknown> = {};
      for (const field of present) {
        removal[field] = admin.firestore.FieldValue.delete();
      }
      batch.update(docSnap.ref, removal);

      migrated += 1;
      pending += 2;
      if (pending >= 400) {
        await batch.commit();
        batch = db.batch();
        pending = 0;
      }
    }

    if (!dryRun && pending > 0) await batch.commit();

    const summary = { dryRun, scanned, migrated, alreadyDone, nothingToMove };
    logger.info("migratePrivateProfile", summary);
    return summary;
  }
);
