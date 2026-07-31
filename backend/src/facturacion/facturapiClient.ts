// Cliente único de Facturapi (CFDI 4.0 — timbrado de facturas y comprobantes).
//
// Fuente única de acceso a Facturapi para todo el backend. Las credenciales viven
// en Firebase Secrets (nunca hardcodeadas), igual que Mercado Pago y Didit.
//
// MODELO VENDEDOR DIRECTO (ver docs/legal/fiscal-iva-isr-plataforma.md §0.6):
//   - Vibra → Comprador (factura de venta): se timbra con la ORG de Vibra (secret key).
//   - Creador → Vibra (factura de proveedor, self-billing): una ORG por creador,
//     administradas con la USER key (multi-tenant). Cada creador sube su CSD.
//
// Facturapi es AGNÓSTICO de la procesadora de pago (MP hoy, Pagsmile/EBANX mañana):
// solo emite comprobantes; el disparo se engancha al evento interno del ledger.
//
// Autenticación Facturapi: HTTP Basic con la API key como usuario y password vacío.
// El MODO (prueba/producción) lo define el TIPO de llave: `sk_test_...` = prueba
// (sellos de prueba, sin CSD real), `sk_live_...` = producción.

import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";

/** Base de la API REST de Facturapi (CFDI 4.0). */
export const FACTURAPI_API_BASE = "https://www.facturapi.io/v2";

// Secretos.
//  - FACTURAPI_TEST_KEY: secret key de la ORG de Vibra en modo PRUEBA (sk_test_...).
//  - FACTURAPI_USER_KEY: llave de USUARIO (nivel cuenta) para administrar las
//    ORGANIZACIONES de los creadores (multi-tenant): crear org, subir CSD, etc.
//  - (cutover) FACTURAPI_LIVE_KEY se agrega en producción (Bloque 6).
export const facturapiTestKey = defineSecret("FACTURAPI_TEST_KEY");
export const facturapiUserKey = defineSecret("FACTURAPI_USER_KEY");

/** Qué credencial usar: la de la organización (emitir) o la de usuario (multi-tenant). */
export type FacturapiAuth = "secret" | "user";

export type FacturapiFetchResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string };

function keyFor(auth: FacturapiAuth): string {
  const raw = auth === "user" ? facturapiUserKey.value() : facturapiTestKey.value();
  return (raw ?? "").trim();
}

/** Facturapi usa Basic Auth: la API key como usuario, password vacío. */
function basicAuthHeader(key: string): string {
  return "Basic " + Buffer.from(`${key}:`).toString("base64");
}

/**
 * Llamada autenticada a la API de Facturapi. `auth` elige la credencial:
 *   - "secret" (default): secret key de la organización (emitir CFDI en esa org).
 *   - "user": llave de usuario (administrar organizaciones — multi-tenant).
 */
export async function facturapiFetch<T = unknown>(
  path: string,
  init: {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    body?: unknown;
    auth?: FacturapiAuth;
  } = {}
): Promise<FacturapiFetchResult<T>> {
  const auth = init.auth ?? "secret";
  const key = keyFor(auth);
  if (!key) {
    return {
      ok: false,
      status: 0,
      error: `Falta el secreto de Facturapi (${auth === "user" ? "FACTURAPI_USER_KEY" : "FACTURAPI_TEST_KEY"}).`,
    };
  }

  const url = path.startsWith("http") ? path : `${FACTURAPI_API_BASE}${path}`;
  const headers: Record<string, string> = {
    Authorization: basicAuthHeader(key),
    "Content-Type": "application/json",
  };

  try {
    const res = await fetch(url, {
      method: init.method ?? "GET",
      headers,
      body: init.body != null ? JSON.stringify(init.body) : undefined,
    });

    const text = await res.text().catch(() => "");
    if (!res.ok) {
      logger.error("facturapiFetch error", { path, status: res.status, text: text.slice(0, 500) });
      return { ok: false, status: res.status, error: text };
    }

    const data = (text ? JSON.parse(text) : {}) as T;
    return { ok: true, status: res.status, data };
  } catch (err) {
    logger.error("facturapiFetch failed", {
      path,
      err: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Subida multipart/form-data (para el CSD: cer/key/password). No fija Content-Type
 * a mano: `fetch` lo pone con el boundary correcto a partir del FormData.
 */
export async function facturapiUpload<T = unknown>(
  path: string,
  form: FormData,
  init: { method?: "POST" | "PUT"; auth?: FacturapiAuth } = {}
): Promise<FacturapiFetchResult<T>> {
  const auth = init.auth ?? "user";
  const key = keyFor(auth);
  if (!key) {
    return {
      ok: false,
      status: 0,
      error: `Falta el secreto de Facturapi (${auth === "user" ? "FACTURAPI_USER_KEY" : "FACTURAPI_TEST_KEY"}).`,
    };
  }

  const url = path.startsWith("http") ? path : `${FACTURAPI_API_BASE}${path}`;
  try {
    const res = await fetch(url, {
      method: init.method ?? "PUT",
      headers: { Authorization: basicAuthHeader(key) },
      body: form,
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      logger.error("facturapiUpload error", { path, status: res.status, text: text.slice(0, 500) });
      return { ok: false, status: res.status, error: text };
    }
    const data = (text ? JSON.parse(text) : {}) as T;
    return { ok: true, status: res.status, data };
  } catch (err) {
    logger.error("facturapiUpload failed", {
      path,
      err: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Descarga un endpoint BINARIO de Facturapi (PDF/XML de una factura) y lo devuelve
 * en base64. `facturapiFetch` no sirve aquí porque parsea texto/JSON.
 */
export async function facturapiDownload(
  path: string,
  init: { auth?: FacturapiAuth } = {}
): Promise<FacturapiFetchResult<string>> {
  const auth = init.auth ?? "secret";
  const key = keyFor(auth);
  if (!key) {
    return { ok: false, status: 0, error: `Falta el secreto de Facturapi (${auth === "user" ? "FACTURAPI_USER_KEY" : "FACTURAPI_TEST_KEY"}).` };
  }
  const url = path.startsWith("http") ? path : `${FACTURAPI_API_BASE}${path}`;
  try {
    const res = await fetch(url, { method: "GET", headers: { Authorization: basicAuthHeader(key) } });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.error("facturapiDownload error", { path, status: res.status, text: text.slice(0, 500) });
      return { ok: false, status: res.status, error: text };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return { ok: true, status: res.status, data: buf.toString("base64") };
  } catch (err) {
    logger.error("facturapiDownload failed", { path, err: err instanceof Error ? err.message : String(err) });
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

/** true si la secret key de la organización es de PRUEBA (sk_test_...). */
export function isFacturapiTestMode(): boolean {
  return keyFor("secret").startsWith("sk_test");
}
