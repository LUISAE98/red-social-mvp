// createPremiumPostStripeIntent — cobra el desbloqueo de una publicación premium / VOD con Stripe.
//
// Pagar-luego-conceder: el acceso (postAccess) aún NO existe; esta función crea el
// paymentIntents/{externalReference} con el payload pendingPostAccess y el PaymentIntent de
// Stripe. Al aprobar el pago, el webhook → reconcile materializa postAccess/{buyerId}_{postId}
// en estado "active" → dispara onPostAccessLedger (clasifica premium_post vs vod_ticket por
// post.liveData) y onPremiumUnlockCount. Modelo SOLO MÉXICO: el comprador paga (base + $3) + IVA;
// el creador recibe 75% de la base. Cubre POST premium y VOD premium (mismo camino postAccess).

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as crypto from "crypto";
import * as admin from "firebase-admin";
import { stripeFetch, stripeSecretKey } from "./stripeClient";
import { getOrCreateStripeCustomer } from "./stripeCustomer";
import { applyConsumptionTax } from "../../tax/config";
import { SETTLEMENT_CURRENCY, FIXED_SERVICE_FEE_MXN } from "../../wallet/ledger";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();
const REGION = "us-central1";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

type StripePaymentIntent = { id: string; client_secret: string };

export const createPremiumPostStripeIntent = onCall(
  { region: REGION, cors: true, secrets: [stripeSecretKey] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");

    const data = (request.data ?? {}) as Record<string, unknown>;
    const postId = String(data.postId ?? "").trim();
    if (!postId) throw new HttpsError("invalid-argument", "Falta el id de la publicación.");

    const postSnap = await db.collection("posts").doc(postId).get();
    if (!postSnap.exists) throw new HttpsError("not-found", "Publicación no encontrada.");
    const post = postSnap.data() as Record<string, unknown>;
    const premium = (post.premium ?? {}) as Record<string, unknown>;
    if (premium.enabled !== true) {
      throw new HttpsError("failed-precondition", "La publicación no es premium.");
    }

    const creatorId = String(post.authorId ?? "");
    if (!creatorId) throw new HttpsError("failed-precondition", "Publicación sin autor.");
    if (creatorId === uid) throw new HttpsError("failed-precondition", "Es tu propia publicación.");

    // La base del creador se trata en MXN (premium ya fuerza MXN).
    const base = round2(Number(premium.price ?? post.oneTimePrice ?? 0));
    if (!Number.isFinite(base) || base <= 0) {
      throw new HttpsError("failed-precondition", "Precio inválido para esta publicación.");
    }

    const groupId = post.groupId ? String(post.groupId) : null;
    const contextType = groupId ? "group" : "profile";
    const profileId = contextType === "profile" ? creatorId : null;

    const accessId = `${uid}_${postId}`;
    const externalReference = `postAccess__${accessId}`;

    // ¿Ya tiene acceso activo? No re-cobrar.
    const accessSnap = await db.collection("postAccess").doc(accessId).get();
    if (accessSnap.exists && accessSnap.data()?.status === "active") {
      throw new HttpsError("failed-precondition", "Ya tienes acceso a esta publicación.");
    }

    const intentRef = db.collection("paymentIntents").doc(externalReference);
    const intentSnap = await intentRef.get();
    const existingStatus = intentSnap.exists ? intentSnap.data()?.status : null;
    if (existingStatus === "approved" || existingStatus === "paid") {
      throw new HttpsError("failed-precondition", "Ya tienes acceso a esta publicación.");
    }

    const taxCountry = data.taxCountry ? String(data.taxCountry).trim().toUpperCase() : null;
    const saveCard = data.saveCard === true;

    // Precio publicado = base + $3 cargo fijo; IVA 16% encima (todo lo absorbe el comprador).
    const country = taxCountry || "MX";
    const published = round2(base + FIXED_SERVICE_FEE_MXN);
    const tax = applyConsumptionTax(published, country);
    const totalMxn = round2(published + tax.taxAmount);

    await intentRef.set(
      {
        externalReference,
        buyerId: uid,
        grossAmount: base, // base → ledger (creador gana 75% de esto)
        sourceType: "postAccess",
        sourceId: accessId,
        status: "awaiting_payment",
        pendingPostAccess: {
          postId,
          buyerId: uid,
          creatorId,
          groupId,
          profileId,
          contextType,
          status: "active",
          source: "stripe",
          purchaseType: "one_time",
          price: base,
          currency: "MXN",
        },
        baseAmount: base,
        fixedFee: FIXED_SERVICE_FEE_MXN,
        publishedAmount: published,
        taxAmount: tax.taxAmount,
        taxCountry: tax.taxCountry,
        taxRate: tax.taxRate,
        chargedAmount: totalMxn,
        settlementCurrency: SETTLEMENT_CURRENCY,
        settlementAmount: totalMxn,
        paymentMode: "stripe",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        ...(intentSnap.exists ? {} : { createdAt: admin.firestore.FieldValue.serverTimestamp() }),
      },
      { merge: true }
    );

    const customerId = await getOrCreateStripeCustomer(uid, request.auth?.token?.email ?? null);

    const res = await stripeFetch<StripePaymentIntent>("/payment_intents", {
      method: "POST",
      idempotencyKey: crypto.randomUUID(),
      form: {
        amount: Math.round(totalMxn * 100), // centavos MXN
        currency: SETTLEMENT_CURRENCY.toLowerCase(),
        customer: customerId,
        payment_method_types: ["card"],
        ...(saveCard ? { setup_future_usage: "off_session" } : {}),
        metadata: { externalReference, sourceType: "postAccess", sourceId: accessId, buyerId: uid },
      },
    });
    if (!res.ok) throw new HttpsError("internal", `No se pudo crear el pago (${res.status}): ${res.error.slice(0, 200)}`);

    await intentRef.set(
      { stripePaymentIntentId: res.data.id, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );

    return { clientSecret: res.data.client_secret };
  }
);
