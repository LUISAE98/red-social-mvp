// Determinación SERVER-AUTHORITATIVE del país fiscal del comprador.
//
// ⚠️ POR QUÉ EXISTE ESTE ARCHIVO
// Antes el país fiscal llegaba en el payload del callable (`data.taxCountry`), o sea que lo
// elegía el cliente. Eso era inofensivo mientras México fuera el ÚNICO país configurado: cualquier
// otro valor no tenía fila en la tabla y `isChargeableCountry` lo rechazaba.
//
// En el momento en que existe un segundo país —y más si su impuesto es 0, como Argentina— ese
// accidente deja de protegernos: un comprador mexicano manda `taxCountry: "AR"`, pasa la
// validación y paga 0% en vez de 16%. Quien responde ante el SAT por ese IVA es Vibra.
//
// Desde aquí el país lo decide SIEMPRE el servidor, con dos señales que el cliente no controla:
// la IP del request y el país emisor de la tarjeta (BIN) que reporta Stripe.
//
// Base legal: Art. 18-C LIVA — el receptor se considera en territorio nacional cuando su domicilio
// declarado, el intermediario de pago, la IP o el código telefónico apuntan a México.
// Ficha y reglas: `impuestos.md` §3.

import { isChargeableCountry } from "./config";

/** País de liquidación / fallback cuando no hay señal utilizable. */
const DEFAULT_COUNTRY = "MX";

const GEO_URL = (ip: string) => `https://ipwho.is/${encodeURIComponent(ip)}`;

/** Los 4 indicios del Art. 18-C. Se guardan TODOS en el paymentIntent como evidencia. */
export type CountryIndicios = {
  /** País del domicilio de facturación declarado (Stripe). */
  billingAddress: string | null;
  /** País emisor de la tarjeta (BIN). La señal más difícil de falsificar. */
  cardCountry: string | null;
  /** País de la IP del request, resuelto en el servidor. */
  ipCountry: string | null;
  /** País del código telefónico del perfil. */
  phoneCountry: string | null;
};

export type ResolvedTaxCountry = {
  /** País fiscal que manda para el cobro. */
  country: string;
  /** Qué señal lo decidió (para auditoría). */
  source: "mx_ip_rule" | "card_bin" | "ip" | "default";
  indicios: CountryIndicios;
  /** true si IP y tarjeta apuntaban a países distintos. */
  hadConflict: boolean;
};

function normalizeCountry(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(clean) ? clean : null;
}

/** Extrae la IP del cliente del request HTTP subyacente del callable. */
export function extractClientIp(rawRequest: {
  ip?: string;
  headers?: Record<string, unknown>;
}): string | null {
  const forwarded = rawRequest?.headers?.["x-forwarded-for"];

  if (typeof forwarded === "string" && forwarded.trim()) {
    // Puede venir como "clienteIP, proxy1, proxy2"; nos quedamos con la primera.
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  if (typeof rawRequest?.ip === "string" && rawRequest.ip.trim()) {
    return rawRequest.ip.trim();
  }

  return null;
}

/** IPs privadas/locales para las que no tiene sentido geolocalizar (emulador, red interna). */
function isNonPublicIp(ip: string): boolean {
  return (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    ip.startsWith("172.") ||
    ip.startsWith("fc") ||
    ip.startsWith("fd") ||
    ip.startsWith("fe80")
  );
}

/** País ISO-2 de una IP, o null si no se pudo resolver. Nunca lanza. */
export async function countryFromIp(ip: string | null): Promise<string | null> {
  if (!ip || isNonPublicIp(ip)) return null;

  try {
    const res = await fetch(GEO_URL(ip));
    if (!res.ok) return null;

    const data = (await res.json()) as { success?: boolean; country_code?: unknown };
    if (data.success === false) return null;

    return normalizeCountry(data.country_code);
  } catch {
    // La geolocalización no debe tumbar un cobro: si falla, caemos al default.
    return null;
  }
}

/**
 * Resuelve el país fiscal a partir de los indicios.
 *
 * REGLA (decidida 2026-08-07, ver impuestos.md §3.3):
 *   1. Si la IP es de México → México. El servicio se aprovecha en México, así que manda
 *      aunque la tarjeta sea extranjera. Esta excepción aplica SOLO a México.
 *   2. Si hay país de tarjeta → gana la tarjeta. Es el indicio más difícil de falsificar.
 *   3. Si no hay tarjeta todavía (fase de display) → manda la IP.
 *   4. Si nada resuelve → default MX (conservador: cobra el 16%).
 *
 * Es deliberadamente conservadora hacia México: ante la duda se cobra IVA en vez de omitirlo.
 */
export function resolveTaxCountryFromIndicios(
  indicios: CountryIndicios
): ResolvedTaxCountry {
  const ipCountry = normalizeCountry(indicios.ipCountry);
  const cardCountry = normalizeCountry(indicios.cardCountry);
  const hadConflict = !!ipCountry && !!cardCountry && ipCountry !== cardCountry;

  // 1. Regla especial de México: la IP mexicana gana siempre.
  if (ipCountry === "MX") {
    return { country: "MX", source: "mx_ip_rule", indicios, hadConflict };
  }

  // 2. Con tarjeta conocida, gana la tarjeta.
  if (cardCountry) {
    return { country: cardCountry, source: "card_bin", indicios, hadConflict };
  }

  // 3. Fase de display: solo hay IP.
  if (ipCountry) {
    return { country: ipCountry, source: "ip", indicios, hadConflict };
  }

  // 4. Sin señal utilizable.
  return { country: DEFAULT_COUNTRY, source: "default", indicios, hadConflict };
}

/**
 * Resuelve el país fiscal para un cobro, leyendo la IP del request en el servidor.
 * `cardCountry` viene de Stripe (`payment_method.card.country`) y es null en la fase de display.
 *
 * ⚠️ NO acepta un país propuesto por el cliente. Es intencional.
 */
export async function resolveTaxCountry(params: {
  rawRequest: { ip?: string; headers?: Record<string, unknown> };
  cardCountry?: string | null;
  billingCountry?: string | null;
  phoneCountry?: string | null;
}): Promise<ResolvedTaxCountry> {
  const ip = extractClientIp(params.rawRequest);
  const ipCountry = await countryFromIp(ip);

  return resolveTaxCountryFromIndicios({
    billingAddress: normalizeCountry(params.billingCountry),
    cardCountry: normalizeCountry(params.cardCountry),
    ipCountry,
    phoneCountry: normalizeCountry(params.phoneCountry),
  });
}

/**
 * País fiscal listo para cobrar, o el default si el resuelto no es cobrable.
 * Un país sin ficha (o con `collectionMode: "none"`) no puede cobrarse: el llamador decide
 * si rechaza la operación o la trata como doméstica.
 */
export function chargeableOrNull(resolved: ResolvedTaxCountry): string | null {
  return isChargeableCountry(resolved.country) ? resolved.country : null;
}
