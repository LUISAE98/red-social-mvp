// S4 — Webhook de Stripe. Recibe los eventos (pago aprobado, reembolso, etc.) y los
// procesa: es lo que convierte un cobro en una compra real (más adelante materializa
// el doc de dominio + ledger, según la metadata del PaymentIntent).
//
// Seguridad: verifica la FIRMA de Stripe a mano (HMAC-SHA256), SIN el SDK. Idempotente
// (guarda event.id procesados). Responde 200 rápido; si falla, 500 y Stripe reintenta.
//
// Reemplaza a `mpWebhook`. El signing secret (whsec_...) va en STRIPE_WEBHOOK_SECRET.

import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { formaDePagoSat, FORMA_PAGO } from "../../facturacion/formaDePago";
import { defineSecret } from "firebase-functions/params";
import * as crypto from "crypto";
import * as admin from "firebase-admin";
import { applyApprovedPaymentToSource, applyAuthorizedHoldToSource, upsertPaymentIntentStatus } from "../reconcile";
import { stripeFetch, stripeSecretKey } from "./stripeClient";
import { reconcileStripeSubscriptionEvent } from "./groupSubscriptionStripeSync";
import { reconcileStripeRefundEvent } from "./stripeRefundSync";
import { claimWebhookEvent } from "../../webhookEvents";
import { assertIntentMatchesCharge } from "./intentBinding";
import { releaseFailedIntent } from "./releaseFailedIntent";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();
const REGION = "us-central1";

export const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");

// Guarda la referencia de la tarjeta del comprador (solo referencias: marca + últimos 4;
// Stripe custodia el dato sensible). Se llama cuando un pago se aprobó con
// `setup_future_usage` (el comprador pidió guardarla). Con esto sus próximos cobros son
// "un clic" off-session (sin CVV). Best-effort: si algo falla, solo se loguea.
async function persistSavedCard(buyerId: string, stripeCustomerId: string, pmId: string): Promise<void> {
  const res = await stripeFetch<{ id?: string; card?: { brand?: string; last4?: string } }>(
    `/payment_methods/${pmId}`
  );
  if (!res.ok) return;
  const card = res.data.card ?? {};
  const brand = typeof card.brand === "string" ? card.brand : null;
  const lastFour = typeof card.last4 === "string" ? card.last4 : null;
  const brandName = brand ? brand.charAt(0).toUpperCase() + brand.slice(1) : null;
  await db.doc(`users/${buyerId}/paymentMethods/${pmId}`).set(
    {
      buyerId,
      stripeCustomerId,
      stripePaymentMethodId: pmId,
      brand,
      brandName,
      lastFour,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

// Verifica la firma del header `Stripe-Signature` (formato "t=...,v1=...").
function verifySignature(rawBody: Buffer, sigHeader: string, secret: string): boolean {
  const parts: Record<string, string> = {};
  for (const kv of sigHeader.split(",")) {
    const i = kv.indexOf("=");
    if (i > 0) parts[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  }
  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1) return false;
  // Tolerancia de 5 min contra replays.
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(t)) > 300) return false;
  const signedPayload = `${t}.${rawBody.toString("utf8")}`;
  const expected = crypto.createHmac("sha256", secret).update(signedPayload, "utf8").digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

type StripeEvent = {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
};

/**
 * Consulta el cargo para saber con qué se pagó.
 *
 * Es una llamada de más por cada pago, y es inevitable: el evento solo trae el id. Sale
 * barata —una lectura— y el dato acaba en un documento fiscal, así que vale la pena.
 *
 * 🚨 Si la consulta falla NO se tira el webhook: el pago ya ocurrió y materializar la compra
 * importa mucho más que la forma de pago. Se devuelve «por definir», que es la verdad.
 */
async function formaDePagoDelCobro(latestCharge: unknown): Promise<string> {
  const id = typeof latestCharge === "string" ? latestCharge.trim() : "";
  if (!id) return FORMA_PAGO.POR_DEFINIR;

  try {
    const res = await stripeFetch<{
      payment_method_details?: { type?: string; card?: { funding?: string } };
    }>(`/charges/${id}`, { method: "GET" });
    if (!res.ok || !res.data) {
      logger.warn("forma_de_pago_no_consultada", { charge: id });
      return FORMA_PAGO.POR_DEFINIR;
    }
    const d = res.data.payment_method_details;
    return formaDePagoSat({ type: d?.type ?? null, funding: d?.card?.funding ?? null });
  } catch (err) {
    logger.warn("forma_de_pago_falló", {
      charge: id,
      err: err instanceof Error ? err.message : String(err),
    });
    return FORMA_PAGO.POR_DEFINIR;
  }
}

export const stripeWebhook = onRequest(
  { region: REGION, secrets: [stripeWebhookSecret, stripeSecretKey], cors: false },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("method not allowed");
      return;
    }
    const secret = stripeWebhookSecret.value().trim();
    const sig = req.headers["stripe-signature"];
    const raw = req.rawBody; // Buffer con el cuerpo crudo (necesario para la firma).
    if (!secret) {
      logger.error("stripeWebhook: falta STRIPE_WEBHOOK_SECRET");
      res.status(500).send("no secret");
      return;
    }
    if (!sig || typeof sig !== "string" || !raw || !verifySignature(raw, sig, secret)) {
      res.status(400).send("invalid signature");
      return;
    }

    let event: StripeEvent;
    try {
      event = JSON.parse(raw.toString("utf8")) as StripeEvent;
    } catch {
      res.status(400).send("bad json");
      return;
    }

    // Idempotencia ATÓMICA. Antes era `get()` → procesar → `set()`, y dos
    // entregas concurrentes del mismo evento leían "no existe" a la vez: las dos
    // procesaban y acuñaban el asiento del ledger por duplicado.
    const claim = await claimWebhookEvent("stripeEvents", event.id, { type: event.type });
    if (!claim.claimed) {
      res.status(200).send("duplicate");
      return;
    }

    try {
      if (event.type === "payment_intent.succeeded") {
        const pi = event.data.object as {
          id?: string; amount?: number; currency?: string; status?: string;
          customer?: string; payment_method?: string; setup_future_usage?: string;
          metadata?: Record<string, unknown>;
          /**
           * El id del cargo. Con él se consulta CÓMO pagó, que es lo que va en el CFDI.
           *
           * Llega siempre como id, nunca expandido: los webhooks no admiten `expand`.
           */
          latest_charge?: string;
        };
        /**
         * 🧾 Cómo pagó, para el CFDI.
         *
         * ⚠️ **Los webhooks de Stripe NUNCA traen objetos expandidos**, así que `latest_charge`
         * llega como un id suelto y hay que ir a buscar el cargo. No se puede pedir `expand`
         * en un evento: lo confirma su propia documentación.
         *
         * Se calcula FUERA del `if`: lo necesitan las dos escrituras de abajo, y la del intent
         * ocurre aunque el cobro no traiga id.
         */
        const formaPago = await formaDePagoDelCobro(pi.latest_charge);

        if (pi.id) {
          await db.collection("stripePayments").doc(pi.id).set(
            {
              paymentIntentId: pi.id,
              amount: pi.amount ?? null,
              currency: pi.currency ?? null,
              status: pi.status ?? null,
              customer: pi.customer ?? null,
              metadata: pi.metadata ?? {},
              satFormaPago: formaPago,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }
        // Materializa la compra (crea el saludo/sesión + suma al ledger) usando el
        // externalReference de la metadata. Reusa TODA la lógica de MP (reconcile).
        const externalReference = String(pi.metadata?.externalReference ?? "").trim();
        if (externalReference) {
          // ⚠️ El pago que llega tiene que ser EL pago vigente de esa compra.
          //
          // Antes se materializaba lo que hubiera en `paymentIntents/{ref}` sin
          // mirar de qué cobro venía el evento. Y de la misma referencia pueden
          // colgar VARIOS cobros de Stripe: al recotizar por el país de la
          // tarjeta cambia el importe, y con él la clave de idempotencia, así que
          // nace otro. Un cobro viejo y más barato podía aprobar la versión nueva
          // y cara de la compra.
          const vigente = await assertIntentMatchesCharge(externalReference, {
            id: pi.id ?? null,
            amount: typeof pi.amount === "number" ? pi.amount : null,
            currency: typeof pi.currency === "string" ? pi.currency : null,
          });

          if (!vigente) {
            // No se procesa, pero se responde 200: reintentarlo daría el mismo
            // resultado. Queda el registro para revisarlo a mano.
            logger.error("stripeWebhook: cobro que no corresponde a la compra vigente", {
              externalReference,
              id: pi.id,
              amount: pi.amount,
              currency: pi.currency,
            });
            await claim.confirm?.();
            res.status(200).send("stale-intent");
            return;
          }

          await applyApprovedPaymentToSource(externalReference, { mpOrderId: null, mpPaymentId: pi.id ?? null });
          await upsertPaymentIntentStatus(externalReference, { status: "paid" });
          // La factura lee de aquí, no de `stripePayments`: su clave es la referencia de
          // la compra, no el id del cobro, y de una referencia pueden colgar varios cobros.
          await db.collection("paymentIntents").doc(externalReference).set(
            { satFormaPago: formaPago },
            { merge: true }
          );
          logger.info("stripeWebhook materialized", { externalReference, id: pi.id });
        } else {
          logger.info("stripeWebhook payment sin externalReference (prueba suelta)", { id: pi.id });
        }

        // Si el comprador pidió guardar su tarjeta (setup_future_usage), persistimos la
        // referencia para habilitar el cobro "un clic" off-session en la próxima compra.
        try {
          const buyerId = String(pi.metadata?.buyerId ?? "").trim();
          if (pi.setup_future_usage && pi.payment_method && pi.customer && buyerId) {
            await persistSavedCard(buyerId, pi.customer, pi.payment_method);
            logger.info("stripeWebhook saved card", { buyerId, pm: pi.payment_method });
          }
        } catch (e) {
          logger.warn("stripeWebhook no pudo guardar la tarjeta", { err: e instanceof Error ? e.message : String(e) });
        }
      } else if (event.type === "payment_intent.amount_capturable_updated") {
        // HOLD colocado (auth-hold de una EXPERIENCIA con `capture_method: manual`). El
        // comprador autorizó pero AÚN NO se cobra. Materializamos el doc de dominio en
        // `paymentStatus: "authorized"` para que el creador vea la solicitud, SIN ledger.
        // El ledger nace al CAPTURAR (cuando el creador acepta).
        const pi = event.data.object as { id?: string; metadata?: Record<string, unknown> };
        const externalReference = String(pi.metadata?.externalReference ?? "").trim();
        if (externalReference) {
          await applyAuthorizedHoldToSource(externalReference, { mpOrderId: null, mpPaymentId: pi.id ?? null });
          await upsertPaymentIntentStatus(externalReference, { status: "authorized" });
          logger.info("stripeWebhook hold authorized", { externalReference, id: pi.id });
        } else {
          logger.info("stripeWebhook hold sin externalReference", { id: pi.id });
        }
      } else if (
        event.type === "invoice.paid" ||
        event.type === "invoice.payment_succeeded" ||
        event.type === "invoice.payment_failed" ||
        event.type === "customer.subscription.deleted" ||
        event.type === "customer.subscription.updated"
      ) {
        // Suscripción MENSUAL a comunidad (Stripe Billing): renovación/baja/gracia.
        await reconcileStripeSubscriptionEvent(event.type, event.data.object);
      } else if (
        event.type === "charge.refunded" ||
        event.type === "charge.dispute.closed"
      ) {
        // Reembolso o contracargo perdido → revierte el ledger (fuente de verdad
        // universal para los 11 servicios). Idempotente.
        await reconcileStripeRefundEvent(event.type, event.data.object);
      } else if (
        event.type === "payment_intent.payment_failed" ||
        event.type === "payment_intent.canceled"
      ) {
        // ⚠️ Un cobro que muere hay que CERRARLO, no solo anotarlo.
        //
        // Antes caían en el "solo se registran" de abajo, y eso dejaba dos cosas
        // colgando: el intent se quedaba en `awaiting_payment` para siempre, y el
        // saldo a favor que el comprador hubiera aplicado seguía reservado —o sea
        // descontado de su saldo— hasta que el cron de las 6 h lo soltara. Alguien
        // cuya tarjeta se rechaza no debería quedarse sin su saldo durante horas.
        const pi = event.data.object as { id?: string; metadata?: Record<string, unknown> };
        const externalReference = String(pi.metadata?.externalReference ?? "").trim();
        if (externalReference) {
          await releaseFailedIntent(
            externalReference,
            event.type === "payment_intent.canceled" ? "canceled" : "failed"
          );
        }
        logger.info("stripeWebhook: cobro cerrado", { type: event.type, externalReference, id: pi.id });
      } else if (event.type === "charge.dispute.created") {
        // Se ABRE una disputa. No se toca el acceso todavía: la disputa puede
        // ganarse, y quitarle el contenido a quien tiene razón sería peor que
        // esperar. Se marca para que aparezca en el panel y no pase inadvertida;
        // el acceso se retira en `charge.dispute.closed` si se pierde.
        const dispute = event.data.object as { id?: string; charge?: string; amount?: number };
        await db
          .collection("stripeDisputes")
          .doc(String(dispute.id ?? event.id))
          .set(
            {
              disputeId: dispute.id ?? null,
              chargeId: dispute.charge ?? null,
              amount: dispute.amount ?? null,
              status: "open",
              openedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        logger.error("stripeWebhook: DISPUTA ABIERTA", { disputeId: dispute.id, chargeId: dispute.charge });
      } else if (event.type === "refund.failed" || event.type === "refund.updated") {
        // ⚠️ Un reembolso puede fallar DESPUÉS de que Stripe respondiera 200.
        //
        // El cash-out daba por devuelto todo lo que Stripe aceptó, sin mirar si el
        // objeto Refund acababa bien. Un reembolso fallido dejaba al comprador sin
        // saldo y sin efectivo, con la solicitud cerrada.
        const refund = event.data.object as { id?: string; status?: string; metadata?: Record<string, unknown> };
        if (refund.status === "failed" || refund.status === "canceled") {
          const cashoutId = String(refund.metadata?.cashoutId ?? "").trim();
          logger.error("stripeWebhook: REEMBOLSO FALLIDO", {
            refundId: refund.id,
            status: refund.status,
            cashoutId,
          });
          if (cashoutId) {
            await db
              .collection("cashoutRequests")
              .doc(cashoutId)
              .set(
                {
                  status: "partially_refunded",
                  failedRefunds: admin.firestore.FieldValue.arrayUnion({
                    refundId: refund.id ?? null,
                    status: refund.status,
                  }),
                  lastError: `Un reembolso falló en Stripe (${refund.status}).`,
                  lastErrorAt: admin.firestore.FieldValue.serverTimestamp(),
                },
                { merge: true }
              );
          }
        }
      } else {
        // El resto se registra a propósito: sirve para ver qué manda Stripe antes
        // de decidir si merece un manejo propio.
        logger.info("stripeWebhook event", { type: event.type, id: event.id });
      }

      await claim.confirm();
      res.status(200).send("ok");
    } catch (err) {
      logger.error("stripeWebhook handler failed", { type: event.type, err: err instanceof Error ? err.message : String(err) });
      // Liberar el reclamo: si no, el reintento de Stripe se vería como
      // duplicado y el evento quedaría perdido para siempre.
      await claim.release();
      res.status(500).send("error"); // Stripe reintenta.
    }
  }
);
