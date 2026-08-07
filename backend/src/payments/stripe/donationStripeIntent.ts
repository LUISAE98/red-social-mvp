// createDonationStripeIntent — cobra una donación/contribución a un perfil con Stripe.
//
// Pagar-luego-crear con monto DINÁMICO (lo elige el donador). Cada llamada crea un
// paymentIntent nuevo (se puede donar varias veces). Al aprobar el pago, el webhook →
// reconcile materializa profileDonations/{donationId} → onProfileDonationLedger registra
// la ganancia (75% del monto base). Modelo SOLO MÉXICO: el donador paga (base + $3) + IVA;
// el creador recibe 75% de la base.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as crypto from "crypto";
import * as admin from "firebase-admin";
import { stripeFetch, stripeSecretKey } from "./stripeClient";
import { getOrCreateStripeCustomer } from "./stripeCustomer";
import { chargeSavedCardOffSession } from "./offSessionCharge";
import { applyConsumptionTax, isChargeableCountry } from "../../tax/config";
import { SETTLEMENT_CURRENCY, FIXED_SERVICE_FEE_MXN } from "../../wallet/ledger";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();
const REGION = "us-central1";
const MIN_DONATION = 50; // mínimo por donación (MXN base)
const MAX_DONATION = 100000; // tope de seguridad

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

type StripePaymentIntent = { id: string; client_secret: string };

export const createDonationStripeIntent = onCall(
  { region: REGION, cors: true, secrets: [stripeSecretKey] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
    // Invitado = sesión ANÓNIMA. A un invitado NUNCA se le cobra off-session (un-clic sin
    // CVV): aunque tenga tarjeta guardada, debe re-confirmar con CVV on-session (el cliente
    // confirma el clientSecret con la PM + CVC). Evita que otra persona en el mismo
    // dispositivo cobre sin la tarjeta física. El un-clic queda solo para cuentas reales.
    const isGuest =
      (request.auth?.token as { firebase?: { sign_in_provider?: string } } | undefined)?.firebase
        ?.sign_in_provider === "anonymous";

    const data = (request.data ?? {}) as Record<string, unknown>;
    const creatorId = String(data.creatorId ?? "").trim();
    if (!creatorId) throw new HttpsError("invalid-argument", "Falta el creador.");
    if (creatorId === uid) throw new HttpsError("failed-precondition", "No puedes contribuirte a ti mismo.");

    const base = round2(Number(data.amount));
    if (!Number.isFinite(base) || base < MIN_DONATION) {
      throw new HttpsError("invalid-argument", `El monto mínimo de contribución es $${MIN_DONATION}.`);
    }
    if (base > MAX_DONATION) throw new HttpsError("invalid-argument", "El monto es demasiado alto.");

    const saveCard = data.saveCard === true;
    // Si viene, el cobro es "un clic" con una tarjeta ya guardada (off-session, sin CVV).
    const savedPaymentMethodId = data.savedPaymentMethodId ? String(data.savedPaymentMethodId).trim() : null;
    const taxCountry = data.taxCountry ? String(data.taxCountry).trim().toUpperCase() : null;
    const groupId = typeof data.groupId === "string" && data.groupId.trim() ? data.groupId.trim() : null;
    const groupName = typeof data.groupName === "string" && data.groupName.trim() ? data.groupName.trim() : null;
    // Apodo del donador (invitado sin login o usuario con sesión). Se guarda con la
    // donación para mostrar quién contribuyó. Opcional; se recorta a 24.
    const nickname = typeof data.nickname === "string" && data.nickname.trim() ? data.nickname.trim().slice(0, 24) : null;

    // Precio publicado = base + $3 cargo fijo; IVA 16% encima (todo lo absorbe el donador).
    const country = taxCountry || "MX";
    // El país fiscal NO se confía del cliente: si manda uno sin IVA configurado (para
    // evadir el impuesto), se rechaza. Solo se cobra donde el impuesto está definido (MX).
    if (!isChargeableCountry(country)) {
      throw new HttpsError("failed-precondition", "El cobro solo está disponible en México por ahora.");
    }
    const published = round2(base + FIXED_SERVICE_FEE_MXN);
    const tax = applyConsumptionTax(published, country);
    const totalMxn = round2(published + tax.taxAmount);

    const donationId = db.collection("profileDonations").doc().id;
    const externalReference = `profileDonation__${donationId}`;

    await db.collection("paymentIntents").doc(externalReference).set({
      externalReference,
      buyerId: uid,
      grossAmount: base, // base → ledger (creador gana 75% de esto)
      sourceType: "profileDonation",
      sourceId: donationId,
      status: "awaiting_payment",
      pendingProfileDonation: {
        creatorId,
        buyerId: uid,
        amount: base,
        currency: "MXN",
        source: groupId ? "group" : "profile",
        groupId,
        groupName,
        donorNickname: nickname,
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

    // ── Cobro "un clic" con tarjeta guardada (off-session, sin CVV) — SOLO cuentas reales ──
    // Un invitado con tarjeta guardada cae al flujo on-session de abajo (confirma con CVV).
    if (savedPaymentMethodId && !isGuest) {
      const charged = await chargeSavedCardOffSession({
        uid,
        savedCardDocId: savedPaymentMethodId,
        customerId,
        amountCents: Math.round(totalMxn * 100),
        currency: SETTLEMENT_CURRENCY,
        metadata: { externalReference, sourceType: "profileDonation", sourceId: donationId, buyerId: uid },
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
        metadata: { externalReference, sourceType: "profileDonation", sourceId: donationId, buyerId: uid },
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
