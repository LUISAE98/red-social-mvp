// Cliente único de Stripe vía REST (SIN el SDK oficial). Fuente única de acceso a
// Stripe para todo el backend, igual que facturapiClient / mpClient.
//
// ⚠️ Por qué REST y no el SDK `stripe`: el npm de este entorno genera un
// package-lock roto al agregar el SDK (omite `@firebase/app`, deps transitivas), y
// el contenedor de Cloud Run no arranca. Con REST no tocamos package.json/lock.
// La verificación de firma de webhooks (S4) se hace a mano con `crypto` (HMAC).
//
// Auth: Bearer con la secret key. Cuerpos en form-urlencoded (formato Stripe con
// corchetes para anidados/arrays). El MODO lo define el tipo de llave (sk_test/sk_live).

import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";

export const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");

const STRIPE_API_BASE = "https://api.stripe.com/v1";

/**
 * Tope de espera por llamada a Stripe. Holgado para no cortar una operación
 * legítima lenta, pero muy por debajo del timeout de la Cloud Function, que es
 * de minutos: lo que se evita es quedarse colgado pagando instancia.
 */
const STRIPE_TIMEOUT_MS = 20_000;

export type StripeResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string };

/**
 * Versión PREVIEW de la API de Stripe. La necesitan tanto `/fx_quotes` como CUALQUIER
 * llamada que mande el parámetro `fx_quote` (crear/confirmar un PaymentIntent con la tasa
 * fijada). Sin esta cabecera Stripe responde 400 `parameter_unknown: fx_quote`.
 */
export const STRIPE_PREVIEW_VERSION = "2025-03-31.preview";

/** true si la llave es de PRUEBA (sk_test_...). */
export function isStripeTestMode(): boolean {
  return stripeSecretKey.value().trim().startsWith("sk_test");
}

// Serializa a form-urlencoded en el formato de Stripe: anidados `a[b]=x`, arrays
// `a[0]=x` (y `a[0][k]=x` para objetos dentro de arrays).
function encodeForm(obj: Record<string, unknown>, prefix = ""): string[] {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === "object") {
          parts.push(...encodeForm(item as Record<string, unknown>, `${key}[${i}]`));
        } else {
          parts.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else if (typeof v === "object") {
      parts.push(...encodeForm(v as Record<string, unknown>, key));
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts;
}

/**
 * Llamada autenticada a la API de Stripe.
 *  - `form`: cuerpo (se serializa a form-urlencoded estilo Stripe).
 *  - `idempotencyKey`: para POST seguros ante reintentos.
 *  - `stripeAccount`: header Stripe-Account (actuar sobre una cuenta conectada).
 */
export async function stripeFetch<T = unknown>(
  path: string,
  init: {
    method?: "GET" | "POST" | "DELETE";
    form?: Record<string, unknown>;
    idempotencyKey?: string;
    stripeAccount?: string;
    /**
     * Fija la versión de la API para esta llamada (header `Stripe-Version`).
     * Necesario para las APIs en PREVIEW, que no responden con la versión por defecto
     * de la cuenta. Hoy solo lo usa la FX Quotes API.
     */
    apiVersion?: string;
  } = {}
): Promise<StripeResult<T>> {
  const key = stripeSecretKey.value().trim();
  if (!key) return { ok: false, status: 0, error: "Falta el secreto STRIPE_SECRET_KEY." };

  const url = path.startsWith("http") ? path : `${STRIPE_API_BASE}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
  };
  if (init.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey;
  if (init.stripeAccount) headers["Stripe-Account"] = init.stripeAccount;
  // ⚠️ RESTRICCIÓN DE STRIPE, no decisión de producto: «FX Quotes can only be used with
  // PaymentIntents with automatic captures». La tasa fijada es INCOMPATIBLE con la
  // retención (`capture_method: "manual"`), que es el modelo de saludo, consejo, sesión y
  // tiempo contigo: se autoriza al solicitar y se cobra al entregar. El modelo manda, así
  // que en esos cobros se cae a la conversión propia de Stripe al liquidar — lo absorbe el
  // colchón del 2%. Mandarlo igual devolvía 400 y NINGÚN comprador fuera de USD podía pagar.
  const form = init.form && init.form.fx_quote && init.form.capture_method === "manual"
    ? Object.fromEntries(Object.entries(init.form).filter(([k]) => k !== "fx_quote"))
    : init.form;

  // ⚠️ El parámetro `fx_quote` SOLO existe en la versión preview. Se fija aquí, en el
  // único punto por el que pasan todas las llamadas, porque son NUEVE los sitios que lo
  // mandan (los 9 caminos de cobro) y basta olvidarlo en uno para que ese servicio deje
  // de cobrar a todo comprador que no pague en la moneda de liquidación.
  if (init.apiVersion) headers["Stripe-Version"] = init.apiVersion;
  else if (form && form.fx_quote) headers["Stripe-Version"] = STRIPE_PREVIEW_VERSION;

  let body: string | undefined;
  if (form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = encodeForm(form).join("&");
  }

  try {
    // ⚠️ Con timeout explícito. Sin él, una conexión lenta retiene la instancia
    // hasta el timeout global de la Cloud Function (minutos): se paga ese tiempo,
    // se ocupa concurrencia y el cliente se queda colgado sin poder reintentar.
    // Las rutas proxy de Next ya lo hacían; los clientes centrales, no.
    const res = await fetch(url, {
      method: init.method ?? "GET",
      headers,
      body,
      signal: AbortSignal.timeout(STRIPE_TIMEOUT_MS),
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      logger.error("stripeFetch error", { path, status: res.status, text: text.slice(0, 500) });
      return { ok: false, status: res.status, error: text };
    }
    const data = (text ? JSON.parse(text) : {}) as T;
    return { ok: true, status: res.status, data };
  } catch (err) {
    logger.error("stripeFetch failed", { path, err: err instanceof Error ? err.message : String(err) });
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}
