// Cliente único de Mercado Pago (Orders API — Checkout API avanzado).
//
// Fuente única de acceso a MP para todo el backend. Las credenciales viven en
// Firebase Secrets (nunca hardcodeadas): esto garantiza que migrar de persona
// física a persona moral sea solo rotar el secreto, sin tocar código.
//
// Se llama a la API por `fetch` directo (Node 20 trae fetch global), igual que
// la integración de Didit en `kyc.ts`. No se usa el SDK `mercadopago`.
//
// Modelo AGREGADOR: TODO el dinero cae en esta cuenta MP de Vibra. El conteo por
// creador vive en el ledger interno (`wallet/ledger.ts`), no en MP. Cada pago se
// liga al ledger vía `external_reference` = `{sourceType}__{sourceId}`.
//
// Moneda: SIEMPRE MXN. Una cuenta MP mexicana solo procesa en MXN (ver
// `lib/currency/catalog.ts`: MXN es el ancla; las demás monedas son visualización).

import * as crypto from "crypto";
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";

// Base de la API REST de Mercado Pago.
export const MP_API_BASE = "https://api.mercadopago.com";

// Secretos (se declaran aquí y se inyectan en cada función que los use).
export const mpAccessToken = defineSecret("MP_ACCESS_TOKEN");
export const mpWebhookSecret = defineSecret("MP_WEBHOOK_SECRET");

/** Toda la contabilidad y el cobro viven en MXN (ancla del catálogo de monedas). */
export const MP_CURRENCY = "MXN" as const;

// ⚠️ SANDBOX: MP exige que el email del pagador termine en "@testuser.com".
// En pruebas forzamos un email de test; en el CORTE A PRODUCCIÓN poner
// MP_SANDBOX = false para usar el email real del comprador.
export const MP_SANDBOX = true;
export const SANDBOX_PAYER_EMAIL = "test@testuser.com";

export type MpFetchResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string };

/**
 * Llamada autenticada a la API de MP. Añade el Bearer token y, opcionalmente,
 * la `X-Idempotency-Key` (la Orders API la usa para no duplicar cargos: encaja
 * con los IDs deterministas del ledger).
 */
export async function mpFetch<T = unknown>(
  path: string,
  init: {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    body?: unknown;
    idempotencyKey?: string;
  } = {}
): Promise<MpFetchResult<T>> {
  const url = path.startsWith("http") ? path : `${MP_API_BASE}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${mpAccessToken.value().trim()}`,
    "Content-Type": "application/json",
  };
  if (init.idempotencyKey) {
    headers["X-Idempotency-Key"] = init.idempotencyKey;
  }

  try {
    const res = await fetch(url, {
      method: init.method ?? "GET",
      headers,
      body: init.body != null ? JSON.stringify(init.body) : undefined,
    });

    const text = await res.text().catch(() => "");
    if (!res.ok) {
      logger.error("mpFetch error", { path, status: res.status, text: text.slice(0, 500) });
      return { ok: false, status: res.status, error: text };
    }

    const data = (text ? JSON.parse(text) : {}) as T;
    return { ok: true, status: res.status, data };
  } catch (err) {
    logger.error("mpFetch failed", {
      path,
      err: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Verifica la firma del webhook de Mercado Pago (anti-suplantación).
 *
 * MP manda dos cabeceras:
 *   x-signature:  "ts=<epoch>,v1=<hmac_hex>"
 *   x-request-id: "<uuid>"
 * y el id del recurso llega como query param `data.id`.
 *
 * El manifiesto a firmar es la plantilla EXACTA de MP:
 *   id:<data.id>;request-id:<x-request-id>;ts:<ts>;
 * HMAC-SHA256 con `MP_WEBHOOK_SECRET`, comparado en tiempo constante contra v1.
 *
 * Nota: si `data.id` es alfanumérico, MP indica usarlo en minúsculas.
 */
export function verifyMpWebhookSignature(params: {
  xSignature: string | undefined;
  xRequestId: string | undefined;
  dataId: string | undefined;
  secret: string;
  /** Ventana anti-replay en segundos (por defecto 5 min). 0 = sin chequeo de tiempo. */
  toleranceSeconds?: number;
}): boolean {
  const { xSignature, xRequestId, dataId, secret } = params;
  if (!xSignature || !dataId) return false;

  // Parse "ts=...,v1=..."
  let ts: string | undefined;
  let v1: string | undefined;
  for (const part of xSignature.split(",")) {
    const [k, val] = part.split("=", 2).map((s) => s?.trim());
    if (k === "ts") ts = val;
    else if (k === "v1") v1 = val;
  }
  if (!ts || !v1) return false;

  // Anti-replay: rechaza firmas con más de N segundos.
  const tolerance = params.toleranceSeconds ?? 300;
  if (tolerance > 0) {
    const tsNum = parseInt(ts, 10);
    if (!Number.isFinite(tsNum)) return false;
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - tsNum) > tolerance) return false;
  }

  const id = /^[a-zA-Z0-9]+$/.test(dataId) ? dataId.toLowerCase() : dataId;
  const manifest = `id:${id};request-id:${xRequestId ?? ""};ts:${ts};`;

  const expected = crypto
    .createHmac("sha256", secret.trim())
    .update(manifest, "utf8")
    .digest("hex");

  try {
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(v1, "utf8");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
