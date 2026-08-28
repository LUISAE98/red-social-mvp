// Comisión y mínimo de retiro por país — BACKEND (autoritativa).
//
// Módulo PURO a propósito (sin firebase-admin, sin imports del proyecto): así se puede
// importar desde el ledger, desde tests y desde cualquier sitio sin arrastrar el Admin SDK.
//
// El frontend tiene un espejo en `lib/wallet/payoutTiers.ts` que solo SIRVE PARA MOSTRAR. Un
// test de paridad compara las dos tablas, porque si se separan el creador ve una cifra y
// cobra otra, que es el peor fallo posible en la wallet.
//
// Fuente de verdad de las cifras y del porqué: `docs/payout-tiers.md`.
//
// ── La regla, en una frase ──────────────────────────────────────────────────────────────
//
// 25% de comisión y retiras desde 300 USD. En los países donde la transferencia bancaria es
// cara, 30% y desde 500 USD.
//
// Lo que separa a los dos grupos no es el porcentaje sino el MÉTODO DE TRANSFERENCIA. La
// transferencia local cuesta 1.50 USD fijos y el mínimo casi no cambia nada —subirlo de 300 a
// 700 ahorra 0.29 puntos—. El wire cuesta 25 USD fijos y ahí el mínimo lo es todo, subirlo de
// 300 a 500 ahorra 3.33 puntos, once veces más. Por eso solo el grupo caro tiene mínimo alto.
//
// ── Reglas de aplicación ────────────────────────────────────────────────────────────────
//
// 🚨 **Decide el país de la CUENTA DE COBRO**, no la residencia fiscal ni la IP. Es el país al
//    que de verdad viaja el dinero, y es lo único que explica el coste.
//
// 🚨 **Un país sin fila NO es 25% por defecto, es NO PAGABLE.** Los 73 países sin ruta de pago
//    tienen que fallar ruidosamente: si cayeran al estándar, el creador vería un 25% y un
//    mínimo alcanzable para un dinero que Global Payouts no le puede mandar.
//
// 🚨 **Al cambiar de nivel se respeta lo ya vendido.** La comisión se CONGELA en el asiento del
//    ledger, igual que las retenciones. Un creador que se muda o cambia de banco conserva la
//    comisión de sus ventas anteriores. Recalcular hacia atrás destruye la confianza y es lo
//    primero que se nota en el saldo.

/** Los dos grupos. No hay más, y añadir un tercero es decisión de producto. */
export type PayoutTier = "standard" | "expensive";

/** Lo que le toca a un creador de un nivel. */
export type PayoutTerms = {
  tier: PayoutTier;
  /** Fracción que se queda Vibra sobre el precio base. 0.25 = 25%. */
  commissionRate: number;
  /** Mínimo acumulado para poder pedir un retiro, en USD. */
  minWithdrawalUsd: number;
};

/**
 * Las dos filas de la tabla.
 *
 * Con estas cifras, lo que le queda a Vibra cae entre 18.14% y 20.10% en los doce niveles de
 * coste de Stripe, contra un rango de once puntos con comisión plana.
 */
export const PAYOUT_TERMS: Readonly<Record<PayoutTier, Readonly<PayoutTerms>>> = {
  standard: { tier: "standard", commissionRate: 0.25, minWithdrawalUsd: 300 },
  expensive: { tier: "expensive", commissionRate: 0.3, minWithdrawalUsd: 500 },
};

/**
 * Lo que se le enseña a un creador que TODAVÍA NO tiene cuenta de cobro.
 *
 * No es un respaldo para países sin fila —esos son no pagables y deben fallar—, es lo que se
 * muestra mientras no se sabe a qué país va a cobrar. En cuanto da de alta su cuenta, manda su
 * país. Ver `payoutTermsOf`, que sí devuelve `null` para lo desconocido.
 */
export const PAYOUT_TERMS_PROVISIONAL: Readonly<PayoutTerms> = PAYOUT_TERMS.standard;

/**
 * Estándar — 25%, mínimo 300 USD (45 países).
 *
 * Transferencia bancaria local, 1.50 USD fijos. Ordenados del más barato al más caro para
 * Vibra, que es como se leen en `docs/payout-tiers.md`.
 */
const STANDARD: readonly string[] = [
  // El más bajo.
  "US",
  // Muy bajo — zona única de pagos en euros.
  "AT", "BE", "BG", "CY", "CZ", "DE", "EE", "ES", "FI", "FR", "GB", "GR",
  "HR", "IE", "IS", "IT", "LT", "LU", "LV", "MT", "NL", "PT", "SI", "SK",
  // Bajo.
  "CA", "HU", "MX", "NO", "SE",
  // Medio.
  "DK", "ID", "JM", "MA", "NZ", "PL", "SG", "TT", "MC", "SM",
  // Medio-alto.
  "RO", "AU", "CR", "DO", "PE",
];

/**
 * Transferencia cara — 30%, mínimo 500 USD (29 países).
 *
 * Solo llega el wire, que cuesta 25 USD fijos. De ahí el mínimo alto: es lo único que diluye
 * un coste fijo tan grande.
 */
const EXPENSIVE: readonly string[] = [
  "EC", "PA", "SV", "HK", "TH", "ZA", "TR",
  "AE", "AG", "AL", "BA", "BN", "BT", "BW", "EG", "GT", "JO", "JP", "KW",
  "LC", "LK", "MD", "MN", "MY", "PH", "QA", "RS", "TW", "VN",
];

/**
 * Sin ruta de pago (73 países).
 *
 * 🔴 **ESTA LISTA ESTÁ MAL (verificado el 2026-08-27).** Se sacó de la cobertura de
 * transferencia local, pero Stripe también hace wire y admite formatos locales (CBU, NUBAN) en
 * países que no aparecen ahí. Contra la API salen **90 pagables y 55 sin ruta**, no 74 y 73:
 * toda Latinoamérica cobra, incluidos Brasil, Argentina, Colombia, Chile y Uruguay.
 *
 * Se deja como está A PROPÓSITO hasta haber probado el alta de punta a punta. Hoy no afecta a
 * nadie porque nadie tiene cuenta de cobro; deja de ser inocuo en cuanto el alta se abra.
 * Plan para cerrarlo en `docs/stripe-integracion.md` §8-octies.8.
 *
 * ⚠️ **Compran y venden, pero Global Payouts no llega.** Se listan a propósito en vez de
 * dejarlos fuera sin más: la diferencia entre «no lo tengo dado de alta» y «no existe forma de
 * pagarle» es justo lo que hay que poder decirle al creador.
 *
 * Incluye Brasil, Argentina, Colombia, Chile, Uruguay, Paraguay, Bolivia, Corea del Sur,
 * Arabia Saudita, Nigeria, Honduras, Nicaragua y Puerto Rico.
 *
 * 🔴 **Decisión pendiente:** o se impide monetizar desde estos países, o se busca otra vía de
 * pago. Hoy un creador brasileño puede vender y acumular saldo que nadie puede sacarle.
 */
export const UNPAYABLE_COUNTRIES: readonly string[] = [
  "AD", "AI", "AR", "AS", "AZ", "BM", "BO", "BQ", "BR", "BZ", "CC", "CI", "CL", "CO", "CX",
  "DM", "EA", "FJ", "FM", "FO", "GD", "GF", "GG", "GI", "GL", "GP", "GU", "HN", "HT", "IC",
  "JE", "KH", "KI", "KN", "KR", "KY", "ME", "MH", "MP", "MQ", "MS", "MV", "NC", "NF", "NG",
  "NI", "NP", "NR", "NU", "PF", "PG", "PM", "PN", "PR", "PY", "RE", "SA", "SB", "SJ", "SR",
  "TC", "TK", "TO", "TV", "UY", "VA", "VC", "VG", "VI", "VU", "WF", "WS", "YT",
];

/** País → nivel. Se arma de las dos listas para que no se puedan desincronizar. */
export const PAYOUT_TIER_BY_COUNTRY: Readonly<Record<string, PayoutTier>> = Object.freeze(
  Object.fromEntries([
    ...STANDARD.map((c) => [c, "standard" as PayoutTier]),
    ...EXPENSIVE.map((c) => [c, "expensive" as PayoutTier]),
  ])
);

/**
 * Qué comisión y qué mínimo le tocan a una cuenta de cobro de ese país.
 *
 * Devuelve `null` cuando no hay ruta de pago o el país es desconocido. **`null` no es cero ni
 * es el estándar**: quien llame tiene que decidir qué hacer, y lo correcto casi siempre es no
 * dejar retirar y explicar por qué.
 */
export function payoutTermsOf(country: string | null | undefined): Readonly<PayoutTerms> | null {
  const key = (country ?? "").trim().toUpperCase();
  if (!key) return null;
  const tier = PAYOUT_TIER_BY_COUNTRY[key];
  return tier ? PAYOUT_TERMS[tier] : null;
}

/** ¿Global Payouts llega a ese país? */
export function isPayableCountry(country: string | null | undefined): boolean {
  return payoutTermsOf(country) != null;
}

/**
 * ¿El país está en la lista de los que venden pero no cobran?
 *
 * Distinto de `!isPayableCountry`, que también es cierto para un país que no existe o que
 * llegó vacío. Este responde «sí, lo conocemos, y no hay forma de pagarle».
 */
export function isKnownUnpayableCountry(country: string | null | undefined): boolean {
  const key = (country ?? "").trim().toUpperCase();
  return key ? UNPAYABLE_COUNTRIES.includes(key) : false;
}
