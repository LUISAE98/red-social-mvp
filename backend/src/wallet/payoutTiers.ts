// Comisión y mínimo de retiro por país — BACKEND (autoritativa).
//
// Módulo PURO a propósito (sin firebase-admin, sin imports del proyecto): así se puede
// importar desde el ledger, desde tests y desde cualquier sitio sin arrastrar el Admin SDK.
//
// El frontend tiene un espejo en `lib/wallet/payoutTiers.ts` que solo SIRVE PARA MOSTRAR. Un
// test de paridad compara las dos tablas, porque si se separan el creador ve una cifra y
// cobra otra, que es el peor fallo posible en la wallet.
//
// Fuente de verdad de las cifras: `docs/payout-tiers.md`. La clasificación de cada país sale
// de la **tabla oficial de países-destino de Stripe** (Global Payouts → Create recipients →
// Requirements for supported recipient countries), para un remitente en Estados Unidos.
//
// ⚠️ **NO se deduce de `bank_account_spec`.** Ese endpoint devuelve el FORMATO de cuenta de un
// país —para validar los campos del formulario— y responde para países a los que Stripe no
// puede pagar. Leerlo como cobertura de pago fue un error real (2026-08-27): daba por pagables
// a Brasil, Argentina, Colombia, Chile y Uruguay, que no lo son.
//
// ── La regla, en una frase ──────────────────────────────────────────────────────────────
//
// 25% de comisión y retiras desde 300 USD. En los países donde solo llega el wire, 30% y desde
// 500 USD.
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
// 🚨 **Un país sin fila NO es 25% por defecto, es NO PAGABLE.** Los 64 países sin ruta de pago
//    tienen que fallar ruidosamente: si cayeran al estándar, el creador vería un 25% y un
//    mínimo alcanzable para un dinero que Global Payouts no le puede mandar.
//
// 🚨 **Esto NO toca los impuestos.** Los 64 sin ruta siguen VENDIENDO y siguen pagando el
//    impuesto de su país. Lo que no pueden es cobrar. La tabla fiscal (`tax/config.ts`) sigue
//    teniendo sus 147 países y no se le quita ninguno.
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
 * Territorios que cobran con la cuenta bancaria de OTRO país.
 *
 * Stripe no los lista como destino propio, pero su sistema bancario es el de la metrópoli: un
 * creador en Puerto Rico abre una cuenta estadounidense con su routing number, y uno en
 * Canarias usa un IBAN español. Sin este mapeo se les trataría como no pagables, que es falso.
 *
 * ⚠️ `IC` y `EA` ni siquiera son ISO 3166: son códigos internos de la UE para Canarias y para
 * Ceuta y Melilla. Vienen de la tabla fiscal, donde existen porque su IVA es distinto al
 * peninsular. Aquí se resuelven a España, que es de donde es su banco.
 */
export const PAYOUT_COUNTRY_ALIAS: Readonly<Record<string, string>> = {
  // Territorios de Estados Unidos: bancos estadounidenses.
  PR: "US",
  VI: "US",
  // España: IBAN español.
  IC: "ES",
  EA: "ES",
};

/**
 * Estándar — 25%, mínimo 300 USD (46 países).
 *
 * Transferencia bancaria local, 1.50 USD fijos.
 */
const STANDARD: readonly string[] = [
  "MX", "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU",
  "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK", "CR", "DO",
  "NO", "IS", "AU", "ID", "NZ", "SG", "CA", "US", "PE", "GB", "MA", "TT", "JM", "MC", "SM",
  "CI",
];

/**
 * Transferencia cara — 30%, mínimo 500 USD (33 países).
 *
 * Solo llega el wire, que cuesta 25 USD fijos. De ahí el mínimo alto: es lo único que diluye
 * un coste fijo tan grande.
 */
const EXPENSIVE: readonly string[] = [
  "EC", "SV", "GT", "PA", "BA", "HK", "QA", "KW", "JP", "MY", "PH", "TH", "JO", "TW", "ZA",
  "EG", "TR", "RS", "AL", "MD", "VN", "AE", "LC", "AG", "LK", "BT", "BN", "MN", "BW", "AR",
  "CO", "NG", "KH",
];

/**
 * Sin ruta de pago (64 países).
 *
 * ⚠️ **Compran y venden, pero Global Payouts no llega.** Se listan a propósito en vez de
 * dejarlos fuera sin más: la diferencia entre «no lo tengo dado de alta» y «no existe forma de
 * pagarle» es justo lo que hay que poder decirle al creador.
 *
 * Los únicos con mercado real son **Brasil, Argentina, Colombia, Chile, Uruguay, Paraguay,
 * Bolivia, Corea del Sur, Nigeria, Arabia Saudita, Nepal, Haití y Papúa Nueva Guinea**. El
 * resto son islas y territorios de menos de cien mil habitantes.
 *
 * 🔴 **Decisión pendiente:** o se impide monetizar desde estos países, o se busca otra vía de
 * pago. Hoy un creador brasileño puede vender y acumular saldo que nadie puede sacarle. Se le
 * avisa en Finanzas y el gate no le abre, pero avisar no es resolver.
 */
export const UNPAYABLE_COUNTRIES: readonly string[] = [
  "PY", "BO", "HN", "NI", "GU", "PG", "NC", "FJ", "BR", "CL", "UY", "ME", "KR", "SA", "PF",
  "TO", "SB", "VU", "WS", "KI", "NR", "TV", "NU", "WF", "FM", "MH", "AS", "MP", "SR", "BZ",
  "GD", "KY", "BM", "TC", "VG", "HT", "BQ", "VC", "KN", "DM", "AI", "MS", "GL", "PM", "JE",
  "AD", "FO", "GI", "VA", "GG", "SJ", "AZ", "NP", "MV", "NF", "CX", "CC", "TK", "PN", "GF",
  "YT", "GP", "MQ", "RE",
];

/** País → nivel. Se arma de las dos listas para que no se puedan desincronizar. */
export const PAYOUT_TIER_BY_COUNTRY: Readonly<Record<string, PayoutTier>> = Object.freeze(
  Object.fromEntries([
    ...STANDARD.map((c) => [c, "standard" as PayoutTier]),
    ...EXPENSIVE.map((c) => [c, "expensive" as PayoutTier]),
  ])
);

/** Resuelve un territorio a la matriz cuyo banco usa. Lo demás pasa tal cual. */
export function resolvePayoutCountry(country: string | null | undefined): string {
  const key = (country ?? "").trim().toUpperCase();
  return PAYOUT_COUNTRY_ALIAS[key] ?? key;
}

/**
 * Qué comisión y qué mínimo le tocan a una cuenta de cobro de ese país.
 *
 * Devuelve `null` cuando no hay ruta de pago o el país es desconocido. **`null` no es cero ni
 * es el estándar**: quien llame tiene que decidir qué hacer, y lo correcto casi siempre es no
 * dejar retirar y explicar por qué.
 */
export function payoutTermsOf(country: string | null | undefined): Readonly<PayoutTerms> | null {
  const key = resolvePayoutCountry(country);
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
  const key = resolvePayoutCountry(country);
  return key ? UNPAYABLE_COUNTRIES.includes(key) : false;
}
