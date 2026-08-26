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
import { resolvePresentment, applyCharmRounding } from "../../tax/presentment";
import { composeCharge } from "../../tax/composeCharge";
import { resolveTaxCountry } from "../../tax/resolveCountry";
import { SETTLEMENT_CURRENCY, SUBSCRIPTION_MIN_PRICE_USD } from "../../wallet/ledger";
import { readGroupSub, reserveInviteSlot } from "../groupSubscriptionCore";
import { stripeIdempotencyKey } from "./idempotency";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();
const REGION = "us-central1";

type StripePI = { id?: string; client_secret?: string; status?: string };
type StripeInvoice = {
  id?: string;
  payment_intent?: StripePI;
  // API reciente de Stripe: el secret para confirmar la 1ª factura vive aquí en vez de
  // en `payment_intent`. Leemos de cualquiera de los dos.
  confirmation_secret?: { client_secret?: string };
};
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

    // B6-H06: una comunidad borrada o desactivada sigue existiendo en Firestore
    // —el borrado es lógico—, así que "existe" no bastaba: se podía empezar a
    // pagar una suscripción a una comunidad que ya no está.
    if (group.isActive === false || group.isDeleted === true) {
      throw new HttpsError("failed-precondition", "Esta comunidad ya no está disponible.");
    }

    const sub = readGroupSub(group);
    if (!sub.enabled || sub.price <= 0) {
      throw new HttpsError("failed-precondition", "Esta comunidad no tiene suscripción activa.");
    }
    // El mínimo de la cuota estaba solo en el panel del creador, es decir en el navegador.
    // ⚠️ Importa más aquí que en un cobro único: una cuota por debajo del mínimo no se
    // cobra una vez, se cobra todos los meses mientras dure la suscripción.
    if (sub.price < SUBSCRIPTION_MIN_PRICE_USD) {
      throw new HttpsError(
        "failed-precondition",
        `La cuota mensual mínima es ${SUBSCRIPTION_MIN_PRICE_USD} ${SETTLEMENT_CURRENCY}.`
      );
    }
    const ownerId = String(group.ownerId ?? "");
    if (!ownerId) throw new HttpsError("failed-precondition", "Comunidad sin creador.");
    if (ownerId === uid) throw new HttpsError("failed-precondition", "No puedes suscribirte a tu propia comunidad.");

    // Estado de MI suscripción actual (Stripe es la fuente de verdad). Tres casos:
    //  · Activa y SIN cancelación pendiente → duplicado real: rechazar (evita doble cobro;
    //    también cierra la carrera de doble-clic, porque el flag `subscriptionActive` de la
    //    membresía lo pone el webhook async y podría llegar tarde).
    //  · Activa PERO con cancelación programada (cancel_at_period_end) → el usuario está
    //    REACTIVANDO desde el botón "Suscrito hasta {fecha}": se deshace la cancelación. No
    //    se cobra de nuevo (ya pagó este periodo); se reanuda el cobro recurrente.
    //  · Ended/canceled/incomplete → cae abajo y se crea una suscripción NUEVA.
    const existingSubSnap = await db.collection("groupSubscriptions").doc(`${groupId}_${uid}`).get();
    const existingSubId =
      typeof existingSubSnap.data()?.stripeSubscriptionId === "string"
        ? (existingSubSnap.data()?.stripeSubscriptionId as string)
        : null;
    if (existingSubId) {
      const chk = await stripeFetch<{ status?: string; cancel_at_period_end?: boolean }>(`/subscriptions/${existingSubId}`);
      const chkData = chk.ok ? chk.data : null;
      const st = chkData?.status ?? null;
      if (st && ["active", "trialing", "past_due", "unpaid"].includes(st)) {
        if (chkData?.cancel_at_period_end === true) {
          const re = await stripeFetch(`/subscriptions/${existingSubId}`, {
            method: "POST",
            form: { cancel_at_period_end: false },
          });
          if (!re.ok) {
            logger.error("reactivateGroupSubscription failed", { groupId, uid, status: re.status });
            throw new HttpsError("internal", "No se pudo reactivar la suscripción. Intenta de nuevo.");
          }
          await existingSubSnap.ref.set(
            { cancelAtPeriodEnd: false, status: "authorized", updatedAt: admin.firestore.FieldValue.serverTimestamp() },
            { merge: true }
          );
          logger.info("group subscription reactivated", { groupId, uid, subscriptionId: existingSubId });
          return { status: "succeeded", clientSecret: null, subscriptionId: existingSubId, reactivated: true };
        }
        throw new HttpsError("failed-precondition", "Ya tienes una suscripción activa a esta comunidad.");
      }
    }

    // Comunidad oculta = invite-only: exige inviteToken válido. Se marca su uso al
    // activar la membresía (en el webhook); aquí solo lo validamos y lo pasamos en metadata.
    let inviteToken: string | null = null;
    if (String(group.visibility) === "hidden") {
      inviteToken = String(data.inviteToken ?? "").trim();
      if (!inviteToken) {
        throw new HttpsError("permission-denied", "Necesitas una invitación válida para suscribirte a esta comunidad.");
      }
      // RESERVA el cupo aquí, antes de crear el cobro. Antes solo se validaba con
      // una lectura simple y el tope se re-comprobaba al llegar la factura, pero
      // ahí ya era tarde: si estaba agotada, el webhook dejaba de contar y
      // activaba la membresía igual. Dos personas con el último cupo pagaban las
      // dos y entraban las dos a una comunidad oculta.
      await reserveInviteSlot(groupId, inviteToken, uid);
    }

    // País fiscal: lo decide el SERVIDOR con la IP del request, nunca el payload del cliente.
    // Con un segundo país en la tabla (y más si su impuesto es 0) el cliente podía mandar otro
    // ISO y evadir el 16% mexicano. Ver impuestos.md §3.
    // TODO(fase 2): recalcular con el país emisor de la tarjeta antes de confirmar.
    const resolved = await resolveTaxCountry({ rawRequest: request.rawRequest });
    const country = resolved.country;
    if (!isChargeableCountry(country)) {
      throw new HttpsError("failed-precondition", "El cobro no está disponible en tu país por ahora.");
    }

    // ⚠️ MISMO camino que los otros nueve cobros: `composeCharge` + redondeo comercial.
    //
    // Antes usaba `computeMonthlyCharge`, una función propia que hacía (base + fijo) × IVA
    // y SE SALTABA DOS COSAS:
    //   · el 2% de conversión — que en una suscripción es aún MÁS necesario, porque no se
    //     puede fijar la tasa: Stripe convierte a su cambio en CADA renovación, mes tras
    //     mes, y ese coste lo estaba absorbiendo Vibra;
    //   · el redondeo comercial — así que la pasarela enseñaba un total (que sí lo aplica)
    //     y se cobraba otro más bajo.
    const { charge: composicion, displayAmount } = await applyCharmRounding(
      composeCharge(sub.price, country)
    );
    const charge = {
      base: composicion.baseAmount,
      fixedFee: composicion.fixedFee,
      published: composicion.publishedAmount,
      taxCountry: country,
      taxRate: composicion.buyerTax.rate,
      taxMonthly: composicion.buyerTax.amount,
      chargedMonthly: composicion.chargedAmount,
    };
    // El precio se fija al crear el Price y rige TODAS las renovaciones, así que aquí se
    // cobra exactamente el importe comercial que vio el comprador.
    const presentment = await resolvePresentment(
      composicion.chargedAmount,
      composicion.displayCurrency,
      displayAmount
    );
    const unitAmount = presentment.amountForStripe;
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
      // ⚠️ La moneda de ESTOS importes, que van todos en la de liquidación. Antes salía de
      // `sub.currency` —lo que el creador tuviera guardado, a veces "MXN" de la época
      // anterior— y la renovación lo copiaba al documento de la suscripción: importes en
      // dólares etiquetados como pesos, mes tras mes.
      currency: SETTLEMENT_CURRENCY,
      groupName,
      // 🧾 EVIDENCIA FISCAL DEL PAÍS (Art. 18-C), congelada aquí a propósito.
      //
      // En los otros diez cobros la evidencia se estampa en el paymentIntent, porque cada
      // compra es un evento con su propio request: hay IP y hay tarjeta de donde derivarla.
      // Una suscripción no: renueva sola durante años, y en la renovación **no hay navegador
      // ni IP**. Si la evidencia no viaja con ella, dentro de tres años habrá cobros sin
      // manera de justificar por qué se les aplicó la tasa de ese país.
      //
      // El webhook lee esta metadata en CADA `invoice.paid`, así que basta con dejarla aquí.
      taxCountrySource: resolved.source,
      taxCountryIndicios: JSON.stringify(resolved.indicios),
      taxCountryHadConflict: String(resolved.hadConflict),
      taxCountryAgreeingIndicios: resolved.agreeingIndicios.join(","),
      taxCountryTwoEvidence: String(resolved.meetsTwoEvidenceRule),
      // Fecha de la determinación: la evidencia vale para el día en que se tomó, no para
      // siempre. Si el comprador se muda, lo que cambia es la suscripción, no el pasado.
      taxCountryResolvedAt: new Date().toISOString(),
      ...(inviteToken ? { inviteToken } : {}),
    };

    const productId = await getOrCreateSubProductId();

    const res = await stripeFetch<StripeSubscription>("/subscriptions", {
      method: "POST",
      // La clave era ÚNICA por intento (`randomUUID`) con este razonamiento: una
      // estable por (grupo,usuario) daría `idempotency_error` al reintentar con
      // parámetros distintos —precio corregido, otro código— porque Stripe cachea
      // la clave 24 h junto con sus params.
      //
      // La objeción es correcta y por eso la clave incluye AHORA esos params. Un
      // reintento con otro precio genera otra clave y no colisiona; un doble clic
      // con los mismos datos deduplica. Antes no deduplicaba nada: dos envíos
      // concurrentes creaban DOS suscripciones y la segunda sobrescribía el id
      // guardado, dejando una huérfana viva en Stripe. Que el modal tenga un flag
      // `submitting` no es una defensa del servidor.
      idempotencyKey: stripeIdempotencyKey(
        `groupSubscription__${groupId}_${uid}`,
        unitAmount,
        presentment.currency,
        productId
      ),
      form: {
        customer: customerId,
        // El nombre de la comunidad va en `description` (aparece en la factura de Stripe).
        description: `Suscripción a ${groupName}`.slice(0, 250),
        items: [
          {
            price_data: {
              currency: presentment.currency.toLowerCase(),
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
        expand: ["latest_invoice.payment_intent", "latest_invoice.confirmation_secret"],
        metadata,
        ...(stripePmId ? { default_payment_method: stripePmId } : {}),
      },
    });
    if (!res.ok) {
      logger.error("createGroupSubscription failed", { groupId, uid, status: res.status, error: res.error.slice(0, 200) });
      throw new HttpsError("internal", "No se pudo crear la suscripción. Intenta de nuevo.");
    }

    const subscriptionId = String(res.data.id ?? "");
    const invoice = res.data.latest_invoice;
    const pi = invoice?.payment_intent;
    // El secret para confirmar la 1ª factura puede venir en payment_intent (API vieja) o
    // en confirmation_secret (API reciente). Se confirma igual con confirmCardPayment.
    const clientSecret = pi?.client_secret ?? invoice?.confirmation_secret?.client_secret ?? null;

    logger.info("createGroupSubscription created", {
      groupId,
      uid,
      subscriptionId,
      subStatus: res.data.status ?? null,
      hasPi: !!pi,
      piStatus: pi?.status ?? null,
      hasConfirmationSecret: !!invoice?.confirmation_secret?.client_secret,
      clientSecretFound: !!clientSecret,
    });

    // ── Tarjeta guardada: cobra la 1ª factura off-session (sin CVV), si tenemos el PI id ──
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

    // ── Tarjeta nueva (o guardada sin PI id): devuelve el client_secret para confirmar en el cliente ──
    return { clientSecret, status: pi?.status ?? null, subscriptionId };
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
  uid: string,
  motivo: "ban" | "moderator_grant" = "ban"
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
        // `active: false` es OBLIGATORIO, no cosmético: el cron diario
        // `expireGroupSubscriptions` busca `active == true` con el acceso
        // vencido y BORRA la membresía. Sin apagarlo, cancelar aquí dejaba una
        // bomba de relojería que echaba a la persona al vencer su periodo.
        active: false,
        endedAt: admin.firestore.FieldValue.serverTimestamp(),
        cancelledByBan: motivo === "ban",
        cancelledReason: motivo,
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
