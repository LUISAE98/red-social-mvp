// createLiveDonationStripeIntent — cobra una donación en un EN VIVO con Stripe.
//
// Pagar-luego-crear (monto DINÁMICO): la donación se materializa como un super-comentario
// SIN texto en posts/{postId}/superComments/{donationId} al aprobar el pago (webhook →
// reconcile), lo que dispara onSuperCommentLedger (earning `live_donation`) Y la muestra
// destacada en el chat del live. Modelo SOLO MÉXICO: el donante paga (base + $3) + IVA;
// el creador recibe 75% de la base. Cada llamada = una donación nueva.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as crypto from "crypto";
import * as admin from "firebase-admin";
import { stripeFetch, stripeSecretKey } from "./stripeClient";
import { getOrCreateStripeCustomer } from "./stripeCustomer";
import { chargeSavedCardOffSession } from "./offSessionCharge";
import { applyConsumptionTax } from "../../tax/config";
import { SETTLEMENT_CURRENCY, FIXED_SERVICE_FEE_MXN } from "../../wallet/ledger";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();
const REGION = "us-central1";
const MAX_DONATION = 100000; // tope de seguridad
const DONATION_COLOR = "#3b82f6"; // anillo del avatar en el chat (igual que el flujo MP)
const DONATION_DISPLAY_SECS = 15;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

type StripePaymentIntent = { id: string; client_secret: string };

export const createLiveDonationStripeIntent = onCall(
  { region: REGION, cors: true, secrets: [stripeSecretKey] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");

    const data = (request.data ?? {}) as Record<string, unknown>;
    const postId = String(data.postId ?? "").trim(); // el live es un post
    if (!postId) throw new HttpsError("invalid-argument", "Falta el id del en vivo.");

    // `amount` = BASE del creador (MXN). El $3 y el IVA se suman aquí.
    const base = round2(Number(data.amount));
    if (!Number.isFinite(base) || base <= 0) {
      throw new HttpsError("invalid-argument", "Monto de la donación inválido.");
    }
    if (base > MAX_DONATION) {
      throw new HttpsError("invalid-argument", "El monto de la donación es demasiado alto.");
    }

    const postSnap = await db.collection("posts").doc(postId).get();
    if (!postSnap.exists) throw new HttpsError("not-found", "En vivo no encontrado.");
    const post = postSnap.data() as Record<string, unknown>;

    if (!post.liveData && post.postType !== "live") {
      throw new HttpsError("failed-precondition", "Esta publicación no es un en vivo.");
    }

    const authorId = String(post.authorId ?? "");
    if (!authorId) throw new HttpsError("failed-precondition", "En vivo sin autor.");
    if (authorId === uid) throw new HttpsError("failed-precondition", "No puedes donarte a ti mismo.");

    // Perfil del donante (para el super-comentario destacado del chat).
    let username = "Anónimo";
    let avatarUrl: string | null = null;
    const userSnap = await db.collection("users").doc(uid).get();
    if (userSnap.exists) {
      const u = userSnap.data() as Record<string, unknown>;
      username = String(u.displayName ?? u.handle ?? u.username ?? "Anónimo");
      avatarUrl = u.photoURL ? String(u.photoURL) : null;
    }

    const taxCountry = data.taxCountry ? String(data.taxCountry).trim().toUpperCase() : null;
    const saveCard = data.saveCard === true;
    // Si viene, el cobro es "un clic" con una tarjeta ya guardada (off-session, sin CVV).
    const savedPaymentMethodId = data.savedPaymentMethodId ? String(data.savedPaymentMethodId).trim() : null;

    // Precio publicado = base + $3; IVA 16% encima (todo lo absorbe el donante).
    const country = taxCountry || "MX";
    const published = round2(base + FIXED_SERVICE_FEE_MXN);
    const tax = applyConsumptionTax(published, country);
    const totalMxn = round2(published + tax.taxAmount);

    // Id único por donación (es el id del super-comentario que se materializará).
    const donationId = db.collection("posts").doc(postId).collection("superComments").doc().id;
    const externalReference = `liveDonation__${postId}_${donationId}`;

    await db.collection("paymentIntents").doc(externalReference).set({
      externalReference,
      buyerId: uid,
      grossAmount: base, // base → ledger (creador gana 75% de esto)
      sourceType: "liveDonation",
      sourceId: `${postId}_${donationId}`,
      status: "awaiting_payment",
      // Payload = super-comentario SIN texto → onSuperCommentLedger lo cuenta como live_donation.
      // `status: "paid"` es OBLIGATORIO (el trigger filtra por él).
      pendingLiveDonation: {
        userId: uid,
        username,
        avatarUrl,
        text: "",
        tierId: "donation",
        tierName: "Donación",
        color: DONATION_COLOR,
        displaySeconds: DONATION_DISPLAY_SECS,
        amount: base,
        currency: "MXN",
        status: "paid",
        hidden: false,
        isDeleted: false,
        played: false,
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
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const customerId = await getOrCreateStripeCustomer(uid, request.auth?.token?.email ?? null);

    // ── Cobro "un clic" con tarjeta guardada (off-session, sin CVV) ──────────
    if (savedPaymentMethodId) {
      const charged = await chargeSavedCardOffSession({
        uid,
        savedCardDocId: savedPaymentMethodId,
        customerId,
        amountCents: Math.round(totalMxn * 100),
        currency: SETTLEMENT_CURRENCY,
        metadata: { externalReference, sourceType: "liveDonation", sourceId: `${postId}_${donationId}`, buyerId: uid },
      });
      await db.collection("paymentIntents").doc(externalReference).set(
        { stripePaymentIntentId: charged.id, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
      return { status: charged.status, clientSecret: charged.clientSecret };
    }

    const res = await stripeFetch<StripePaymentIntent>("/payment_intents", {
      method: "POST",
      idempotencyKey: crypto.randomUUID(),
      form: {
        amount: Math.round(totalMxn * 100), // centavos MXN
        currency: SETTLEMENT_CURRENCY.toLowerCase(),
        customer: customerId,
        payment_method_types: ["card"],
        ...(saveCard ? { setup_future_usage: "off_session" } : {}),
        metadata: { externalReference, sourceType: "liveDonation", sourceId: `${postId}_${donationId}`, buyerId: uid },
      },
    });
    if (!res.ok) throw new HttpsError("internal", `No se pudo crear el pago (${res.status}): ${res.error.slice(0, 200)}`);

    await db.collection("paymentIntents").doc(externalReference).set(
      { stripePaymentIntentId: res.data.id, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );

    return { clientSecret: res.data.client_secret };
  }
);
