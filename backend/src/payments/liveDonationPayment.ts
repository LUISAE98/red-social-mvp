// payLiveDonation — cobra una donación en vivo con Mercado Pago.
//
// Pagar-luego-crear: la donación se materializa como un super-comentario SIN texto
// en posts/{postId}/superComments/{donationId} al aprobar el pago (reconcile), lo
// que dispara onSuperCommentLedger (earning `live_donation`) Y la muestra destacada
// en el chat del live. El monto lo elige el donante (variable), acotado por un tope.
// Cada llamada = una donación nueva. Reusa `chargeServiceIntent` (cobra grossAmount).

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
const DONATION_COLOR = "#3b82f6"; // anillo del avatar en el chat (igual que el flujo viejo)
const DONATION_DISPLAY_SECS = 15;

export const payLiveDonation = onCall(
  { region: REGION, secrets: [mpAccessToken], cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");

    const data = (request.data ?? {}) as Record<string, unknown>;
    const postId = String(data.postId ?? "").trim(); // el live es un post
    if (!postId) throw new HttpsError("invalid-argument", "Falta el id del en vivo.");

    const amount = Number(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new HttpsError("invalid-argument", "Monto de la donación inválido.");
    }
    if (amount > MAX_DONATION) {
      throw new HttpsError("invalid-argument", "El monto de la donación es demasiado alto.");
    }

    const postSnap = await db.collection("posts").doc(postId).get();
    if (!postSnap.exists) throw new HttpsError("not-found", "En vivo no encontrado.");
    const post = postSnap.data() as Record<string, unknown>;

    // Debe ser un live, para que onSuperCommentLedger atribuya el earning al live (liveId).
    if (!post.liveData && post.postType !== "live") {
      throw new HttpsError("failed-precondition", "Esta publicación no es un en vivo.");
    }

    const authorId = String(post.authorId ?? "");
    if (!authorId) throw new HttpsError("failed-precondition", "En vivo sin autor.");
    if (authorId === uid) {
      throw new HttpsError("failed-precondition", "No puedes donarte a ti mismo.");
    }

    // Perfil del donante (para el super-comentario destacado del chat).
    let username = "Anónimo";
    let avatarUrl: string | null = null;
    const userSnap = await db.collection("users").doc(uid).get();
    if (userSnap.exists) {
      const u = userSnap.data() as Record<string, unknown>;
      username = String(u.displayName ?? u.handle ?? u.username ?? "Anónimo");
      avatarUrl = u.photoURL ? String(u.photoURL) : null;
    }

    // Id único por donación (se puede donar varias veces). Es el id del super-comentario.
    const donationId = db.collection("posts").doc(postId).collection("superComments").doc().id;
    const externalReference = `liveDonation__${postId}_${donationId}`;

    await db.collection("paymentIntents").doc(externalReference).set({
      externalReference,
      buyerId: uid,
      grossAmount: amount,
      sourceType: "liveDonation",
      sourceId: `${postId}_${donationId}`,
      status: "created",
      // Payload = super-comentario SIN texto → onSuperCommentLedger lo cuenta como
      // live_donation. `status: "paid"` es OBLIGATORIO (el trigger filtra por él).
      pendingLiveDonation: {
        userId: uid,
        username,
        avatarUrl,
        text: "",
        tierId: "donation",
        tierName: "Donación",
        color: DONATION_COLOR,
        displaySeconds: DONATION_DISPLAY_SECS,
        amount,
        currency: "MXN",
        status: "paid",
        hidden: false,
        isDeleted: false,
        played: false,
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
    });
  }
);
