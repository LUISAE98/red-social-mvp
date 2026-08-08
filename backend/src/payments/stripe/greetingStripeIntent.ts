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
import { chargeSavedCardOffSession } from "./offSessionCharge";
import { isChargeableCountry } from "../../tax/config";
import { resolveTaxCountry } from "../../tax/resolveCountry";
import { composeCharge, chargeFields } from "../../tax/composeCharge";
import { SETTLEMENT_CURRENCY } from "../../wallet/ledger";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();
const REGION = "us-central1";


type StripePaymentIntent = { id: string; client_secret: string };

export const createGreetingStripeIntent = onCall(
  { region: REGION, cors: true, secrets: [stripeSecretKey] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");

    const data = (request.data ?? {}) as { greetingRequestId?: unknown; saveCard?: unknown; taxCountry?: unknown; savedPaymentMethodId?: unknown };
    const requestId = String(data.greetingRequestId ?? "").trim();
    if (!requestId) throw new HttpsError("invalid-argument", "Falta el id de la solicitud.");
    const saveCard = data.saveCard === true;
    // Si viene, el cobro es "un clic" con una tarjeta ya guardada (off-session, sin CVV).
    const savedPaymentMethodId = data.savedPaymentMethodId ? String(data.savedPaymentMethodId).trim() : null;

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
    // País fiscal: lo decide el SERVIDOR con la IP del request, nunca el payload del cliente.
    // Con un segundo país en la tabla (y más si su impuesto es 0) el cliente podía mandar otro
    // ISO y evadir el 16% mexicano. Ver impuestos.md §3.
    // TODO(fase 2): recalcular con el país emisor de la tarjeta antes de confirmar el intent.
    const resolved = await resolveTaxCountry({ rawRequest: request.rawRequest });
    const country = resolved.country;
    // El país fiscal NO se confía del cliente: si manda uno sin IVA configurado (para
    // evadir el impuesto), se rechaza. Solo se cobra donde el impuesto está definido (MX).
    if (!isChargeableCountry(country)) {
      throw new HttpsError("failed-precondition", "El cobro solo está disponible en México por ahora.");
    }
    // Composición completa (base + $3 → +2% FX → + impuesto si lo cobra Vibra). Ver impuestos.md §2.
    const charge = composeCharge(base, country);
    const totalMxn = charge.chargedAmount;

    // Estampa el desglose en el intent (antes de cobrar). El ledger usa grossAmount (base)
    // → creador gana 75% de la base. Aplica a ambos caminos (tarjeta nueva / guardada).
    await intentRef.set(
      {
        // Desglose completo del cobro: base, cargo fijo, FX, impuesto del país y régimen del
        // IVA mexicano. Se guarda aunque la pasarela muestre un precio único sin desglosar.
        ...chargeFields(charge),
        // Evidencia de cómo se determinó el país fiscal (indicios del Art. 18-C).
        taxCountrySource: resolved.source,
        taxCountryIndicios: resolved.indicios,
        taxCountryHadConflict: resolved.hadConflict,
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
        metadata: { externalReference, sourceType: "greetingRequest", sourceId: requestId, buyerId: uid },
        captureMethod: "manual", // AUTORIZAR (hold): se captura al aceptar el creador
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
        capture_method: "manual", // AUTORIZAR (hold): se captura al aceptar el creador
        ...(saveCard ? { setup_future_usage: "off_session" } : {}),
        // El webhook usa esta metadata para materializar el saludo + ledger.
        metadata: { externalReference, sourceType: "greetingRequest", sourceId: requestId, buyerId: uid },
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
