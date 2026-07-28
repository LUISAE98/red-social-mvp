// payPremiumPost — cobra el desbloqueo de una publicación premium / VOD con MP.
//
// Pagar-luego-conceder: el acceso (postAccess) aún NO existe; la compra vive en
// un paymentIntent que esta función crea a partir del post. Al aprobar el pago,
// reconcile materializa `postAccess/{buyerId}_{postId}` en estado "active" (lo
// que dispara el ledger y el contador de desbloqueos). Reusa `chargeServiceIntent`.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { mpAccessToken } from "./mpClient";
import { chargeServiceIntent } from "./serviceCharge";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();
const REGION = "us-central1";

export const payPremiumPost = onCall(
  { region: REGION, secrets: [mpAccessToken], cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");

    const data = (request.data ?? {}) as Record<string, unknown>;
    const postId = String(data.postId ?? "").trim();
    if (!postId) throw new HttpsError("invalid-argument", "Falta el id de la publicación.");

    // Cargar el post y validar que es premium y cobrable.
    const postSnap = await db.collection("posts").doc(postId).get();
    if (!postSnap.exists) throw new HttpsError("not-found", "Publicación no encontrada.");
    const post = postSnap.data() as Record<string, unknown>;
    const premium = (post.premium ?? {}) as Record<string, unknown>;
    if (premium.enabled !== true) {
      throw new HttpsError("failed-precondition", "La publicación no es premium.");
    }

    const creatorId = String(post.authorId ?? "");
    if (!creatorId) throw new HttpsError("failed-precondition", "Publicación sin autor.");
    if (creatorId === uid) {
      throw new HttpsError("failed-precondition", "Es tu propia publicación.");
    }

    const price = Number(premium.price ?? post.oneTimePrice ?? 0);
    if (!Number.isFinite(price) || price <= 0) {
      throw new HttpsError("failed-precondition", "Precio inválido para esta publicación.");
    }

    const currency = String(premium.currency ?? "MXN");
    const groupId = post.groupId ? String(post.groupId) : null;
    const contextType = groupId ? "group" : "profile";
    const profileId = contextType === "profile" ? creatorId : null;

    // Mismo esquema de id que usaba el desbloqueo previo: {buyerId}_{postId}.
    const accessId = `${uid}_${postId}`;
    const externalReference = `postAccess__${accessId}`;

    // ¿Ya tiene acceso activo? No re-cobrar.
    const accessSnap = await db.collection("postAccess").doc(accessId).get();
    if (accessSnap.exists && accessSnap.data()?.status === "active") {
      throw new HttpsError("failed-precondition", "Ya tienes acceso a esta publicación.");
    }

    // Crea/asegura el paymentIntent con el payload que reconcile materializará.
    // Conserva el status existente (para no pisar uno ya aprobado); si no hay,
    // arranca en "created".
    const intentRef = db.collection("paymentIntents").doc(externalReference);
    const intentSnap = await intentRef.get();
    const existingStatus = intentSnap.exists ? intentSnap.data()?.status : null;
    if (existingStatus === "approved" || existingStatus === "paid") {
      throw new HttpsError("failed-precondition", "Ya tienes acceso a esta publicación.");
    }

    await intentRef.set(
      {
        externalReference,
        buyerId: uid,
        grossAmount: price,
        sourceType: "postAccess",
        sourceId: accessId,
        status: existingStatus ?? "created",
        pendingPostAccess: {
          postId,
          buyerId: uid,
          creatorId,
          groupId,
          profileId,
          contextType,
          status: "active",
          source: "mercado_pago",
          purchaseType: "one_time",
          price,
          currency,
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
