// Comisión, mínimo de retiro y RUTA DE PAGO por país — BACKEND (autoritativa).
//
// Módulo PURO a propósito (sin firebase-admin, sin imports del proyecto): así se puede
// importar desde el ledger, desde tests y desde cualquier sitio sin arrastrar el Admin SDK.
//
// El frontend tiene un espejo en `lib/wallet/payoutTiers.ts` que solo SIRVE PARA MOSTRAR. Un
// test de paridad compara las dos tablas, porque si se separan el creador ve una cifra y
// cobra otra, que es el peor fallo posible en la wallet.
//
// Fuente de verdad de las cifras: `docs/payout-tiers.md`. La cobertura de Stripe se verificó
// **preguntándole a la API país por país** (ver `scripts/sondearPayouts.sh`); la de Wallbit,
// contra su documentación pública (ver `paiseswallbit.md`).
//
// ⚠️ **La cobertura de Stripe NO se deduce de la documentación ni de `bank_account_spec`.** La
// documentación se queda corta —no lista Argentina ni Colombia, que sí cobran por wire— y
// `bank_account_spec` se pasa de largo —devuelve el formato de cuenta de países a los que no se
// puede pagar—. Las dos lecturas costaron un error real el 2026-08-27. Lo único fiable es crear
// un destinatario de prueba y leer el estado de sus capacidades:
//
//     unsupported → no existe la ruta.       NO se puede pagar.
//     restricted  → existe, faltan datos.    SÍ se puede pagar.
//     active      → lista.
//
// ── Las dos rutas ───────────────────────────────────────────────────────────────────────
//
// **Stripe Global Payouts** — el creador da su cuenta bancaria en un formulario alojado y
// Stripe le transfiere. Es la ruta por defecto y la de menos fricción.
//
// **Wallbit** — el creador cobra en una cuenta de Wallbit en dólares. Se usa donde Stripe no
// llega o donde solo llega por wire, que cuesta 25 USD por envío. Ver `paiseswallbit.md`.
//
// ⚠️ **En Chile, Uruguay, Paraguay y Honduras, Wallbit NO tiene retiro a banco local**: el
// creador cobra en dólares y su única salida documentada es cripto. Se incluyen igual por
// decisión de producto del 2026-08-27 —la alternativa era no pagarles nada—, pero hay que
// decírselo antes de que acumule saldo, no después.
//
// ── La regla de la comisión ─────────────────────────────────────────────────────────────
//
// 25% y retiras desde 300 USD. Solo los países que **únicamente** tienen wire de Stripe pagan
// 30% y retiran desde 500, porque ahí cada envío cuesta 25 USD fijos frente a 1.50 de una
// transferencia local, y a 300 USD se comería más del 8%.
//
// ── Reglas de aplicación ────────────────────────────────────────────────────────────────
//
// 🚨 **Decide el país de la CUENTA DE COBRO**, no la residencia fiscal ni la IP. Es el país al
//    que de verdad viaja el dinero, y es lo único que explica el coste.
//
// 🚨 **Un país sin fila NO es 25% por defecto, es NO PAGABLE.** Los 58 países sin ruta tienen
//    que fallar ruidosamente: si cayeran al estándar, el creador vería un mínimo alcanzable
//    para un dinero que nadie le puede mandar.
//
// 🚨 **Esto NO toca los impuestos.** Los 58 sin ruta siguen VENDIENDO y siguen pagando el
//    impuesto de su país. La tabla fiscal (`tax/config.ts`) mantiene sus 147 países intactos.
//
// 🚨 **Al cambiar de nivel se respeta lo ya vendido.** La comisión se CONGELA en el asiento del
//    ledger, igual que las retenciones. Recalcular hacia atrás destruye la confianza y es lo
//    primero que se nota en el saldo.

/** Los dos grupos de comisión. */
export type PayoutTier = "standard" | "expensive";

/** Por dónde le llega el dinero al creador. */
export type PayoutRoute = "stripe" | "wallbit";

/** Lo que le toca a un creador de un país. */
export type PayoutTerms = {
  tier: PayoutTier;
  /** Quién le paga. Decide qué se le pide en el alta. */
  route: PayoutRoute;
  /** Fracción que se queda Vibra sobre el precio base. 0.25 = 25%. */
  commissionRate: number;
  /** Mínimo acumulado para poder pedir un retiro, en USD. */
  minWithdrawalUsd: number;
  /**
   * Cobra en dólares pero **no puede pasarlos a su banco**: su única salida es cripto.
   *
   * Solo pasa en Chile, Uruguay, Paraguay y Honduras. Hay que avisárselo ANTES de que empiece
   * a acumular, porque para la mayoría de creadores eso no es cobrar.
   */
  soloDolares?: true;
};

const T = (tier: PayoutTier, route: PayoutRoute, soloDolares?: true): Readonly<PayoutTerms> =>
  Object.freeze({
    tier,
    route,
    commissionRate: tier === "standard" ? 0.25 : 0.3,
    minWithdrawalUsd: tier === "standard" ? 300 : 500,
    ...(soloDolares ? { soloDolares } : {}),
  });

/** Las condiciones de cada combinación. */
export const PAYOUT_TERMS = {
  /** Transferencia bancaria local de Stripe, 1.50 USD fijos. */
  standard: T("standard", "stripe"),
  /** Solo wire de Stripe, 25 USD fijos. De ahí el mínimo alto. */
  expensive: T("expensive", "stripe"),
  /** Wallbit con retiro a banco local en su moneda. */
  wallbit: T("standard", "wallbit"),
  /** Wallbit sin retiro local: cobra en dólares y solo puede sacarlos por cripto. */
  wallbitSoloDolares: T("standard", "wallbit", true),
} as const;

/**
 * Lo que se le enseña a un creador que TODAVÍA NO tiene cuenta de cobro.
 *
 * No es un respaldo para países sin fila —esos son no pagables y deben fallar—, es lo que se
 * muestra mientras no se sabe a qué país va a cobrar.
 */
export const PAYOUT_TERMS_PROVISIONAL: Readonly<PayoutTerms> = PAYOUT_TERMS.standard;

/**
 * Stripe, transferencia local — 25%, mínimo 300 USD (46 países).
 */
const STRIPE_LOCAL: readonly string[] = [
  "MX", "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU",
  "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK", "CR", "DO",
  "NO", "IS", "AU", "ID", "NZ", "SG", "CA", "US", "PE", "GB", "MA", "TT", "JM", "MC", "SM",
  "CI",
];

/**
 * Stripe, solo wire — 30%, mínimo 500 USD (27 países).
 *
 * 25 USD fijos por envío. Es lo único que justifica un mínimo distinto.
 */
const STRIPE_WIRE: readonly string[] = [
  "BA", "HK", "QA", "KW", "JP", "MY", "PH", "TH", "JO", "TW", "ZA", "EG", "TR", "RS", "AL",
  "MD", "VN", "AE", "LC", "AG", "LK", "BT", "BN", "MN", "BW", "NG", "KH",
];

/**
 * Wallbit CON retiro a banco local en moneda local (6 países).
 *
 * Ruta completa: el creador cobra en Wallbit y lo pasa a su banco. Panamá está dolarizado,
 * así que ahí ni siquiera hay conversión de divisa.
 *
 * ⚠️ **Ecuador y El Salvador salieron de aquí el 2026-09-01.** Estaban incluidos con este
 *    razonamiento: «están dolarizados, así que ahí ni siquiera hay conversión de divisa».
 *    Es verdad y es irrelevante — el problema no es la conversión, es que **Wallbit no
 *    tiene retiro a banco local ahí**. Estar dolarizado no te saca el dinero de la cuenta.
 *
 *    `paiseswallbit.md` los marca «solo cripto» y su propio recuento de rutas completas
 *    no los incluye. Mientras estuvieron aquí, sus creadores NO veían el aviso de que su
 *    única salida es cripto — que es exactamente para lo que existe la bandera.
 */
const WALLBIT_COMPLETO: readonly string[] = [
  "AR", "BR", "BO", "CO", "GT", "PA",
];

/**
 * Wallbit SIN retiro a banco local (6 países).
 *
 * ⚠️ Cobra en dólares y su única salida documentada es **cripto**: abrir una wallet, entender
 * USDC, pagar comisión de red y venderlo en un exchange local.
 *
 * Se incluyen por decisión de producto del 2026-08-27, porque la alternativa era no pagarles
 * nada. Pero se marcan con `soloDolares` para que la interfaz pueda advertírselo ANTES de que
 * acumule saldo. Prometer un retiro que en la práctica no puede usar sería peor que decirle
 * que todavía no se le puede pagar. El aviso sale en el paso 2 del panel de registro.
 *
 * 🔁 Si Wallbit confirma que tiene tarjeta de débito, o abre retiro local en estos países,
 * pasan a `WALLBIT_COMPLETO` y el aviso desaparece solo. Para Ecuador, El Salvador y
 * Uruguay hay una pregunta abierta a su soporte: los tres aparecen anunciados pero fuera
 * de su lista de retiro local. Ver el pendiente 2 de `paiseswallbit.md`.
 */
const WALLBIT_SOLO_DOLARES: readonly string[] = ["CL", "UY", "PY", "HN", "EC", "SV"];

/**
 * Territorios que cobran con la cuenta bancaria de OTRO país.
 *
 * Stripe no los lista como destino propio, pero su sistema bancario es el de la metrópoli: un
 * creador en Puerto Rico abre una cuenta estadounidense con su routing number, y uno en
 * Canarias usa un IBAN español.
 *
 * ⚠️ `IC` y `EA` ni siquiera son ISO 3166: son códigos internos de la UE para Canarias y para
 * Ceuta y Melilla. Vienen de la tabla fiscal, donde existen porque su IVA es distinto al
 * peninsular. Aquí se resuelven a España, que es de donde es su banco.
 */
export const PAYOUT_COUNTRY_ALIAS: Readonly<Record<string, string>> = {
  PR: "US",
  VI: "US",
  IC: "ES",
  EA: "ES",
};

/**
 * Sin ruta de pago (58 países).
 *
 * ⚠️ **Compran y venden, pero nadie les puede pagar.** Ni Stripe ni Wallbit llegan. Se listan a
 * propósito en vez de dejarlos fuera sin más: la diferencia entre «no lo tengo dado de alta» y
 * «no existe forma de pagarte» es justo lo que hay que poder decirle al creador.
 *
 * Los únicos con mercado real son **Nicaragua, Corea del Sur, Arabia Saudita, Nepal, Haití,
 * Papúa Nueva Guinea y Azerbaiyán**. El resto son islas y territorios de menos de cien mil
 * habitantes.
 */
export const UNPAYABLE_COUNTRIES: readonly string[] = [
  "NI", "GU", "PG", "NC", "FJ", "ME", "KR", "SA", "PF", "TO", "SB", "VU", "WS", "KI", "NR",
  "TV", "NU", "WF", "FM", "MH", "AS", "MP", "SR", "BZ", "GD", "KY", "BM", "TC", "VG", "HT",
  "BQ", "VC", "KN", "DM", "AI", "MS", "GL", "PM", "JE", "AD", "FO", "GI", "VA", "GG", "SJ",
  "AZ", "NP", "MV", "NF", "CX", "CC", "TK", "PN", "GF", "YT", "GP", "MQ", "RE",
];

/** País → condiciones. Se arma de las listas para que no se puedan desincronizar. */
export const PAYOUT_TERMS_BY_COUNTRY: Readonly<Record<string, Readonly<PayoutTerms>>> =
  Object.freeze(
    Object.fromEntries([
      ...STRIPE_LOCAL.map((c) => [c, PAYOUT_TERMS.standard]),
      ...STRIPE_WIRE.map((c) => [c, PAYOUT_TERMS.expensive]),
      ...WALLBIT_COMPLETO.map((c) => [c, PAYOUT_TERMS.wallbit]),
      ...WALLBIT_SOLO_DOLARES.map((c) => [c, PAYOUT_TERMS.wallbitSoloDolares]),
    ])
  );

/**
 * País → nivel de comisión.
 *
 * Se conserva por compatibilidad con lo que ya lo usaba. Para saber además la RUTA, usa
 * `payoutTermsOf`.
 */
export const PAYOUT_TIER_BY_COUNTRY: Readonly<Record<string, PayoutTier>> = Object.freeze(
  Object.fromEntries(
    Object.entries(PAYOUT_TERMS_BY_COUNTRY).map(([c, t]) => [c, t.tier])
  )
);


/**
 * 🌎 Qué país decide la comisión, el mínimo y la ruta.
 *
 * **La cuenta de cobro manda sobre el documento.** Es a donde viaja el dinero de verdad, y es
 * lo único que explica el coste: un mexicano con cuenta en Estados Unidos se paga por ACH
 * estadounidense, no por SPEI, cueste lo que cueste su pasaporte.
 *
 * El documento es el RESPALDO, y hace falta por dos motivos:
 *
 * - Un creador de ruta **Wallbit** nunca da de alta cuenta en Stripe, así que
 *   `payoutAccountCountry` se queda vacío para siempre. Sin este respaldo caería al caso
 *   provisional y su país real no decidiría nada.
 * - Antes de completar el alta hay que poder enseñarle algo, y su documento es lo único que
 *   se sabe de él.
 *
 * 🚨 **Esta función es la ÚNICA fuente del criterio.** La usan el ledger —que congela la
 * comisión— y la interfaz —que la muestra—. Tenerlo escrito dos veces es exactamente cómo se
 * llega a que el creador vea una cifra y cobre otra.
 *
 * ⚠️ Que el documento sea de un país y la cuenta de otro **no es un problema**: es un caso
 * normal y previsto. Lo único que cambia es que su comisión la decide su banco. Ojo con el
 * otro efecto, que vive aparte: a un creador MEXICANO, cobrar fuera de México le sube la
 * retención de IVA del 50% al 100% (`fiscal-iva-isr-plataforma.md` §0.6).
 */
export function paisDeCobroDe(fuentes: {
  payoutAccountCountry?: string | null;
  documentCountry?: string | null;
}): string | null {
  const cuenta = (fuentes.payoutAccountCountry ?? "").trim();
  const documento = (fuentes.documentCountry ?? "").trim();
  return cuenta || documento || null;
}

/** Resuelve un territorio a la matriz cuyo banco usa. Lo demás pasa tal cual. */
export function resolvePayoutCountry(country: string | null | undefined): string {
  const key = (country ?? "").trim().toUpperCase();
  return PAYOUT_COUNTRY_ALIAS[key] ?? key;
}

/**
 * Qué comisión, qué mínimo y por qué ruta cobra una cuenta de ese país.
 *
 * Devuelve `null` cuando no hay ruta de pago o el país es desconocido. **`null` no es cero ni
 * es el estándar**: quien llame tiene que decidir qué hacer, y lo correcto casi siempre es no
 * dejar retirar y explicar por qué.
 */
export function payoutTermsOf(country: string | null | undefined): Readonly<PayoutTerms> | null {
  const key = resolvePayoutCountry(country);
  if (!key) return null;
  return PAYOUT_TERMS_BY_COUNTRY[key] ?? null;
}

/** ¿Se le puede pagar a ese país, por la ruta que sea? */
export function isPayableCountry(country: string | null | undefined): boolean {
  return payoutTermsOf(country) != null;
}

/** Por dónde cobra ese país. `null` si no se le puede pagar. */
export function payoutRouteOf(country: string | null | undefined): PayoutRoute | null {
  return payoutTermsOf(country)?.route ?? null;
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
