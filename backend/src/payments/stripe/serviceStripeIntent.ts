// Callable GENÉRICO para cobrar cualquier servicio "pagar-luego-crear" con Stripe.
// Reusa el paymentIntent (paymentIntents/{externalReference}) que ya creó el
// create<Servicio>Request: lee el precio del SERVIDOR, le suma IVA, y crea el
// PaymentIntent de Stripe con la metadata que el webhook necesita para materializar
// (applyApprovedPaymentToSource → reconcile). Sirve para sesión exclusiva, tiempo
// contigo (meet&greet), saludo/consejo, etc.
//
// Precio autoritativo del servidor (NO del cliente). Todo en modo prueba.

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

// Prefijos de externalReference permitidos (deben coincidir con el dispatch de reconcile).
const ALLOWED_SOURCE_TYPES = new Set([
  "greetingRequest",
  "exclusiveSessionRequest",
  "meetGreetRequest",
]);

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

type StripePaymentIntent = { id: string; client_secret: string };

export const createServiceStripeIntent = onCall(
  { region: REGION, cors: true, secrets: [stripeSecretKey] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");

    const data = (request.data ?? {}) as { externalReference?: unknown; saveCard?: unknown; taxCountry?: unknown; savedPaymentMethodId?: unknown };
    const externalReference = String(data.externalReference ?? "").trim();
    if (!externalReference) throw new HttpsError("invalid-argument", "Falta la referencia del pago.");
    const saveCard = data.saveCard === true;
    const taxCountry = data.taxCountry ? String(data.taxCountry).trim().toUpperCase() : null;
    // Si viene, el cobro es "un clic" con una tarjeta ya guardada (off-session, sin CVV).
    const savedPaymentMethodId = data.savedPaymentMethodId ? String(data.savedPaymentMethodId).trim() : null;

    const sep = externalReference.indexOf("__");
    if (sep <= 0) throw new HttpsError("invalid-argument", "Referencia inválida.");
    const sourceType = externalReference.slice(0, sep);
    const sourceId = externalReference.slice(sep + 2);
    if (!ALLOWED_SOURCE_TYPES.has(sourceType) || !sourceId) {
      throw new HttpsError("invalid-argument", "Tipo de servicio no soportado.");
    }

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
    // El país fiscal NO se confía del cliente: si manda uno sin IVA configurado (para
    // evadir el impuesto), se rechaza. Solo se cobra donde el impuesto está definido (MX).
    if (!isChargeableCountry(country)) {
      throw new HttpsError("failed-precondition", "El cobro solo está disponible en México por ahora.");
    }
    const published = round2(base + FIXED_SERVICE_FEE_MXN);
    // 🧾 IVA 16% sobre el precio publicado (base + $3). El comprador paga el total.
    const tax = applyConsumptionTax(published, country);
    const totalMxn = round2(published + tax.taxAmount);

    // Estampa el desglose en el intent (antes de cobrar). El ledger usa grossAmount (base)
    // → creador gana 75% de la base. Aplica a ambos caminos (tarjeta nueva / guardada).
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
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    const customerId = await getOrCreateStripeCustomer(uid, request.auth?.token?.email ?? null);

    // ── Cobro "un clic" con tarjeta guardada (off-session, sin CVV) ──────────
    if (savedPaymentMethodId) {
      const charged = await chargeSavedCardOffSession({
        uid,
        savedCardDocId: savedPaymentMethodId,
        customerId,
        amountCents: Math.round(totalMxn * 100),
        currency: SETTLEMENT_CURRENCY,
        metadata: { externalReference, sourceType, sourceId, buyerId: uid },
      });
      await intentRef.set(
        { stripePaymentIntentId: charged.id, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
      return { status: charged.status, clientSecret: charged.clientSecret };
    }

    // ── Tarjeta nueva: devuelve client_secret para confirmar con Elements ────
    const res = await stripeFetch<StripePaymentIntent>("/payment_intents", {
      method: "POST",
      idempotencyKey: crypto.randomUUID(),
      form: {
        amount: Math.round(totalMxn * 100), // centavos MXN
        currency: SETTLEMENT_CURRENCY.toLowerCase(), // MXN (solo México por ahora)
        customer: customerId,
        payment_method_types: ["card"],
        ...(saveCard ? { setup_future_usage: "off_session" } : {}),
        // El webhook usa el externalReference para materializar el servicio + ledger.
        metadata: { externalReference, sourceType, sourceId, buyerId: uid },
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
