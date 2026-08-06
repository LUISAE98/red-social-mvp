// createSuperCommentStripeIntent — cobra un súper comentario en un EN VIVO con Stripe.
//
// Pagar-luego-crear: se materializa como super-comentario CON texto en
// posts/{postId}/superComments/{scId} al aprobar el pago (webhook → reconcile), lo que
// dispara onSuperCommentLedger (earning `supercomment`) Y lo muestra destacado en el chat.
// El monto es FIJO = precio del tier, resuelto SERVER-SIDE contra la config del live
// (nunca se confía en el precio del cliente). Modelo SOLO MÉXICO: el fan paga
// (base + $3) + IVA; el creador recibe 75% de la base. Cada llamada = un súper comentario.

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
const MAX_SUPER_COMMENT = 100000; // tope de seguridad

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Fallback si el live no trae config (espejo de DEFAULT_SUPER_COMMENT_TIERS). El precio
// SIEMPRE sale de aquí o de la config guardada, NUNCA del cliente.
type Tier = { id: string; name: string; maxChars: number; price: number; color: string; displaySeconds: number };
const DEFAULT_TIERS: Tier[] = [
  { id: "t1", name: "Chispa",    maxChars: 60,  price: 25,  color: "#a855f7", displaySeconds: 10 },
  { id: "t2", name: "Llama",     maxChars: 140, price: 45,  color: "#f72fbe", displaySeconds: 15 },
  { id: "t3", name: "Fuego",     maxChars: 220, price: 85,  color: "#3b82f6", displaySeconds: 20 },
  { id: "t4", name: "Explosión", maxChars: 300, price: 215, color: "#facc15", displaySeconds: 25 },
  { id: "t5", name: "Volcán",    maxChars: 380, price: 430, color: "#4ade80", displaySeconds: 30 },
];

function resolveTier(post: Record<string, unknown>, tierId: string): Tier | null {
  const liveData = (post.liveData ?? {}) as Record<string, unknown>;
  const config = (liveData.superCommentConfig ?? {}) as Record<string, unknown>;
  const rawTiers = Array.isArray(config.tiers) && config.tiers.length
    ? (config.tiers as unknown[])
    : DEFAULT_TIERS;
  const found = rawTiers.find(
    (t) => t && typeof t === "object" && (t as Record<string, unknown>).id === tierId
  ) as Record<string, unknown> | undefined;
  if (!found) return null;
  const price = Number(found.price);
  if (!Number.isFinite(price) || price <= 0) return null;
  return {
    id: String(found.id),
    name: String(found.name ?? "Supercomentario"),
    maxChars: Number(found.maxChars) > 0 ? Number(found.maxChars) : 600,
    price,
    color: String(found.color ?? "#a855f7"),
    displaySeconds: Number(found.displaySeconds) > 0 ? Number(found.displaySeconds) : 15,
  };
}

type StripePaymentIntent = { id: string; client_secret: string; status?: string };

export const createSuperCommentStripeIntent = onCall(
  { region: REGION, cors: true, secrets: [stripeSecretKey] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");

    const data = (request.data ?? {}) as Record<string, unknown>;
    const postId = String(data.postId ?? "").trim(); // el live es un post
    if (!postId) throw new HttpsError("invalid-argument", "Falta el id del en vivo.");

    const tierId = String(data.tierId ?? "").trim();
    if (!tierId) throw new HttpsError("invalid-argument", "Falta el nivel del supercomentario.");

    const text = String(data.text ?? "").trim();
    if (!text) throw new HttpsError("invalid-argument", "El supercomentario no puede ir vacío.");

    const postSnap = await db.collection("posts").doc(postId).get();
    if (!postSnap.exists) throw new HttpsError("not-found", "En vivo no encontrado.");
    const post = postSnap.data() as Record<string, unknown>;

    if (!post.liveData && post.postType !== "live") {
      throw new HttpsError("failed-precondition", "Esta publicación no es un en vivo.");
    }

    const authorId = String(post.authorId ?? "");
    if (!authorId) throw new HttpsError("failed-precondition", "En vivo sin autor.");
    if (authorId === uid) {
      throw new HttpsError("failed-precondition", "No puedes enviarte un supercomentario a ti mismo.");
    }

    // Precio SERVER-AUTHORITATIVE: se resuelve el tier contra la config del live.
    const tier = resolveTier(post, tierId);
    if (!tier) throw new HttpsError("invalid-argument", "Nivel de supercomentario inválido.");
    const base = round2(tier.price); // base del creador (MXN)
    if (base > MAX_SUPER_COMMENT) {
      throw new HttpsError("failed-precondition", "El precio del supercomentario es demasiado alto.");
    }
    const safeText = text.slice(0, tier.maxChars);

    // Perfil del comprador (para el super-comentario destacado del chat).
    let username = "Anónimo";
    let avatarUrl: string | null = null;
    const userSnap = await db.collection("users").doc(uid).get();
    if (userSnap.exists) {
      const u = userSnap.data() as Record<string, unknown>;
      username = String(u.displayName ?? u.handle ?? u.username ?? "Anónimo");
      avatarUrl = u.photoURL ? String(u.photoURL) : null;
    }

    const taxCountry = data.taxCountry ? String(data.taxCountry).trim().toUpperCase() : null;
    const saveCard = data.saveCard === true;
    // Si viene, el cobro es "un clic" con una tarjeta ya guardada (off-session, sin CVV).
    const savedPaymentMethodId = data.savedPaymentMethodId ? String(data.savedPaymentMethodId).trim() : null;

    // Precio publicado = base + $3; IVA 16% encima (todo lo absorbe el fan).
    const country = taxCountry || "MX";
    // El país fiscal NO se confía del cliente: si manda uno sin IVA configurado (para
    // evadir el impuesto), se rechaza. Solo se cobra donde el impuesto está definido (MX).
    if (!isChargeableCountry(country)) {
      throw new HttpsError("failed-precondition", "El cobro solo está disponible en México por ahora.");
    }
    const published = round2(base + FIXED_SERVICE_FEE_MXN);
    const tax = applyConsumptionTax(published, country);
    const totalMxn = round2(published + tax.taxAmount);

    // Id único por súper comentario (es el id del doc que se materializará).
    const scId = db.collection("posts").doc(postId).collection("superComments").doc().id;
    const externalReference = `superComment__${postId}_${scId}`;

    await db.collection("paymentIntents").doc(externalReference).set({
      externalReference,
      buyerId: uid,
      grossAmount: base, // base → ledger (creador gana 75% de esto)
      sourceType: "superComment",
      sourceId: `${postId}_${scId}`,
      status: "awaiting_payment",
      // Payload = super-comentario CON texto → onSuperCommentLedger lo cuenta como supercomment.
      // `status: "paid"` es OBLIGATORIO (el trigger filtra por él).
      pendingSuperComment: {
        userId: uid,
        username,
        avatarUrl,
        text: safeText,
        tierId: tier.id,
        tierName: tier.name,
        color: tier.color,
        displaySeconds: tier.displaySeconds,
        amount: base,
        currency: "MXN",
        status: "paid",
        hidden: false,
        isDeleted: false,
        played: false,
      },
      baseAmount: base,
      fixedFee: FIXED_SERVICE_FEE_MXN,
      publishedAmount: published,
      taxAmount: tax.taxAmount,
      taxCountry: tax.taxCountry,
      taxRate: tax.taxRate,
      chargedAmount: totalMxn,
      settlementCurrency: SETTLEMENT_CURRENCY,
      settlementAmount: totalMxn,
      paymentMode: "stripe",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const customerId = await getOrCreateStripeCustomer(uid, request.auth?.token?.email ?? null);

    // ── Cobro "un clic" con tarjeta guardada (off-session, sin CVV) ──────────
    // Se confirma el PaymentIntent server-side con el payment_method guardado. El
    // webhook `payment_intent.succeeded` materializa el súper comentario (igual que
    // el flujo de tarjeta nueva). El precio SIGUE siendo server-authoritative.
    if (savedPaymentMethodId) {
      const charged = await chargeSavedCardOffSession({
        uid,
        savedCardDocId: savedPaymentMethodId,
        customerId,
        amountCents: Math.round(totalMxn * 100),
        currency: SETTLEMENT_CURRENCY,
        metadata: { externalReference, sourceType: "superComment", sourceId: `${postId}_${scId}`, buyerId: uid },
      });
      await db.collection("paymentIntents").doc(externalReference).set(
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
        currency: SETTLEMENT_CURRENCY.toLowerCase(),
        customer: customerId,
        payment_method_types: ["card"],
        ...(saveCard ? { setup_future_usage: "off_session" } : {}),
        metadata: { externalReference, sourceType: "superComment", sourceId: `${postId}_${scId}`, buyerId: uid },
      },
    });
    if (!res.ok) throw new HttpsError("internal", `No se pudo crear el pago (${res.status}): ${res.error.slice(0, 200)}`);

    await db.collection("paymentIntents").doc(externalReference).set(
      { stripePaymentIntentId: res.data.id, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );

    return { clientSecret: res.data.client_secret };
  }
);
