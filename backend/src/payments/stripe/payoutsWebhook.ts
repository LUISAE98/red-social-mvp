// Webhook de Global Payouts: cierra un retiro en cuanto Stripe mueve su pago.
//
// ── POR QUÉ EXISTE, TENIENDO YA UN CRON ─────────────────────────────────────────────────
//
// `conciliarRetiros` barre cada hora preguntando «¿ya se depositó?». Funciona, pero deja al
// creador viendo «en proceso de envío» hasta 60 minutos después de tener el dinero, y —peor—
// retrasa lo mismo la DEVOLUCIÓN de su saldo cuando el banco rechaza el pago.
//
// Este webhook lo cierra en el momento. **El cron se queda**, no se sustituye: si un evento se
// pierde, se entrega dos veces o llega desordenado, el barrido lo arregla igual. Un webhook es
// más rápido; un cron es más terco. Los dos llaman a `conciliarUnRetiro`, que es idempotente.
//
// ── LOS EVENTOS V2 SON «DELGADOS» ───────────────────────────────────────────────────────
//
// 🚨 No traen el objeto, solo su id — y su carga **no está versionada**. La documentación de
//    Stripe es explícita: «during processing, you must fetch the versioned event from the API
//    or fetch the resource's current state».
//
//    Por eso este archivo NO decide nada a partir del nombre del evento. Saca el id del pago,
//    y `conciliarUnRetiro` vuelve a preguntarle a Stripe en qué estado está de verdad. Confiar
//    en el nombre sería confiar en un dato que Stripe no garantiza, y aquí se decide si un
//    creador cobra o si se le devuelve el saldo.
//
// ── SU PROPIO SECRETO ───────────────────────────────────────────────────────────────────
//
// Los eventos v2 van por un **destino de eventos** distinto del webhook v1 que ya existe, con
// su propio secreto de firma. Compartir el de v1 dejaría entrar eventos de un canal en el otro.

import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import * as crypto from "crypto";

import { conciliarPorPagoId } from "../../wallet/withdrawals";
import { stripePayoutsSecretKey } from "./stripeClient";

/** Secreto de firma del destino de eventos v2. NO es el del webhook v1. */
export const stripePayoutsWebhookSecret = defineSecret("STRIPE_PAYOUTS_WEBHOOK_SECRET");

const REGION = "us-central1";

/**
 * Verifica el header `Stripe-Signature` (formato `t=...,v1=...`).
 *
 * Es el mismo esquema que el webhook v1 y está copiado a propósito en vez de importado: son
 * dos canales con secretos distintos, y compartir la función invitaría a compartir el secreto.
 *
 * La tolerancia de 5 minutos es lo que impide reenviar un evento capturado hace horas.
 */
function firmaValida(cuerpo: Buffer, header: string, secreto: string): boolean {
  const partes: Record<string, string> = {};
  for (const kv of header.split(",")) {
    const i = kv.indexOf("=");
    if (i > 0) partes[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  }
  const t = partes["t"];
  const v1 = partes["v1"];
  if (!t || !v1) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(t)) > 300) return false;

  const firmado = `${t}.${cuerpo.toString("utf8")}`;
  const esperada = crypto.createHmac("sha256", secreto).update(firmado, "utf8").digest("hex");
  const a = Buffer.from(esperada);
  const b = Buffer.from(v1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Un evento delgado de la v2. Solo el id y a qué apunta. */
type EventoDelgado = {
  id?: string;
  type?: string;
  related_object?: { id?: string; type?: string; url?: string };
};

/**
 * Los estados que cierran un retiro. `created` y `updated` no dicen nada nuevo y se ignoran,
 * igual que `under_review`: ahí el pago sigue vivo y el saldo tiene que seguir apartado.
 */
const CIERRAN = new Set([
  "v2.money_management.outbound_payment.posted",
  "v2.money_management.outbound_payment.failed",
  "v2.money_management.outbound_payment.returned",
  "v2.money_management.outbound_payment.canceled",
]);

export const stripePayoutsWebhook = onRequest(
  {
    region: REGION,
    secrets: [stripePayoutsWebhookSecret, stripePayoutsSecretKey],
    // El cuerpo crudo hace falta para la firma; sin él no se puede verificar nada.
    cors: false,
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("method not allowed");
      return;
    }

    const secreto = stripePayoutsWebhookSecret.value().trim();
    if (!secreto) {
      logger.error("payoutsWebhook: falta STRIPE_PAYOUTS_WEBHOOK_SECRET");
      res.status(500).send("no secret");
      return;
    }

    const sig = req.headers["stripe-signature"];
    const raw = req.rawBody;
    if (!sig || typeof sig !== "string" || !raw || !firmaValida(raw, sig, secreto)) {
      // 🚨 400 y nada más. Sin firma válida no se lee el cuerpo ni se registra su contenido:
      //    cualquiera puede llamar a esta URL.
      res.status(400).send("invalid signature");
      return;
    }

    let evento: EventoDelgado;
    try {
      evento = JSON.parse(raw.toString("utf8")) as EventoDelgado;
    } catch {
      res.status(400).send("bad json");
      return;
    }

    const tipo = String(evento.type ?? "");
    if (!CIERRAN.has(tipo)) {
      // 200 igual: un evento que no nos toca no es un fallo, y devolver error haría que
      // Stripe lo reintentara para siempre.
      res.status(200).send("ignored");
      return;
    }

    const pagoId = String(evento.related_object?.id ?? "");
    if (!pagoId) {
      logger.warn("payoutsWebhook: evento sin related_object.id", { tipo });
      res.status(200).send("no object");
      return;
    }

    try {
      const cerrado = await conciliarPorPagoId(pagoId);
      logger.info("payoutsWebhook_procesado", { tipo, pagoId, cerrado });
      res.status(200).send("ok");
    } catch (err) {
      /*
       * 🚨 500 para que Stripe REINTENTE.
       *
       * Si esto falla y respondemos 200, el evento se pierde y el retiro se queda colgado
       * hasta la siguiente pasada del cron. Un 500 hace que Stripe lo vuelva a mandar, y
       * `conciliarUnRetiro` es idempotente, así que reintentar no puede duplicar nada.
       */
      logger.error("payoutsWebhook_falló", {
        tipo,
        pagoId,
        err: err instanceof Error ? err.message : String(err),
      });
      res.status(500).send("retry");
    }
  }
);
