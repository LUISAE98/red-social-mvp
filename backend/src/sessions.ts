// Enriquecimiento de ubicación de sesiones activas.
//
// El registro de la sesión ocurre en el cliente (rápido, sin latencia). Esta
// Cloud Function callable resuelve la ciudad/país reales a partir de la IP del
// request y actualiza el documento de la sesión. Se invoca UNA sola vez, cuando
// la sesión se crea (no en cada heartbeat), así que el volumen es bajo.
//
// Fuente geo-IP: ipwho.is — gratuita, sin API key, HTTPS. Mismo criterio que
// exchangeRates.ts (fuente gratuita sin clave). Si a futuro se necesita mayor
// volumen o SLA, se puede cambiar por un proveedor con key sin tocar el cliente.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

const GEO_URL = (ip: string) => `https://ipwho.is/${encodeURIComponent(ip)}`;

type GeoResult = {
  city: string | null;
  country: string | null;
  locationLabel: string | null;
};

/** Extrae la IP del cliente del request HTTP subyacente. */
function extractClientIp(rawRequest: {
  ip?: string;
  headers?: Record<string, unknown>;
}): string | null {
  const forwarded = rawRequest.headers?.["x-forwarded-for"];

  if (typeof forwarded === "string" && forwarded.trim()) {
    // Puede venir como "clienteIP, proxy1, proxy2"; nos quedamos con la primera.
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  if (typeof rawRequest.ip === "string" && rawRequest.ip.trim()) {
    return rawRequest.ip.trim();
  }

  return null;
}

/** IPs privadas/locales/de loopback para las que no tiene sentido geolocalizar. */
function isNonPublicIp(ip: string): boolean {
  return (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    ip.startsWith("172.16.") ||
    ip.startsWith("172.17.") ||
    ip.startsWith("172.18.") ||
    ip.startsWith("172.19.") ||
    ip.startsWith("172.2") ||
    ip.startsWith("172.30.") ||
    ip.startsWith("172.31.") ||
    ip.startsWith("fc") ||
    ip.startsWith("fd") ||
    ip.startsWith("fe80")
  );
}

async function lookupGeo(ip: string): Promise<GeoResult | null> {
  try {
    const res = await fetch(GEO_URL(ip));
    if (!res.ok) return null;

    const data = (await res.json()) as {
      success?: boolean;
      city?: unknown;
      country?: unknown;
    };

    if (data.success === false) return null;

    const city =
      typeof data.city === "string" && data.city.trim()
        ? data.city.trim()
        : null;
    const country =
      typeof data.country === "string" && data.country.trim()
        ? data.country.trim()
        : null;

    if (!city && !country) return null;

    const locationLabel = [city, country].filter(Boolean).join(", ") || null;

    return { city, country, locationLabel };
  } catch (error) {
    logger.warn("geo lookup failed", { error: String(error) });
    return null;
  }
}

export const enrichSessionLocation = onCall(
  { region: "us-central1" },
  async (request) => {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError(
        "unauthenticated",
        "Debes iniciar sesión."
      );
    }

    const sessionId =
      typeof request.data?.sessionId === "string"
        ? request.data.sessionId.trim()
        : "";

    if (!sessionId) {
      throw new HttpsError("invalid-argument", "sessionId requerido.");
    }

    const ref = db.doc(`users/${uid}/sessions/${sessionId}`);
    const snap = await ref.get();

    // Si el doc no existe, no hay nada que enriquecer (lo crea el cliente).
    if (!snap.exists) {
      return { ok: false, reason: "not_found" };
    }

    const ip = extractClientIp(request.rawRequest);

    if (!ip || isNonPublicIp(ip)) {
      return { ok: false, reason: "no_public_ip" };
    }

    const geo = await lookupGeo(ip);

    if (!geo) {
      return { ok: false, reason: "geo_unavailable" };
    }

    await ref.update({
      city: geo.city,
      country: geo.country,
      locationLabel: geo.locationLabel,
      geoUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { ok: true, locationLabel: geo.locationLabel };
  }
);

/**
 * Cierra la sesión en TODOS los dispositivos, de verdad.
 *
 * Antes "revocar" solo escribía `revoked: true` en Firestore, y nadie del lado
 * del servidor miraba ese campo: el único que reaccionaba era el JavaScript de
 * la propia app. Contra la amenaza real —alguien que se llevó el token y usa el
 * SDK directamente— eso no hacía absolutamente nada. Encima el cliente podía
 * reescribir el campo, y `registerSession` lo limpiaba en cada arranque.
 *
 * `revokeRefreshTokens` sí invalida las credenciales en Firebase Auth. Es la
 * ÚNICA revocación real que ofrece Firebase, y es por usuario: no existe forma
 * de matar un dispositivo suelto sin Identity Platform y verificación de sesión
 * en servidor. Por eso esto cierra todo, incluido el dispositivo que lo pide, y
 * la interfaz lo dice claramente.
 */
export const revokeAllSessions = onCall(
  { region: "us-central1" },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
    }
    // Un invitado de compra no tiene panel de sesiones que cerrar.
    if (request.auth?.token?.firebase?.sign_in_provider === "anonymous") {
      throw new HttpsError("permission-denied", "Las cuentas de invitado no tienen sesiones.");
    }

    // 1. Invalida los refresh tokens. A partir de aquí ningún dispositivo puede
    //    acuñar tokens nuevos; los ID tokens ya emitidos caducan en ~1h, que es
    //    el límite propio de un JWT sin estado.
    await admin.auth().revokeRefreshTokens(uid);

    // 2. Marca los documentos para que la interfaz refleje el cierre y los
    //    clientes vivos se desconecten sin esperar a que caduque su token.
    const snap = await db.collection(`users/${uid}/sessions`).get();
    const now = admin.firestore.FieldValue.serverTimestamp();
    let revoked = 0;

    let batch = db.batch();
    let pending = 0;
    for (const docSnap of snap.docs) {
      if (docSnap.get("revoked") === true) continue;
      batch.update(docSnap.ref, { revoked: true, revokedAt: now });
      revoked += 1;
      pending += 1;
      if (pending >= 400) {
        await batch.commit();
        batch = db.batch();
        pending = 0;
      }
    }
    if (pending > 0) await batch.commit();

    logger.info("revokeAllSessions", { uid, revoked });
    return { ok: true, revoked };
  }
);
