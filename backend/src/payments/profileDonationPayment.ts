// payProfileDonation — cobra una donación/contribución a un perfil con MP.
//
// Pagar-luego-crear: la donación aún NO existe; la compra vive en un paymentIntent
// que esta función crea. Al aprobar el pago, reconcile materializa
// profileDonations/{donationId} (paymentStatus "paid"), lo que dispara el ledger
// (onProfileDonationLedger). El monto lo elige el donante (variable), acotado por
// un tope de seguridad. Cada llamada = una donación nueva (no idempotente por
// diseño: se puede donar varias veces). Reusa `chargeServiceIntent`.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { mpAccessToken } from "./mpClient";
import { chargeServiceIntent } from "./serviceCharge";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();
const REGION = "us-central1";
const MAX_DONATION = 100000; // tope de seguridad (evita errores/abuso)

export const payProfileDonation = onCall(
  { region: REGION, secrets: [mpAccessToken], cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");

    const data = (request.data ?? {}) as Record<string, unknown>;
    const creatorId = String(data.creatorId ?? "").trim();
    if (!creatorId) throw new HttpsError("invalid-argument", "Falta el creador.");
    if (creatorId === uid) {
      throw new HttpsError("failed-precondition", "No puedes hacerte una contribución a ti mismo.");
    }

    const amount = Number(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new HttpsError("invalid-argument", "Monto de la contribución inválido.");
    }
    if (amount > MAX_DONATION) {
      throw new HttpsError("invalid-argument", "El monto de la contribución es demasiado alto.");
    }

    const currency = String(data.currency ?? "MXN");

    // Canal de la donación: perfil (default) o comunidad. `groupId`/`groupName`
    // son metadatos (el dinero sigue yendo al creatorId, igual que en perfil);
    // sirven para atribuir la donación a la comunidad en la notificación.
    const groupId = typeof data.groupId === "string" && data.groupId.trim() ? data.groupId.trim() : null;
    const groupName = typeof data.groupName === "string" && data.groupName.trim() ? data.groupName.trim() : null;

    // Id único por donación (se puede donar varias veces al mismo creador).
    const donationId = db.collection("profileDonations").doc().id;
    const externalReference = `profileDonation__${donationId}`;

    await db.collection("paymentIntents").doc(externalReference).set({
      externalReference,
      buyerId: uid,
      grossAmount: amount,
      sourceType: "profileDonation",
      sourceId: donationId,
      status: "created",
      pendingProfileDonation: {
        creatorId,
        buyerId: uid,
        amount,
        currency,
        source: groupId ? "group" : "profile",
        groupId,
        groupName,
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return chargeServiceIntent(externalReference, uid, {
      token: String(data.token ?? "").trim(),
      paymentMethodId: String(data.paymentMethodId ?? "").trim(),
      paymentType: String(data.paymentType ?? "credit_card").trim(),
      installments: Number(data.installments),
      payerEmail: String(data.payerEmail ?? request.auth?.token?.email ?? "").trim(),
      saveToken: data.saveToken ? String(data.saveToken).trim() : undefined,
      savedCardId: data.savedCardId ? String(data.savedCardId).trim() : undefined,
      // 🧾 IVA — país fiscal del comprador (por IP en el cliente); el backend suma el IVA.
      taxCountry: data.taxCountry ? String(data.taxCountry).trim().toUpperCase() : null,
    });
  }
);
