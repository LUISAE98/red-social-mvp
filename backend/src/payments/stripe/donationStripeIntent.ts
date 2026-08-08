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
import { isChargeableCountry } from "../../tax/config";
import { resolveTaxCountry } from "../../tax/resolveCountry";
import { composeCharge, chargeFields } from "../../tax/composeCharge";
import { reserveCreditAndSplit, materializeCreditOnlyPurchase } from "./chargeWithCredit";
import { revertBuyerCreditSpend } from "../../wallet/buyerCredit";

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
    // El comprador pidió aplicar su SALDO A FAVOR. El monto exacto lo decide el servidor
    // (min(saldo, total)); si cubre todo, no se cobra tarjeta.
    const applyCredit = data.applyCredit === true;
    const groupId = typeof data.groupId === "string" && data.groupId.trim() ? data.groupId.trim() : null;
    const groupName = typeof data.groupName === "string" && data.groupName.trim() ? data.groupName.trim() : null;
    // Apodo del donador (invitado sin login o usuario con sesión). Se guarda con la
    // donación para mostrar quién contribuyó. Opcional; se recorta a 24.
    const nickname = typeof data.nickname === "string" && data.nickname.trim() ? data.nickname.trim().slice(0, 24) : null;

    // País fiscal: lo decide el SERVIDOR con la IP del request, nunca el payload del cliente.
    // Antes llegaba en `data.taxCountry`; eso era inofensivo solo mientras México fuera el único
    // país configurado. Con un segundo país en la tabla —y más si su impuesto es 0— un comprador
    // mexicano podía mandar otro ISO y evadir el 16%. Ver impuestos.md §3.
    // TODO(fase 2): recalcular con el país emisor de la tarjeta antes de confirmar el intent.
    const resolved = await resolveTaxCountry({ rawRequest: request.rawRequest });
    const country = resolved.country;
    if (!isChargeableCountry(country)) {
      throw new HttpsError("failed-precondition", "El cobro no está disponible en tu país por ahora.");
    }
    // Composición completa (base + $3 → +2% FX → + impuesto si lo cobra Vibra). Ver impuestos.md §2.
    const charge = composeCharge(base, country);
    const totalMxn = charge.chargedAmount;

    const donationId = db.collection("profileDonations").doc().id;
    const externalReference = `profileDonation__${donationId}`;

    // Saldo a favor: reserva el crédito y calcula el RESTANTE a cobrar a la tarjeta. El
    // cargo a Stripe se hace en la moneda de presentación del RESTANTE.
    const { creditApplied, remainderMxn, presentment } = await reserveCreditAndSplit({
      uid,
      applyCredit,
      totalMxn,
      displayCurrency: charge.displayCurrency,
      sourceType: "profileDonation",
      sourceId: donationId,
    });

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
      // Desglose completo del cobro: base, cargo fijo, FX, impuesto del país y régimen del
      // IVA mexicano. Se guarda aunque la pasarela muestre un precio único sin desglosar.
      ...chargeFields(charge),
      // Saldo a favor aplicado y restante cobrado a la tarjeta (MXN).
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
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // ── El SALDO A FAVOR cubre el 100% → sin tarjeta: materializar la compra directo ──
    if (remainderMxn <= 0 || !presentment) {
      await materializeCreditOnlyPurchase(externalReference);
      return { status: "succeeded" };
    }

    const customerId = await getOrCreateStripeCustomer(uid, request.auth?.token?.email ?? null);

    // ── Cobro "un clic" con tarjeta guardada (off-session, sin CVV) — SOLO cuentas reales ──
    // Un invitado con tarjeta guardada cae al flujo on-session de abajo (confirma con CVV).
    if (savedPaymentMethodId && !isGuest) {
      let charged;
      try {
        charged = await chargeSavedCardOffSession({
          uid,
          savedCardDocId: savedPaymentMethodId,
          customerId,
          amountCents: presentment.amountForStripe,
          currency: presentment.currency,
          metadata: { externalReference, sourceType: "profileDonation", sourceId: donationId, buyerId: uid },
        });
      } catch (e) {
        // La tarjeta falló → devolver el crédito reservado (si hubo).
        if (creditApplied > 0) await revertBuyerCreditSpend(uid, { sourceType: "profileDonation", sourceId: donationId });
        throw e;
      }
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
        amount: presentment.amountForStripe,
        currency: presentment.currency.toLowerCase(),
        customer: customerId,
        payment_method_types: ["card"],
        ...(saveCard ? { setup_future_usage: "off_session" } : {}),
        metadata: { externalReference, sourceType: "profileDonation", sourceId: donationId, buyerId: uid },
      },
    });
    if (!res.ok) {
      if (creditApplied > 0) await revertBuyerCreditSpend(uid, { sourceType: "profileDonation", sourceId: donationId });
      throw new HttpsError("internal", `No se pudo crear el pago (${res.status}): ${res.error.slice(0, 200)}`);
    }

    await db.collection("paymentIntents").doc(externalReference).set(
      { stripePaymentIntentId: res.data.id, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );

    return { clientSecret: res.data.client_secret };
  }
);
