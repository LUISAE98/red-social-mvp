// payLiveAccess — cobra el ticket de acceso a un en vivo con Mercado Pago.
//
// Pagar-luego-conceder (igual que premium/VOD): el acceso aún NO existe; la
// compra vive en un paymentIntent que esta función crea. Al aprobar el pago,
// reconcile materializa liveAccess/{liveId}/users/{userId} con status "paid",
// lo que dispara el ledger (onLiveAccessLedger). Reusa `chargeServiceIntent`.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { mpAccessToken } from "./mpClient";
import { chargeServiceIntent } from "./serviceCharge";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();
const REGION = "us-central1";

export const payLiveAccess = onCall(
  { region: REGION, secrets: [mpAccessToken], cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");

    const data = (request.data ?? {}) as Record<string, unknown>;
    const postId = String(data.postId ?? "").trim(); // el live es un post
    if (!postId) throw new HttpsError("invalid-argument", "Falta el id del en vivo.");

    const postSnap = await db.collection("posts").doc(postId).get();
    if (!postSnap.exists) throw new HttpsError("not-found", "En vivo no encontrado.");
    const post = postSnap.data() as Record<string, unknown>;

    if (post.requiresPayment !== true) {
      throw new HttpsError("failed-precondition", "Este en vivo no requiere ticket.");
    }

    const authorId = String(post.authorId ?? "");
    if (!authorId) throw new HttpsError("failed-precondition", "En vivo sin autor.");
    if (authorId === uid) {
      throw new HttpsError("failed-precondition", "Es tu propio en vivo.");
    }

    const liveData = (post.liveData ?? {}) as Record<string, unknown>;
    const price = Number(post.oneTimePrice ?? liveData.ticketPrice ?? 0);
    if (!Number.isFinite(price) || price <= 0) {
      throw new HttpsError("failed-precondition", "Precio de ticket inválido.");
    }

    const currencyRaw = String(post.currency ?? liveData.currency ?? "MXN");
    const currency = currencyRaw === "USD" ? "USD" : "MXN";
    const groupId = post.groupId ? String(post.groupId) : null;

    // liveId = postId (así lo lee checkLiveAccess). Un ticket por usuario por live.
    const liveId = postId;
    const externalReference = `liveAccess__${liveId}_${uid}`;

    // ¿Ya tiene acceso? No re-cobrar.
    const accessSnap = await db.doc(`liveAccess/${liveId}/users/${uid}`).get();
    if (accessSnap.exists && accessSnap.data()?.status === "paid") {
      throw new HttpsError("failed-precondition", "Ya tienes acceso a este en vivo.");
    }

    const intentRef = db.collection("paymentIntents").doc(externalReference);
    const intentSnap = await intentRef.get();
    const existingStatus = intentSnap.exists ? intentSnap.data()?.status : null;
    if (existingStatus === "approved" || existingStatus === "paid") {
      throw new HttpsError("failed-precondition", "Ya tienes acceso a este en vivo.");
    }

    await intentRef.set(
      {
        externalReference,
        buyerId: uid,
        grossAmount: price,
        sourceType: "liveAccess",
        sourceId: `${liveId}_${uid}`,
        status: existingStatus ?? "created",
        pendingLiveAccess: {
          liveId,
          userId: uid,
          postId,
          groupId,
          authorId,
          accessType: "live_ticket",
          amount: price,
          currency,
          status: "paid",
          source: "mercado_pago",
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        ...(intentSnap.exists ? {} : { createdAt: admin.firestore.FieldValue.serverTimestamp() }),
      },
      { merge: true }
    );

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
