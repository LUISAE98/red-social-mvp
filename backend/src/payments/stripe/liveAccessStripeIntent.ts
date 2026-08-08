// createLiveAccessStripeIntent — cobra el TICKET de acceso a un en vivo con Stripe.
//
// Pagar-luego-conceder (igual que premium/VOD y donación): el acceso aún NO existe;
// esta función crea el paymentIntents/{externalReference} con el payload pendingLiveAccess
// y el PaymentIntent de Stripe. Al aprobar el pago, el webhook → reconcile materializa
// liveAccess/{liveId}/users/{userId} con status "paid" → dispara onLiveAccessLedger.
// Modelo SOLO MÉXICO: el comprador paga (base + $3) + IVA; el creador recibe 75% de la base.

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

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

type StripePaymentIntent = { id: string; client_secret: string };

export const createLiveAccessStripeIntent = onCall(
  { region: REGION, cors: true, secrets: [stripeSecretKey] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
    // Invitado (sesión anónima): NUNCA off-session. Con tarjeta guardada re-confirma con CVV.
    const isGuest =
      (request.auth?.token as { firebase?: { sign_in_provider?: string } } | undefined)?.firebase
        ?.sign_in_provider === "anonymous";

    const data = (request.data ?? {}) as Record<string, unknown>;
    const postId = String(data.postId ?? "").trim(); // el live es un post
    if (!postId) throw new HttpsError("invalid-argument", "Falta el id del en vivo.");

    const postSnap = await db.collection("posts").doc(postId).get();
    if (!postSnap.exists) throw new HttpsError("not-found", "En vivo no encontrado.");
    const post = postSnap.data() as Record<string, unknown>;

    if (post.requiresPayment !== true) {
      throw new HttpsError("failed-precondition", "Este en vivo no requiere ticket.");
    }
    // Debe ser realmente un EN VIVO (tiene liveData). Un post premium también trae
    // requiresPayment:true; sin este guard, comprarlo por esta ruta crearía un liveAccess
    // en vez de desbloquear el contenido premium (postAccess) → cobro sin entregar acceso.
    if (post.liveData == null) {
      throw new HttpsError("failed-precondition", "Esta publicación no es un en vivo.");
    }

    const authorId = String(post.authorId ?? "");
    if (!authorId) throw new HttpsError("failed-precondition", "En vivo sin autor.");
    if (authorId === uid) throw new HttpsError("failed-precondition", "Es tu propio en vivo.");

    const liveData = (post.liveData ?? {}) as Record<string, unknown>;
    // La base del creador se trata en MXN (Mexico-only, igual que el resto de servicios).
    const base = round2(Number(post.oneTimePrice ?? liveData.ticketPrice ?? 0));
    if (!Number.isFinite(base) || base <= 0) {
      throw new HttpsError("failed-precondition", "Precio de ticket inválido.");
    }

    const groupId = post.groupId ? String(post.groupId) : null;
    const liveId = postId; // liveId = postId (así lo lee checkLiveAccess)
    const externalReference = `liveAccess__${liveId}_${uid}`;

    // ¿Ya tiene acceso? No re-cobrar.
    const accessSnap = await db.doc(`liveAccess/${liveId}/users/${uid}`).get();
    if (accessSnap.exists && accessSnap.data()?.status === "paid") {
      throw new HttpsError("failed-precondition", "Ya tienes acceso a este en vivo.");
    }

    const intentRef = db.collection("paymentIntents").doc(externalReference);
    const intentSnap = await intentRef.get();
    const existingStatus = intentSnap.exists ? intentSnap.data()?.status : null;
    if (existingStatus === "approved" || existingStatus === "paid") {
      throw new HttpsError("failed-precondition", "Ya tienes acceso a este en vivo.");
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
      throw new HttpsError("failed-precondition", "El cobro solo está disponible en México por ahora.");
    }
    // Composición completa (base + $3 → +2% FX → + impuesto si lo cobra Vibra). Ver impuestos.md §2.
    const charge = composeCharge(base, country);
    const totalMxn = charge.chargedAmount;
    // Saldo a favor: reserva el crédito y calcula el RESTANTE a cobrar a la tarjeta.
    const { creditApplied, remainderMxn, presentment } = await reserveCreditAndSplit({
      uid,
      applyCredit,
      totalMxn,
      displayCurrency: charge.displayCurrency,
      sourceType: "liveAccess",
      sourceId: `${liveId}_${uid}`,
    });

    await intentRef.set(
      {
        externalReference,
        buyerId: uid,
        grossAmount: base, // base → ledger (creador gana 75% de esto)
        sourceType: "liveAccess",
        sourceId: `${liveId}_${uid}`,
        status: "awaiting_payment",
        pendingLiveAccess: {
          liveId,
          userId: uid,
          postId,
          groupId,
          authorId,
          accessType: "live_ticket",
          amount: base,
          currency: "MXN",
          status: "paid",
          source: "stripe",
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
          metadata: { externalReference, sourceType: "liveAccess", sourceId: `${liveId}_${uid}`, buyerId: uid },
        });
      } catch (e) {
        if (creditApplied > 0) await revertBuyerCreditSpend(uid, { sourceType: "liveAccess", sourceId: `${liveId}_${uid}` });
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
      idempotencyKey: crypto.randomUUID(),
      form: {
        amount: presentment.amountForStripe,
        currency: presentment.currency.toLowerCase(),
        customer: customerId,
        payment_method_types: ["card"],
        ...(saveCard ? { setup_future_usage: "off_session" } : {}),
        metadata: { externalReference, sourceType: "liveAccess", sourceId: `${liveId}_${uid}`, buyerId: uid },
      },
    });
    if (!res.ok) {
      if (creditApplied > 0) await revertBuyerCreditSpend(uid, { sourceType: "liveAccess", sourceId: `${liveId}_${uid}` });
      throw new HttpsError("internal", `No se pudo crear el pago (${res.status}): ${res.error.slice(0, 200)}`);
    }

    await intentRef.set(
      { stripePaymentIntentId: res.data.id, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );

    return { clientSecret: res.data.client_secret };
  }
);
