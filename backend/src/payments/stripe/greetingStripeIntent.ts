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
import { cardOriginForCharge } from "./cardCountry";
import { composeCharge, chargeFields } from "../../tax/composeCharge";
import { reserveCreditAndSplit, materializeCreditOnlyPurchase } from "./chargeWithCredit";
import { revertBuyerCreditSpend } from "../../wallet/buyerCredit";

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
    const applyCredit = (data as { applyCredit?: unknown }).applyCredit === true; // aplicar saldo a favor

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
    // País fiscal: lo decide el SERVIDOR. Dos señales que el cliente no controla:
    //   · la IP del request
    //   · el país EMISOR de la tarjeta, leído de Stripe con el `pm_...` que manda el
    //     frontend. El cliente envía un identificador, no un país: no puede mentir.
    // Gana la tarjeta, salvo que algún indicio apunte a México (Art. 18-C). Ver impuestos.md §3.
    const origin = await cardOriginForCharge({
      uid,
      paymentMethodId:
        typeof (request.data as Record<string, unknown>)?.paymentMethodId === "string"
          ? String((request.data as Record<string, unknown>).paymentMethodId)
          : null,
      // Tarjeta guardada: se resuelve su `pm_...` para leer también su país emisor.
      savedCardDocId: savedPaymentMethodId,
    });
    const resolved = await resolveTaxCountry({
      rawRequest: request.rawRequest,
      cardCountry: origin.cardCountry,
      billingCountry: origin.billingCountry,
    });
    const country = resolved.country;
    // El país fiscal NO se confía del cliente: si manda uno sin IVA configurado (para
    // evadir el impuesto), se rechaza. Solo se cobra donde el impuesto está definido (MX).
    if (!isChargeableCountry(country)) {
      throw new HttpsError("failed-precondition", "El cobro no está disponible en tu país por ahora.");
    }
    // Composición completa (base + $3 → +2% FX → + impuesto si lo cobra Vibra). Ver impuestos.md §2.
    const charge = composeCharge(base, country);
    const totalMxn = charge.chargedAmount;

    // Saldo a favor: reserva el crédito y calcula el RESTANTE a cobrar a la tarjeta (hold).
    const { creditApplied, remainderMxn, presentment } = await reserveCreditAndSplit({
      uid,
      applyCredit,
      totalMxn,
      displayCurrency: charge.displayCurrency,
      sourceType: "greetingRequest",
      sourceId: requestId,
    });

    // Estampa el desglose en el intent (antes de cobrar). El ledger usa grossAmount (base)
    // → creador gana 75% de la base. Aplica a ambos caminos (tarjeta nueva / guardada).
    await intentRef.set(
      {
        // Desglose completo del cobro: base, cargo fijo, FX, impuesto del país y régimen del
        // IVA mexicano. Se guarda aunque la pasarela muestre un precio único sin desglosar.
        ...chargeFields(charge),
        creditApplied,
        cardChargedMxn: remainderMxn,
        // Moneda y monto REALES del cargo a la tarjeta (el RESTANTE tras el crédito).
        presentmentCurrency: presentment?.currency ?? charge.settlementCurrency,
        presentmentAmount: presentment?.amount ?? 0,
        // Evidencia de cómo se determinó el país fiscal (indicios del Art. 18-C).
        taxCountrySource: resolved.source,
        taxCountryIndicios: resolved.indicios,
        taxCountryHadConflict: resolved.hadConflict,
        // Evidencia de ubicación (Art. 24b UE): qué indicios coinciden y si se llega a
        // las DOS pruebas no contradictorias. Obligatorio arriba de 100k EUR de ventas UE.
        taxCountryAgreeingIndicios: resolved.agreeingIndicios,
        taxCountryMeetsTwoEvidenceRule: resolved.meetsTwoEvidenceRule,
        taxCountryConflictResolvedBy: resolved.conflictResolvedBy,
        paymentMode: "stripe",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    // ── El SALDO A FAVOR cubre el 100% → sin tarjeta ni hold: se materializa PAGADO ──
    // (el crédito ya es dinero de Vibra; no hay retención que capturar después).
    if (remainderMxn <= 0 || !presentment) {
      await materializeCreditOnlyPurchase(externalReference);
      return { status: "succeeded" };
    }

    const customerId = await getOrCreateStripeCustomer(uid, request.auth?.token?.email ?? null);

    // ── Cobro "un clic" con tarjeta guardada (off-session, sin CVV) ──────────
    if (savedPaymentMethodId) {
      let charged;
      try {
        charged = await chargeSavedCardOffSession({
          uid,
          savedCardDocId: savedPaymentMethodId,
          customerId,
          amountCents: presentment.amountForStripe,
          currency: presentment.currency,
          metadata: { externalReference, sourceType: "greetingRequest", sourceId: requestId, buyerId: uid },
          captureMethod: "manual", // AUTORIZAR (hold): se captura al grabar el saludo
        });
      } catch (e) {
        if (creditApplied > 0) await revertBuyerCreditSpend(uid, { sourceType: "greetingRequest", sourceId: requestId });
        throw e;
      }
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
        amount: presentment.amountForStripe,
        currency: presentment.currency.toLowerCase(),
        customer: customerId,
        payment_method_types: ["card"],
        capture_method: "manual", // AUTORIZAR (hold): se captura al grabar el saludo
        ...(saveCard ? { setup_future_usage: "off_session" } : {}),
        // El webhook usa esta metadata para materializar el saludo + ledger.
        metadata: { externalReference, sourceType: "greetingRequest", sourceId: requestId, buyerId: uid },
      },
    });
    if (!res.ok) {
      if (creditApplied > 0) await revertBuyerCreditSpend(uid, { sourceType: "greetingRequest", sourceId: requestId });
      throw new HttpsError("internal", `No se pudo crear el pago (${res.status}): ${res.error.slice(0, 200)}`);
    }

    await intentRef.set(
      { stripePaymentIntentId: res.data.id, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );

    return { clientSecret: res.data.client_secret };
  }
);
