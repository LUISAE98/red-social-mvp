// createLiveDonationStripeIntent — cobra una donación en un EN VIVO con Stripe.
//
// Pagar-luego-crear (monto DINÁMICO): la donación se materializa como un super-comentario
// SIN texto en posts/{postId}/superComments/{donationId} al aprobar el pago (webhook →
// reconcile), lo que dispara onSuperCommentLedger (earning `live_donation`) Y la muestra
// destacada en el chat del live. Modelo SOLO MÉXICO: el donante paga (base + $3) + IVA;
// el creador recibe 75% de la base. Cada llamada = una donación nueva.

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
const MAX_DONATION = 100000; // tope de seguridad
const DONATION_COLOR = "#3b82f6"; // anillo del avatar en el chat (igual que el flujo MP)
const DONATION_DISPLAY_SECS = 15;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

type StripePaymentIntent = { id: string; client_secret: string };

export const createLiveDonationStripeIntent = onCall(
  { region: REGION, cors: true, secrets: [stripeSecretKey] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
    // Invitado (sesión anónima): NUNCA off-session; con tarjeta guardada re-pide CVV.
    const isGuest =
      (request.auth?.token as { firebase?: { sign_in_provider?: string } } | undefined)?.firebase
        ?.sign_in_provider === "anonymous";

    const data = (request.data ?? {}) as Record<string, unknown>;
    const postId = String(data.postId ?? "").trim(); // el live es un post
    if (!postId) throw new HttpsError("invalid-argument", "Falta el id del en vivo.");

    // `amount` = BASE del creador (MXN). El $3 y el IVA se suman aquí.
    const base = round2(Number(data.amount));
    if (!Number.isFinite(base) || base <= 0) {
      throw new HttpsError("invalid-argument", "Monto de la donación inválido.");
    }
    if (base > MAX_DONATION) {
      throw new HttpsError("invalid-argument", "El monto de la donación es demasiado alto.");
    }

    const postSnap = await db.collection("posts").doc(postId).get();
    if (!postSnap.exists) throw new HttpsError("not-found", "En vivo no encontrado.");
    const post = postSnap.data() as Record<string, unknown>;

    if (!post.liveData && post.postType !== "live") {
      throw new HttpsError("failed-precondition", "Esta publicación no es un en vivo.");
    }

    const authorId = String(post.authorId ?? "");
    if (!authorId) throw new HttpsError("failed-precondition", "En vivo sin autor.");
    if (authorId === uid) throw new HttpsError("failed-precondition", "No puedes donarte a ti mismo.");

    // Sanciones: un usuario silenciado/baneado NO puede donar, aunque las donaciones
    // estén abiertas a no-miembros. Se revisa el mute/ban del live y del grupo dueño.
    const liveData = (post.liveData ?? {}) as Record<string, unknown>;
    const mutedInLive = Array.isArray(liveData.mutedUsers) && (liveData.mutedUsers as unknown[]).includes(uid);
    const bannedInLive = Array.isArray(liveData.bannedUsers) && (liveData.bannedUsers as unknown[]).includes(uid);
    if (mutedInLive || bannedInLive) {
      throw new HttpsError("permission-denied", "Estás silenciado o bloqueado en este en vivo.");
    }
    const liveGroupId = post.groupId ? String(post.groupId) : "";
    if (liveGroupId) {
      const memberSnap = await db.doc(`groups/${liveGroupId}/members/${uid}`).get();
      if (memberSnap.exists) {
        const md = memberSnap.data() as Record<string, unknown>;
        const mutedUntilMs =
          md.mutedUntil && typeof (md.mutedUntil as { toMillis?: () => number }).toMillis === "function"
            ? (md.mutedUntil as { toMillis: () => number }).toMillis()
            : null;
        const effectivelyMuted = md.status === "muted" && (mutedUntilMs === null || mutedUntilMs > Date.now());
        if (md.status === "banned" || effectivelyMuted) {
          throw new HttpsError("permission-denied", "Estás silenciado o baneado en esta comunidad.");
        }
      }
    }

    // Perfil del donante (para el super-comentario destacado del chat).
    let username = "Anónimo";
    let avatarUrl: string | null = null;
    const userSnap = await db.collection("users").doc(uid).get();
    if (userSnap.exists) {
      const u = userSnap.data() as Record<string, unknown>;
      username = String(u.displayName ?? u.handle ?? u.username ?? "Anónimo");
      avatarUrl = u.photoURL ? String(u.photoURL) : null;
    }
    // Apodo del cliente (invitado sin perfil, o quien quiera firmar distinto): manda en el
    // chat sobre el perfil. Opcional; se recorta a 24.
    const nickname = typeof data.nickname === "string" && data.nickname.trim() ? data.nickname.trim().slice(0, 24) : null;
    if (nickname) username = nickname;

    const saveCard = data.saveCard === true;
    // Si viene, el cobro es "un clic" con una tarjeta ya guardada (off-session, sin CVV).
    const savedPaymentMethodId = data.savedPaymentMethodId ? String(data.savedPaymentMethodId).trim() : null;
    const applyCredit = data.applyCredit === true; // aplicar saldo a favor (monto lo decide el server)

    // Precio publicado = base + $3; IVA 16% encima (todo lo absorbe el donante).
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

    // Id único por donación (es el id del super-comentario que se materializará).
    const donationId = db.collection("posts").doc(postId).collection("superComments").doc().id;
    const externalReference = `liveDonation__${postId}_${donationId}`;

    // Saldo a favor: reserva el crédito y calcula el RESTANTE a cobrar a la tarjeta.
    const { creditApplied, remainderMxn, presentment } = await reserveCreditAndSplit({
      uid,
      applyCredit,
      totalMxn,
      displayCurrency: charge.displayCurrency,
      sourceType: "liveDonation",
      sourceId: `${postId}_${donationId}`,
    });

    await db.collection("paymentIntents").doc(externalReference).set({
      externalReference,
      buyerId: uid,
      grossAmount: base, // base → ledger (creador gana 75% de esto)
      sourceType: "liveDonation",
      sourceId: `${postId}_${donationId}`,
      status: "awaiting_payment",
      // Payload = super-comentario SIN texto → onSuperCommentLedger lo cuenta como live_donation.
      // `status: "paid"` es OBLIGATORIO (el trigger filtra por él).
      pendingLiveDonation: {
        userId: uid,
        username,
        avatarUrl,
        text: "",
        tierId: "donation",
        tierName: "Donación",
        color: DONATION_COLOR,
        displaySeconds: DONATION_DISPLAY_SECS,
        amount: base,
        currency: "MXN",
        status: "paid",
        hidden: false,
        isDeleted: false,
        played: false,
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
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // ── El SALDO A FAVOR cubre el 100% → sin tarjeta: materializar directo ──
    if (remainderMxn <= 0 || !presentment) {
      await materializeCreditOnlyPurchase(externalReference);
      return { status: "succeeded" };
    }

    const customerId = await getOrCreateStripeCustomer(uid, request.auth?.token?.email ?? null);

    // ── Cobro "un clic" off-session (sin CVV) — SOLO cuentas reales; invitado re-pide CVV ──
    if (savedPaymentMethodId && !isGuest) {
      let charged;
      try {
        charged = await chargeSavedCardOffSession({
          uid,
          savedCardDocId: savedPaymentMethodId,
          customerId,
          amountCents: presentment.amountForStripe,
          currency: presentment.currency,
          metadata: { externalReference, sourceType: "liveDonation", sourceId: `${postId}_${donationId}`, buyerId: uid },
        });
      } catch (e) {
        if (creditApplied > 0) await revertBuyerCreditSpend(uid, { sourceType: "liveDonation", sourceId: `${postId}_${donationId}` });
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
        metadata: { externalReference, sourceType: "liveDonation", sourceId: `${postId}_${donationId}`, buyerId: uid },
      },
    });
    if (!res.ok) {
      if (creditApplied > 0) await revertBuyerCreditSpend(uid, { sourceType: "liveDonation", sourceId: `${postId}_${donationId}` });
      throw new HttpsError("internal", `No se pudo crear el pago (${res.status}): ${res.error.slice(0, 200)}`);
    }

    await db.collection("paymentIntents").doc(externalReference).set(
      { stripePaymentIntentId: res.data.id, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );

    return { clientSecret: res.data.client_secret };
  }
);
