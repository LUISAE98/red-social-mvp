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
import { getExistingStripeCustomerId } from "./stripeCustomer";
import { isChargeableCountry } from "../../tax/config";
import { resolveTaxCountry } from "../../tax/resolveCountry";
import { composeCharge, chargeFields } from "../../tax/composeCharge";
import { resolvePresentment, applyCharmRounding } from "../../tax/presentment";
import { SETTLEMENT_CURRENCY } from "../../wallet/ledger";
import type { LedgerServiceType } from "../../wallet/ledger";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();
const REGION = "us-central1";

type StripePaymentMethod = {
  id: string;
  /** Cliente de Stripe al que está adjunta. `null` si todavía no se adjuntó a ninguno. */
  customer?: string | null;
  card?: { country?: string | null } | null;
  billing_details?: { address?: { country?: string | null } | null } | null;
};

type StripePaymentIntent = {
  id: string;
  status: string;
  amount: number;
  capture_method?: string;
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

    // Tipo de servicio, que decide el tratamiento de exportación del IVA mexicano.
    const tipoServicio = (intent.serviceType ?? null) as LedgerServiceType | null;

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
    // ⚠️ La tarjeta tiene que ser de QUIEN PIDE. `/payment_methods/{id}` devuelve
    // cualquier método visible para la cuenta de Stripe de Vibra, no solo los del
    // comprador, así que sin esta comprobación se podía pasar el `pm_...` de otra
    // persona para que el país —y con él el impuesto— saliera distinto del de la
    // tarjeta con la que luego se confirma el pago. Determinar el impuesto con
    // una tarjeta y pagar con otra.
    //
    // Una tarjeta recién tecleada todavía NO está adjunta a ningún cliente
    // (`customer: null`), y ese es el caso normal al pagar con tarjeta nueva: se
    // acepta, porque para conocer su id hay que haberla creado uno mismo en el
    // navegador. Lo que se rechaza es una tarjeta adjunta a OTRO cliente.
    const pmCustomer = pmRes.data.customer ?? null;
    if (pmCustomer) {
      const buyerCustomerId = await getExistingStripeCustomerId(uid);
      if (pmCustomer !== buyerCustomerId) {
        logger.warn("reprice_payment_method_ajeno", { uid, externalReference, pmCustomer });
        throw new HttpsError("permission-denied", "Ese método de pago no es tuyo.");
      }
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

    // El total se deja en un precio comercial (.99/.00) en la moneda del comprador y el
    // desglose se despeja hacia atrás desde ahí. Ver tax/presentment.applyCharmRounding.
    // El re-cálculo con el país de la tarjeta tiene que usar el MISMO servicio que el cobro
    // original, o el tratamiento de exportación podría salir distinto entre los dos.
    const { charge, quote: fxQuote, displayAmount } = await applyCharmRounding(
      composeCharge(base, resolved.country, { serviceType: tipoServicio })
    );
    // La moneda de cobro también puede cambiar: si la IP decía Alemania y la tarjeta resulta
    // mexicana, se pasa de cobrar en EUR a cobrar en MXN.
    // El total íntegro: se cobra EXACTAMENTE el precio comercial que ve el comprador.
    const presentment = await resolvePresentment(charge.chargedAmount, charge.displayCurrency, displayAmount);

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
          // Liquida a la tasa congelada que se usó para calcular este importe.
          // ⚠️ Salvo en una RETENCIÓN: Stripe no admite tasa fijada con captura manual.
          // Aquí se comprueba a mano porque esta llamada ACTUALIZA un intent ya creado y no
          // manda `capture_method`, así que el guardia central de `stripeFetch` no la ve.
          // El dato sale del propio intent, que se acaba de leer arriba.
          ...(fxQuote && piRes.data.capture_method !== "manual" ? { fx_quote: fxQuote.id } : {}),
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
    // Desglose EN LA MONEDA DEL COMPRADOR, que es lo único que la pasarela puede pintar.
    // `chargedAmount` va en la de liquidación (USD) y no sirve para enseñarlo. El total es
    // el precio comercial ya redondeado; el subtotal y el impuesto se despejan HACIA ATRÁS
    // desde él, igual que en `recomposeWithCharged`, para que las tres cifras sumen exacto.
    const totalMostrado = displayAmount ?? presentment.amount;
    const tasa = charge.buyerTax.collectedByPlatform ? charge.buyerTax.rate : 0;
    const subtotalMostrado = Math.round((totalMostrado / (1 + tasa)) * 100) / 100;

    return {
      changed,
      country: resolved.country,
      chargedAmount: charge.chargedAmount,
      displayCurrency: charge.displayCurrency,
      settlementCurrency: charge.settlementCurrency,
      /** Lo que se le enseña al comprador, en su moneda. Las tres cifras cuadran entre sí. */
      display: {
        currency: presentment.currency,
        subtotal: subtotalMostrado,
        tax: Math.round((totalMostrado - subtotalMostrado) * 100) / 100,
        total: totalMostrado,
        taxName: charge.buyerTax.name,
        taxRate: tasa,
      },
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
