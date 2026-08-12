// Determinación SERVER-AUTHORITATIVE del país fiscal del comprador.
//
// ⚠️ POR QUÉ EXISTE ESTE ARCHIVO
// Antes el país fiscal llegaba en el payload del callable (`data.taxCountry`), o sea que lo
// elegía el cliente. Eso era inofensivo mientras México fuera el ÚNICO país configurado: cualquier
// otro valor no tenía fila en la tabla y `isChargeableCountry` lo rechazaba.
//
// En el momento en que existe un segundo país —y más si su impuesto lo recauda un tercero— ese
// accidente deja de protegernos: un comprador mexicano manda el ISO de otro país, pasa la
// validación y paga menos IVA del que debe. Quien responde ante el SAT por ese IVA es Vibra.
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

/** Nombre de cada indicio, para poder decir CUÁL resolvió el país. */
export type IndicioName = "billingAddress" | "cardCountry" | "ipCountry" | "phoneCountry";

export type ResolvedTaxCountry = {
  /** País fiscal que manda para el cobro. */
  country: string;
  /** Qué señal lo decidió (para auditoría). */
  source:
    | "mx_rule" // algún indicio apuntaba a México (Art. 18-C)
    | "agreement" // IP y tarjeta coincidían
    | "tiebreak" // discrepaban y un tercer indicio desempató
    | "card_bin" // solo había tarjeta, o discrepaban sin desempate
    | "ip" // solo había IP
    | "default"; // sin señal utilizable
  indicios: CountryIndicios;
  /** true si IP y tarjeta apuntaban a países distintos. */
  hadConflict: boolean;
  /** Qué indicios apuntan al país elegido. Es la EVIDENCIA que exige el Art. 24b. */
  agreeingIndicios: IndicioName[];
  /**
   * ¿Se cumple la regla europea de **dos pruebas no contradictorias** (Art. 24b del
   * Reglamento de Ejecución del IVA)? Es decir, ≥2 indicios apuntando al mismo país.
   *
   * Con ventas B2C a la UE por debajo de **100,000 EUR** (año actual + anterior) basta UNA
   * prueba, así que `false` no bloquea nada hoy. Por encima de ese umbral sí es obligatorio,
   * y este campo queda registrado en el paymentIntent para poder demostrarlo.
   */
  meetsTwoEvidenceRule: boolean;
  /** Qué indicio rompió el empate cuando IP y tarjeta discrepaban. */
  conflictResolvedBy: IndicioName | null;
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

/**
 * 🚨 SUBDIVISIONES QUE TRIBUTAN DISTINTO QUE SU PAÍS 🚨
 *
 * Algunos territorios pertenecen a un Estado pero están FUERA de su régimen de IVA, y la
 * geolocalización los devuelve con el código de país del Estado. Sin esta corrección se les
 * cobra el impuesto equivocado: a un comprador en Tenerife se le cobraba 21% de IVA español
 * cuando le corresponde IGIC 7% —y encima a otro fisco—.
 *
 * La clave es `PAÍS-SUBDIVISIÓN` en ISO 3166-2. El valor es el código con el que debe
 * resolverse para efectos fiscales.
 *
 *   ES-CN → IC   Canarias (IGIC 7%, umbral €100.000)
 *   ES-CE → EA   Ceuta (IPSI)
 *   ES-ML → EA   Melilla (IPSI)
 *
 * ⚠️ Guayana Francesa, Mayotte, Guadalupe, Martinica y Reunión NO están aquí: tienen código
 *    ISO de PAÍS propio (GF, YT, GP, MQ, RE) y se resuelven solos.
 * ⚠️ Åland (FI-01) se dejó fuera a propósito: su régimen no está resuelto. Ver impuestos.md §6.12.
 *
 * ⚠️ Este mapa está DUPLICADO en el frontend (lib/tax/subdivisions.ts) porque el backend no
 *    puede importar de lib/. Hay un test de paridad.
 */
export const SUBDIVISION_TAX_OVERRIDES: Readonly<Record<string, string>> = {
  "ES-CN": "IC",
  "ES-CE": "EA",
  "ES-ML": "EA",
};

/**
 * Aplica la corrección por subdivisión. Devuelve el país fiscal correcto, o el original si
 * esa subdivisión no tributa distinto.
 */
export function applySubdivisionOverride(
  country: string | null | undefined,
  region: string | null | undefined
): string | null {
  const c = (country ?? '').trim().toUpperCase();
  if (!c) return null;
  const r = (region ?? '').trim().toUpperCase();
  if (!r) return c;
  return SUBDIVISION_TAX_OVERRIDES[`${c}-${r}`] ?? c;
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

    const data = (await res.json()) as {
      success?: boolean;
      country_code?: unknown;
      region_code?: unknown;
    };
    if (data.success === false) return null;

    const country = normalizeCountry(data.country_code);
    if (!country) return null;

    // ipwho.is devuelve la subdivisión en `region_code`. Se usa para corregir los
    // territorios que tributan distinto que su país (Canarias, Ceuta, Melilla).
    const region = typeof data.region_code === "string" ? data.region_code : null;
    return applySubdivisionOverride(country, region);
  } catch {
    // La geolocalización no debe tumbar un cobro: si falla, caemos al default.
    return null;
  }
}

/**
 * Resuelve el país fiscal a partir de los indicios.
 *
 * REGLA (ver impuestos.md §3.3):
 *   1. Si CUALQUIER indicio apunta a México → México (Art. 18-C: basta uno). Solo México.
 *   2. Si IP y tarjeta coinciden → ese país. Dos pruebas no contradictorias.
 *   3. Si DISCREPAN → desempata un tercer indicio (dirección de facturación, luego teléfono).
 *      Sin desempate, gana la tarjeta y queda marcado `meetsTwoEvidenceRule: false`.
 *   4. Solo tarjeta → tarjeta. Solo IP → IP. Nada → default MX (conservador).
 *
 * Dos marcos legales conviven aquí:
 *  · **México, Art. 18-C LIVA:** basta UN indicio hacia territorio nacional. Por eso el
 *    paso 1 es tan agresivo — ante la duda se cobra el IVA en vez de omitirlo.
 *  · **UE, Art. 24b del Reglamento de Ejecución:** exige DOS pruebas no contradictorias.
 *    Por eso el paso 3 desempata en vez de elegir una señal en silencio. (Con ventas B2C
 *    a la UE bajo 100,000 EUR basta una prueba, así que hoy no bloquea nada.)
 */
export function resolveTaxCountryFromIndicios(
  indicios: CountryIndicios
): ResolvedTaxCountry {
  const normalized: Record<IndicioName, string | null> = {
    billingAddress: normalizeCountry(indicios.billingAddress),
    cardCountry: normalizeCountry(indicios.cardCountry),
    ipCountry: normalizeCountry(indicios.ipCountry),
    phoneCountry: normalizeCountry(indicios.phoneCountry),
  };

  const ipCountry = normalized.ipCountry;
  const cardCountry = normalized.cardCountry;
  const hadConflict = !!ipCountry && !!cardCountry && ipCountry !== cardCountry;

  /** Qué indicios apuntan a `country`. Es la evidencia que pide el Art. 24b. */
  const agreeingFor = (country: string): IndicioName[] =>
    (Object.keys(normalized) as IndicioName[]).filter((k) => normalized[k] === country);

  const build = (
    country: string,
    source: ResolvedTaxCountry["source"],
    conflictResolvedBy: IndicioName | null = null
  ): ResolvedTaxCountry => {
    const agreeingIndicios = agreeingFor(country);
    return {
      country,
      source,
      indicios,
      hadConflict,
      agreeingIndicios,
      meetsTwoEvidenceRule: agreeingIndicios.length >= 2,
      conflictResolvedBy,
    };
  };

  // 1. Regla especial de México (Art. 18-C): basta que UN indicio apunte a territorio
  //    nacional para considerar al receptor mexicano. Es deliberadamente conservadora —
  //    ante la duda se cobra el 16% en vez de omitirlo— y aplica SOLO a México.
  if (Object.values(normalized).includes("MX")) {
    return build("MX", "mx_rule");
  }

  // 2. IP y tarjeta coinciden → dos pruebas NO contradictorias. Es el caso ideal del
  //    Art. 24b y no necesita nada más.
  if (ipCountry && cardCountry && ipCountry === cardCountry) {
    return build(ipCountry, "agreement");
  }

  // 3. IP y tarjeta DISCREPAN. Para la UE eso es evidencia contradictoria: no se puede
  //    elegir una y seguir. Se busca un TERCER indicio que desempate, y con él vuelven a
  //    existir dos pruebas coincidentes.
  if (hadConflict) {
    for (const tiebreaker of ["billingAddress", "phoneCountry"] as const) {
      const value = normalized[tiebreaker];
      if (!value) continue;
      if (value === ipCountry) return build(ipCountry, "tiebreak", tiebreaker);
      if (value === cardCountry) return build(cardCountry, "tiebreak", tiebreaker);
    }
    // Sin desempate: gana la tarjeta (el indicio más difícil de falsificar). Queda
    // marcado con `meetsTwoEvidenceRule: false` para poder detectarlo en auditoría.
    return build(cardCountry!, "card_bin");
  }

  // 4. Solo hay tarjeta.
  if (cardCountry) return build(cardCountry, "card_bin");

  // 5. Fase de display: solo hay IP.
  if (ipCountry) return build(ipCountry, "ip");

  // 6. Sin señal utilizable.
  return build(DEFAULT_COUNTRY, "default");
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
 * No se puede cobrar en un país sin ficha, o donde el fisco EXIGE un alta que Vibra no tiene
 * (`registrationStatus: "cannot_sell"`). El llamador decide si rechaza la operación o la
 * trata como doméstica.
 */
export function chargeableOrNull(resolved: ResolvedTaxCountry): string | null {
  return isChargeableCountry(resolved.country) ? resolved.country : null;
}
