// createPremiumPostStripeIntent — cobra el desbloqueo de una publicación premium / VOD con Stripe.
//
// Pagar-luego-conceder: el acceso (postAccess) aún NO existe; esta función crea el
// paymentIntents/{externalReference} con el payload pendingPostAccess y el PaymentIntent de
// Stripe. Al aprobar el pago, el webhook → reconcile materializa postAccess/{buyerId}_{postId}
// en estado "active" → dispara onPostAccessLedger (clasifica premium_post vs vod_ticket por
// post.liveData) y onPremiumUnlockCount. Modelo SOLO MÉXICO: el comprador paga (base + $3) + IVA;
// el creador recibe 75% de la base. Cubre POST premium y VOD premium (mismo camino postAccess).

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { SETTLEMENT_CURRENCY } from "../../wallet/ledger";
import * as admin from "firebase-admin";
import { stripeFetch, stripeSecretKey } from "./stripeClient";
import { getOrCreateStripeCustomer } from "./stripeCustomer";
import { chargeSavedCardOffSession } from "./offSessionCharge";
import { isChargeableCountry } from "../../tax/config";
import { resolveTaxCountry } from "../../tax/resolveCountry";
import { cardOriginForCharge } from "./cardCountry";
import { composeCharge, chargeFields } from "../../tax/composeCharge";
import { applyCharmRounding } from "../../tax/presentment";
import { reserveCreditAndSplit, materializeCreditOnlyPurchase } from "./chargeWithCredit";
import { revertBuyerCreditSpend } from "../../wallet/buyerCredit";
import { stripeIdempotencyKey } from "./idempotency";

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
    // Invitado (sesión anónima): NUNCA off-session. Con tarjeta guardada re-confirma con CVV.
    const isGuest =
      (request.auth?.token as { firebase?: { sign_in_provider?: string } } | undefined)?.firebase
        ?.sign_in_provider === "anonymous";

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

    // La base del creador se trata en MXN. Se prefiere `oneTimePrice` porque es EXACTAMENTE
    // lo que muestra el frontend (evita cobrar un `premium.price` legacy en USD divergente).
    const base = round2(Number(post.oneTimePrice ?? premium.price ?? 0));
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

    // ¿Ya pagó el TICKET del live? El live y su grabación son el mismo post
    // (`liveId == postId`): el VOD premium que nace de esa transmisión ya está
    // pagado y cobrarlo aquí sería cobrar dos veces el mismo contenido. La UI ya
    // no ofrece el botón, pero el candado tiene que vivir en el servidor.
    if (post.liveData != null) {
      const ticketSnap = await db.doc(`liveAccess/${postId}/users/${uid}`).get();
      if (ticketSnap.exists && ticketSnap.data()?.status === "paid") {
        throw new HttpsError(
          "failed-precondition",
          "Ya tienes acceso a esta transmisión con tu ticket."
        );
      }
    }

    const intentRef = db.collection("paymentIntents").doc(externalReference);
    const intentSnap = await intentRef.get();
    const existingStatus = intentSnap.exists ? intentSnap.data()?.status : null;
    if (existingStatus === "approved" || existingStatus === "paid") {
      throw new HttpsError("failed-precondition", "Ya tienes acceso a esta publicación.");
    }

    const saveCard = data.saveCard === true;
    // Si viene, el cobro es "un clic" con una tarjeta ya guardada (off-session, sin CVV).
    const savedPaymentMethodId = data.savedPaymentMethodId ? String(data.savedPaymentMethodId).trim() : null;
    const applyCredit = data.applyCredit === true; // aplicar saldo a favor (monto lo decide el server)

    // Precio publicado = base + $3 cargo fijo; IVA 16% encima (todo lo absorbe el comprador).
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
    // El total se deja en un precio comercial (.99/.00) en la moneda del comprador y el
    // desglose se despeja hacia atrás desde ahí. Ver tax/presentment.applyCharmRounding.
    const { charge, quote: fxQuote } = await applyCharmRounding(composeCharge(base, country));
    const totalMxn = charge.chargedAmount;
    // Saldo a favor: reserva el crédito y calcula el RESTANTE a cobrar a la tarjeta.
    const { creditApplied, remainderMxn, presentment } = await reserveCreditAndSplit({
      uid,
      applyCredit,
      totalMxn,
      displayCurrency: charge.displayCurrency,
      sourceType: "postAccess",
      sourceId: accessId,
    });

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
          currency: SETTLEMENT_CURRENCY,
        },
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
        // Evidencia de la cotización de Stripe: con qué tasa se calculó, cuánto cobró de
        // conversión y cuánto costó congelarla. Es el dato con el que se dimensiona el colchón
        // del 2%, que antes se llevaba a ojo.
        fxQuoteId: fxQuote?.id ?? null,
        fxQuoteBaseRate: fxQuote?.baseRate ?? null,
        fxStripeFeeRate: fxQuote?.fxFeeRate ?? null,
        fxLockPremium: fxQuote?.durationPremium ?? null,
        paymentMode: "stripe",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        ...(intentSnap.exists ? {} : { createdAt: admin.firestore.FieldValue.serverTimestamp() }),
      },
      { merge: true }
    );

    // ── El SALDO A FAVOR cubre el 100% → sin tarjeta: materializar directo ──
    if (remainderMxn <= 0 || !presentment) {
      await materializeCreditOnlyPurchase(externalReference);
      return { status: "succeeded" };
    }

    const customerId = await getOrCreateStripeCustomer(uid, request.auth?.token?.email ?? null);

    // ── Cobro "un clic" con tarjeta guardada (off-session, sin CVV) ──────────
    if (savedPaymentMethodId && !isGuest) {
      let charged;
      try {
        charged = await chargeSavedCardOffSession({
          uid,
          savedCardDocId: savedPaymentMethodId,
          customerId,
          amountCents: presentment.amountForStripe,
          currency: presentment.currency,
          metadata: { externalReference, sourceType: "postAccess", sourceId: accessId, buyerId: uid },
          fxQuoteId: fxQuote?.id ?? null,
        });
      } catch (e) {
        if (creditApplied > 0) await revertBuyerCreditSpend(uid, { sourceType: "postAccess", sourceId: accessId });
        throw e;
      }
      await intentRef.set(
        { stripePaymentIntentId: charged.id, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
      return { status: charged.status, clientSecret: charged.clientSecret };
    }

    const res = await stripeFetch<StripePaymentIntent>("/payment_intents", {
      method: "POST",
      idempotencyKey: stripeIdempotencyKey(
        externalReference,
        presentment.amountForStripe,
        presentment.currency
      ),
      form: {
        amount: presentment.amountForStripe,
        currency: presentment.currency.toLowerCase(),
        // Liquida a la tasa congelada que se usó para calcular este importe.
        ...(fxQuote ? { fx_quote: fxQuote.id } : {}),
        customer: customerId,
        payment_method_types: ["card"],
        ...(saveCard ? { setup_future_usage: "off_session" } : {}),
        metadata: { externalReference, sourceType: "postAccess", sourceId: accessId, buyerId: uid },
      },
    });
    if (!res.ok) {
      if (creditApplied > 0) await revertBuyerCreditSpend(uid, { sourceType: "postAccess", sourceId: accessId });
      throw new HttpsError("internal", `No se pudo crear el pago (${res.status}): ${res.error.slice(0, 200)}`);
    }

    await intentRef.set(
      { stripePaymentIntentId: res.data.id, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );

    return { clientSecret: res.data.client_secret };
  }
);
