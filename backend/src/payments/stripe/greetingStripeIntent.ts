// Cablea el SALUDO/CONSEJO a Stripe. Reusa el paymentIntent ya creado por
// createGreetingRequest (pagar-luego-crear): lee el precio del SERVIDOR, le suma el
// IVA, crea un PaymentIntent de Stripe con la metadata que el webhook necesita para
// materializar el saludo + ledger (applyApprovedPaymentToSource).
//
// Precio autoritativo del servidor (NO del cliente). El comprador solo confirma con
// la tarjeta (Elements). Sigue todo en modo prueba.

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

export const createGreetingStripeIntent = onCall(
  { region: REGION, cors: true, secrets: [stripeSecretKey] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");

    const data = (request.data ?? {}) as { greetingRequestId?: unknown; saveCard?: unknown; taxCountry?: unknown };
    const requestId = String(data.greetingRequestId ?? "").trim();
    if (!requestId) throw new HttpsError("invalid-argument", "Falta el id de la solicitud.");
    const saveCard = data.saveCard === true;
    const taxCountry = data.taxCountry ? String(data.taxCountry).trim().toUpperCase() : null;

    const externalReference = `greetingRequest__${requestId}`;
    const intentRef = db.collection("paymentIntents").doc(externalReference);
    const snap = await intentRef.get();
    if (!snap.exists) throw new HttpsError("not-found", "Solicitud no encontrada.");
    const intent = snap.data() ?? {};

    if (intent.buyerId !== uid) throw new HttpsError("permission-denied", "No eres el comprador de esta solicitud.");
    if (intent.status === "paid" || intent.status === "approved") {
      throw new HttpsError("failed-precondition", "Esta solicitud ya está pagada.");
    }
    const base = Number(intent.grossAmount);
    if (!Number.isFinite(base) || base <= 0) throw new HttpsError("failed-precondition", "Precio inválido.");

    // Precio publicado = base del creador + cargo fijo $3 (lo absorbe el comprador).
    const country = taxCountry || "MX"; // solo México por ahora
    const published = round2(base + FIXED_SERVICE_FEE_MXN);
    // 🧾 IVA 16% sobre el precio publicado (base + $3). El comprador paga el total.
    const tax = applyConsumptionTax(published, country);
    const totalMxn = round2(published + tax.taxAmount);

    const customerId = await getOrCreateStripeCustomer(uid, request.auth?.token?.email ?? null);

    const res = await stripeFetch<StripePaymentIntent>("/payment_intents", {
      method: "POST",
      idempotencyKey: crypto.randomUUID(),
      form: {
        amount: Math.round(totalMxn * 100), // centavos MXN
        currency: SETTLEMENT_CURRENCY.toLowerCase(), // MXN (solo México por ahora)
        customer: customerId,
        payment_method_types: ["card"],
        ...(saveCard ? { setup_future_usage: "off_session" } : {}),
        // El webhook usa esta metadata para materializar el saludo + ledger.
        metadata: { externalReference, sourceType: "greetingRequest", sourceId: requestId, buyerId: uid },
      },
    });
    if (!res.ok) throw new HttpsError("internal", `No se pudo crear el pago (${res.status}): ${res.error.slice(0, 200)}`);

    // Estampa el desglose en el intent. El ledger usa grossAmount (base) → creador gana 75% de la base.
    await intentRef.set(
      {
        baseAmount: base, // precio del creador (para el ledger/ganancia)
        fixedFee: FIXED_SERVICE_FEE_MXN, // $3 que absorbe el comprador
        publishedAmount: published, // base + $3
        taxAmount: tax.taxAmount, // IVA sobre (base + $3), va al SAT
        taxCountry: tax.taxCountry,
        taxRate: tax.taxRate,
        chargedAmount: totalMxn, // total que paga el comprador
        settlementCurrency: SETTLEMENT_CURRENCY,
        settlementAmount: totalMxn,
        paymentMode: "stripe",
        stripePaymentIntentId: res.data.id,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return { clientSecret: res.data.client_secret };
  }
);
