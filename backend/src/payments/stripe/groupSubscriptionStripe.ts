// createGroupSubscription — suscripción MENSUAL a comunidad con STRIPE (Subscriptions
// nativas: Stripe cobra cada mes, reintenta y maneja SCA de renovación).
//
// Pagar-luego-conceder: este callable SOLO crea la Subscription en Stripe (con toda la
// metadata que el webhook necesita) y devuelve el client_secret de la PRIMERA factura para
// confirmarla. La MEMBRESÍA y el doc `groupSubscriptions` los crea el webhook al aprobarse
// el primer cobro (`invoice.paid`) — así, si el usuario abandona el pago, no queda ningún
// comprobante que la regla permisiva pudiera aprovechar. El earning se registra por CADA
// factura pagada (webhook), no aquí. Precio server-authoritative: (base + $3) × IVA/mes.
//
// Solo México por ahora (MXN). Modelo agregador: todo cae en la cuenta Stripe de Vibra;
// el reparto por creador vive en el ledger interno.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import { stripeFetch, stripeSecretKey } from "./stripeClient";
import { getOrCreateStripeCustomer } from "./stripeCustomer";
import { extractAuthRequiredPI } from "./offSessionCharge";
import { isChargeableCountry } from "../../tax/config";
import { SETTLEMENT_CURRENCY } from "../../wallet/ledger";
import { readGroupSub, validateInviteForGroup, computeMonthlyCharge } from "../groupSubscriptionCore";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();
const REGION = "us-central1";

type StripePI = { id?: string; client_secret?: string; status?: string };
type StripeInvoice = { id?: string; payment_intent?: StripePI };
type StripeSubscription = { id?: string; status?: string; latest_invoice?: StripeInvoice };

// Las suscripciones de Stripe exigen un Product ID en `price_data` (no acepta product_data
// inline). Usamos UN producto genérico para todas las comunidades (el nombre de la comunidad
// va en `description` de la suscripción). Se crea una vez y se cachea en Firestore.
async function getOrCreateSubProductId(): Promise<string> {
  const ref = db.collection("stripeConfig").doc("communitySubscriptionProduct");
  const existing = String((await ref.get()).data()?.productId ?? "").trim();
  if (existing) return existing;
  const res = await stripeFetch<{ id?: string }>("/products", {
    method: "POST",
    idempotencyKey: "vibra_community_subscription_product",
    form: { name: "Suscripción a comunidad — Vibra" },
  });
  if (!res.ok || !res.data.id) {
    throw new HttpsError("internal", "No se pudo preparar el producto de suscripción.");
  }
  await ref.set({ productId: res.data.id, createdAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  return res.data.id;
}

export const createGroupSubscription = onCall(
  { region: REGION, cors: true, secrets: [stripeSecretKey] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");

    const data = (request.data ?? {}) as Record<string, unknown>;
    const groupId = String(data.groupId ?? "").trim();
    if (!groupId) throw new HttpsError("invalid-argument", "Falta la comunidad.");
    const savedPaymentMethodId = data.savedPaymentMethodId ? String(data.savedPaymentMethodId).trim() : null;

    const groupSnap = await db.collection("groups").doc(groupId).get();
    if (!groupSnap.exists) throw new HttpsError("not-found", "Comunidad no encontrada.");
    const group = groupSnap.data() as Record<string, unknown>;

    const sub = readGroupSub(group);
    if (!sub.enabled || sub.price <= 0) {
      throw new HttpsError("failed-precondition", "Esta comunidad no tiene suscripción activa.");
    }
    const ownerId = String(group.ownerId ?? "");
    if (!ownerId) throw new HttpsError("failed-precondition", "Comunidad sin dueño.");
    if (ownerId === uid) throw new HttpsError("failed-precondition", "No puedes suscribirte a tu propia comunidad.");

    // ¿Ya suscrito activo? (evita doble suscripción)
    const memberSnap = await db.doc(`users/${uid}/groupMemberships/${groupId}`).get();
    if (memberSnap.exists && memberSnap.data()?.subscriptionActive === true) {
      throw new HttpsError("failed-precondition", "Ya tienes una suscripción activa a esta comunidad.");
    }

    // Comunidad oculta = invite-only: exige inviteToken válido. Se marca su uso al
    // activar la membresía (en el webhook); aquí solo lo validamos y lo pasamos en metadata.
    let inviteToken: string | null = null;
    if (String(group.visibility) === "hidden") {
      inviteToken = String(data.inviteToken ?? "").trim();
      if (!inviteToken) {
        throw new HttpsError("permission-denied", "Necesitas una invitación válida para suscribirte a esta comunidad.");
      }
      await validateInviteForGroup(groupId, inviteToken); // lanza si no es válido
    }

    // País fiscal: NO se confía del cliente si es un país sin IVA configurado (evasión).
    const country = (data.taxCountry ? String(data.taxCountry).trim().toUpperCase() : "") || "MX";
    if (!isChargeableCountry(country)) {
      throw new HttpsError("failed-precondition", "El cobro solo está disponible en México por ahora.");
    }

    const charge = computeMonthlyCharge(sub.price, country); // (base + $3) × IVA
    const unitAmount = Math.round(charge.chargedMonthly * 100); // centavos MXN
    const groupName = String(group.name ?? "la comunidad");
    const externalReference = `groupSub__${groupId}_${uid}`;

    // Customer + (opcional) tarjeta guardada como método por defecto de la suscripción.
    const customerId = await getOrCreateStripeCustomer(uid, request.auth?.token?.email ?? null);
    let stripePmId: string | null = null;
    if (savedPaymentMethodId) {
      const pmSnap = await db.doc(`users/${uid}/paymentMethods/${savedPaymentMethodId}`).get();
      const pm = pmSnap.data() ?? {};
      const pmId = typeof pm.stripePaymentMethodId === "string" ? pm.stripePaymentMethodId : null;
      if (!pmSnap.exists || pm.buyerId !== uid || !pmId) {
        throw new HttpsError("not-found", "Tarjeta guardada no encontrada.");
      }
      stripePmId = pmId;
    }

    // El webhook (invoice.paid / customer.subscription.*) lee ESTA metadata para materializar
    // la membresía + el earning. Todos los valores van como string (requisito de Stripe).
    const metadata: Record<string, string> = {
      externalReference,
      sourceType: "groupSubscription",
      groupId,
      uid,
      ownerId,
      baseMonthly: String(charge.base),
      fixedFee: String(charge.fixedFee),
      publishedMonthly: String(charge.published),
      taxCountry: charge.taxCountry ?? "",
      taxRate: String(charge.taxRate),
      taxMonthly: String(charge.taxMonthly),
      chargedMonthly: String(charge.chargedMonthly),
      currency: sub.currency || SETTLEMENT_CURRENCY,
      groupName,
      ...(inviteToken ? { inviteToken } : {}),
    };

    const productId = await getOrCreateSubProductId();

    const res = await stripeFetch<StripeSubscription>("/subscriptions", {
      method: "POST",
      // Clave estable por (grupo, usuario): retries dentro de 24h devuelven la MISMA
      // suscripción en vez de crear duplicados.
      idempotencyKey: `groupsub_${externalReference}`,
      form: {
        customer: customerId,
        // El nombre de la comunidad va en `description` (aparece en la factura de Stripe).
        description: `Suscripción a ${groupName}`.slice(0, 250),
        items: [
          {
            price_data: {
              currency: SETTLEMENT_CURRENCY.toLowerCase(),
              product: productId,
              unit_amount: unitAmount,
              recurring: { interval: "month" },
            },
          },
        ],
        // No cobrar automáticamente: se confirma la 1ª factura desde el cliente (tarjeta
        // nueva) o server-side off-session (tarjeta guardada, más abajo).
        payment_behavior: "default_incomplete",
        payment_settings: { save_default_payment_method: "on_subscription" },
        expand: ["latest_invoice.payment_intent"],
        metadata,
        ...(stripePmId ? { default_payment_method: stripePmId } : {}),
      },
    });
    if (!res.ok) {
      logger.error("createGroupSubscription failed", { groupId, uid, status: res.status, error: res.error.slice(0, 200) });
      throw new HttpsError("internal", "No se pudo crear la suscripción. Intenta de nuevo.");
    }

    const subscriptionId = String(res.data.id ?? "");
    const pi = res.data.latest_invoice?.payment_intent;

    // ── Tarjeta guardada: cobra la 1ª factura off-session (sin CVV) ──────────
    if (stripePmId && pi?.id) {
      const conf = await stripeFetch<StripePI>(`/payment_intents/${pi.id}/confirm`, {
        method: "POST",
        form: { off_session: true },
      });
      if (!conf.ok) {
        // 3DS: devolvemos requires_action + client_secret para completar la autenticación.
        const recovered = extractAuthRequiredPI(conf.error);
        if (recovered) return { status: "requires_action", clientSecret: recovered.clientSecret, subscriptionId };
        throw new HttpsError("failed-precondition", "No se pudo cobrar tu tarjeta guardada. Intenta con otra.");
      }
      return { status: conf.data.status ?? "succeeded", clientSecret: conf.data.client_secret, subscriptionId };
    }

    // ── Tarjeta nueva: devuelve el client_secret de la 1ª factura para confirmar con Elements ──
    return { clientSecret: pi?.client_secret ?? null, status: pi?.status ?? null, subscriptionId };
  }
);

// ── Callable: cancelar la suscripción (conserva acceso hasta fin del periodo) ─────
// Marca `cancel_at_period_end` en Stripe (no corta al instante). El webhook
// `customer.subscription.updated`/`.deleted` sincroniza el estado; el cron diario
// `expireGroupSubscriptions` da de baja el acceso cuando vence `accessUntil`.
/**
 * Cancela INMEDIATAMENTE la suscripción de grupo de un usuario (uso: BAN). A
 * diferencia del cancel del usuario (cancel_at_period_end, mantiene acceso), aquí se
 * corta ya y se marca el doc como cancelado. Best-effort: si Stripe falla NO se lanza
 * (el ban ya revocó el acceso vía reglas por status "banned"); se registra para
 * reintento manual. Requiere que la función que lo invoque declare el secret de Stripe.
 */
export async function cancelGroupSubscriptionImmediately(
  groupId: string,
  uid: string
): Promise<void> {
  try {
    const ref = db.collection("groupSubscriptions").doc(`${groupId}_${uid}`);
    const snap = await ref.get();
    if (!snap.exists) return;
    const sub = snap.data() as Record<string, unknown>;
    const stripeSubscriptionId =
      typeof sub.stripeSubscriptionId === "string" ? sub.stripeSubscriptionId : null;

    if (stripeSubscriptionId) {
      const res = await stripeFetch(`/subscriptions/${stripeSubscriptionId}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 404) {
        logger.error("cancelGroupSubscriptionImmediately: Stripe cancel falló", {
          groupId,
          uid,
          status: res.status,
        });
      }
    }

    await ref.set(
      {
        cancelAtPeriodEnd: false,
        status: "cancelled",
        cancelledByBan: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  } catch (err) {
    logger.error("cancelGroupSubscriptionImmediately error", {
      groupId,
      uid,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

export const cancelGroupSubscriptionStripe = onCall(
  { region: REGION, cors: true, secrets: [stripeSecretKey] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
    const groupId = String((request.data as Record<string, unknown>)?.groupId ?? "").trim();
    if (!groupId) throw new HttpsError("invalid-argument", "Falta la comunidad.");

    const ref = db.collection("groupSubscriptions").doc(`${groupId}_${uid}`);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "No tienes una suscripción a esta comunidad.");
    const sub = snap.data() as Record<string, unknown>;
    if (sub.uid !== uid) throw new HttpsError("permission-denied", "No es tu suscripción.");
    const stripeSubscriptionId = typeof sub.stripeSubscriptionId === "string" ? sub.stripeSubscriptionId : null;
    if (!stripeSubscriptionId) {
      throw new HttpsError("failed-precondition", "Esta suscripción no se puede cancelar por esta vía.");
    }

    const res = await stripeFetch(`/subscriptions/${stripeSubscriptionId}`, {
      method: "POST",
      form: { cancel_at_period_end: true },
    });
    if (!res.ok) {
      logger.error("cancelGroupSubscriptionStripe failed", { groupId, uid, status: res.status });
      throw new HttpsError("internal", "No se pudo cancelar la suscripción. Intenta de nuevo.");
    }

    await ref.set(
      { cancelAtPeriodEnd: true, status: "cancelled", updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
    return { ok: true };
  }
);
