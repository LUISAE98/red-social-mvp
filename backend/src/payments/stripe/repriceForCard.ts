// repriceStripeIntentForCard — FASE 2 de la determinación del país fiscal.
//
// EL PROBLEMA DE LOS DOS MOMENTOS
// El precio se muestra ANTES de conocer la tarjeta, pero el país emisor de la tarjeta (BIN) es
// el indicio más fuerte del Art. 18-C y solo se conoce AL PAGAR. Por eso el cobro tiene dos fases:
//
//   Fase 1 (crear intent) → país por IP           → precio ESTIMADO, ya escrito en el intent
//   Fase 2 (este archivo) → país por IP + tarjeta → precio AUTORITATIVO, se corrige si cambió
//
// Ejemplo: IP extranjera + tarjeta mexicana. En fase 1 se cotizó con el impuesto de ese país y
// con 2% de conversión. Al leer la tarjeta resulta mexicana → el servicio se aprovecha en México
// → hay que cobrar (base+$3)×1.16 y QUITAR el 2%, porque ya no hay conversión de moneda.
//
// El monto se actualiza en el PaymentIntent de Stripe ANTES de confirmar. Stripe permite
// cambiar `amount` mientras el intent siga en `requires_payment_method` / `requires_confirmation`.
//
// Reglas y justificación: `impuestos.md` §3.4.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import { stripeFetch, stripeSecretKey } from "./stripeClient";
import { isChargeableCountry } from "../../tax/config";
import { resolveTaxCountry } from "../../tax/resolveCountry";
import { composeCharge, chargeFields } from "../../tax/composeCharge";
import { resolvePresentment } from "../../tax/presentment";
import { SETTLEMENT_CURRENCY } from "../../wallet/ledger";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();
const REGION = "us-central1";

type StripePaymentMethod = {
  id: string;
  card?: { country?: string | null } | null;
  billing_details?: { address?: { country?: string | null } | null } | null;
};

type StripePaymentIntent = {
  id: string;
  status: string;
  amount: number;
};

/** Estados en los que Stripe todavía permite cambiar el monto del intent. */
const REPRICEABLE_STATUSES = new Set(["requires_payment_method", "requires_confirmation"]);

export const repriceStripeIntentForCard = onCall(
  { region: REGION, secrets: [stripeSecretKey], cors: true },
  async (request) => {
    const uid = request.auth?.uid ?? null;
    if (!uid) throw new HttpsError("unauthenticated", "Necesitas iniciar sesión.");

    const data = (request.data ?? {}) as {
      externalReference?: unknown;
      paymentMethodId?: unknown;
    };

    const externalReference = String(data.externalReference ?? "").trim();
    const paymentMethodId = String(data.paymentMethodId ?? "").trim();
    if (!externalReference) throw new HttpsError("invalid-argument", "Falta la referencia del pago.");
    if (!paymentMethodId) throw new HttpsError("invalid-argument", "Falta el método de pago.");

    const intentRef = db.collection("paymentIntents").doc(externalReference);
    const snap = await intentRef.get();
    if (!snap.exists) throw new HttpsError("not-found", "El pago no existe.");

    const intent = snap.data() ?? {};

    // Solo el comprador dueño del intent puede re-cotizarlo.
    if (intent.buyerId !== uid) {
      throw new HttpsError("permission-denied", "Este pago no es tuyo.");
    }
    // Un intent ya pagado o materializado no se re-cotiza: el monto quedó congelado.
    if (intent.status !== "awaiting_payment") {
      throw new HttpsError("failed-precondition", "Este pago ya no se puede modificar.");
    }

    const base = Number(intent.baseAmount);
    if (!Number.isFinite(base) || base <= 0) {
      throw new HttpsError("failed-precondition", "El pago no tiene un monto base válido.");
    }

    // ── País emisor de la tarjeta (el indicio fuerte del Art. 18-C) ──
    const pmRes = await stripeFetch<StripePaymentMethod>(`/payment_methods/${paymentMethodId}`);
    if (!pmRes.ok) {
      throw new HttpsError("internal", `No se pudo leer el método de pago (${pmRes.status}).`);
    }
    const cardCountry = pmRes.data.card?.country ?? null;
    const billingCountry = pmRes.data.billing_details?.address?.country ?? null;

    // ── Re-resolver con IP + tarjeta y recomponer ──
    const resolved = await resolveTaxCountry({
      rawRequest: request.rawRequest,
      cardCountry,
      billingCountry,
    });

    if (!isChargeableCountry(resolved.country)) {
      throw new HttpsError(
        "failed-precondition",
        "No podemos cobrar con una tarjeta de ese país por ahora."
      );
    }

    const charge = composeCharge(base, resolved.country);
    // La moneda de cobro también puede cambiar: si la IP decía Alemania y la tarjeta resulta
    // mexicana, se pasa de cobrar en EUR a cobrar en MXN.
    const presentment = await resolvePresentment(charge.chargedAmount, charge.displayCurrency);

    const previousCharged = Number(intent.chargedAmount) || 0;
    const previousCurrency = String(intent.presentmentCurrency ?? SETTLEMENT_CURRENCY);
    const changed =
      Math.round(charge.chargedAmount * 100) !== Math.round(previousCharged * 100) ||
      presentment.currency !== previousCurrency;

    // ── Si el total cambió, corregirlo en Stripe ANTES de confirmar ──
    const stripePaymentIntentId = String(intent.stripePaymentIntentId ?? "").trim();
    if (changed && stripePaymentIntentId) {
      const piRes = await stripeFetch<StripePaymentIntent>(
        `/payment_intents/${stripePaymentIntentId}`
      );
      if (!piRes.ok) {
        throw new HttpsError("internal", `No se pudo leer el pago en Stripe (${piRes.status}).`);
      }
      if (!REPRICEABLE_STATUSES.has(piRes.data.status)) {
        // Ya se confirmó o está en proceso: no se toca el monto. Se deja constancia y se
        // devuelve el desglose vigente para que la UI no muestre un total que no se cobró.
        logger.warn("repriceStripeIntentForCard: intent no modificable", {
          externalReference,
          stripeStatus: piRes.data.status,
        });
        throw new HttpsError("failed-precondition", "El pago ya está en proceso.");
      }

      const updateRes = await stripeFetch(`/payment_intents/${stripePaymentIntentId}`, {
        method: "POST",
        form: {
          amount: presentment.amountForStripe,
          currency: presentment.currency.toLowerCase(),
        },
      });
      if (!updateRes.ok) {
        throw new HttpsError("internal", `No se pudo actualizar el pago (${updateRes.status}).`);
      }
    }

    // ── Persistir el desglose autoritativo + la evidencia ──
    await intentRef.set(
      {
        ...chargeFields(charge),
        presentmentCurrency: presentment.currency,
        presentmentAmount: presentment.amount,
        taxCountrySource: resolved.source,
        taxCountryIndicios: resolved.indicios,
        taxCountryHadConflict: resolved.hadConflict,
        // Evidencia de ubicación (Art. 24b UE): qué indicios coinciden y si se llega a
        // las DOS pruebas no contradictorias. Obligatorio arriba de 100k EUR de ventas UE.
        taxCountryAgreeingIndicios: resolved.agreeingIndicios,
        taxCountryMeetsTwoEvidenceRule: resolved.meetsTwoEvidenceRule,
        taxCountryConflictResolvedBy: resolved.conflictResolvedBy,
        // Rastro de la corrección: qué se había estimado por IP y qué se cobró de verdad.
        repricedFromAmount: changed ? previousCharged : null,
        repricedAt: changed ? admin.firestore.FieldValue.serverTimestamp() : null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    if (changed) {
      logger.info("repriceStripeIntentForCard: monto corregido por país de la tarjeta", {
        externalReference,
        from: previousCharged,
        to: charge.chargedAmount,
        country: resolved.country,
        source: resolved.source,
      });
    }

    // La UI usa esto para actualizar el monto en pantalla (sin avisar del cambio: el usuario
    // ve el total vigente antes de dar pagar). Ver impuestos.md §1.
    return {
      changed,
      country: resolved.country,
      chargedAmount: charge.chargedAmount,
      displayCurrency: charge.displayCurrency,
      settlementCurrency: charge.settlementCurrency,
      breakdown: {
        baseAmount: charge.baseAmount,
        fixedFee: charge.fixedFee,
        fxFeeRate: charge.fxFeeRate,
        fxFeeAmount: charge.fxFeeAmount,
        taxName: charge.buyerTax.name,
        taxRate: charge.buyerTax.rate,
        taxAmount: charge.buyerTax.amount,
        taxCollectedByPlatform: charge.buyerTax.collectedByPlatform,
      },
    };
  }
);
