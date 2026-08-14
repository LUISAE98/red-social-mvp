// Cuentas conectadas de Stripe (Connect) — Bloque 1: estado y contrato.
//
// MODELO ELEGIDO (Luis, 2026-08-13, en el panel de Connect):
//   • Marketplace: la plataforma COBRA al cliente y DESPUÉS paga a los destinatarios.
//   • Onboarding ALOJADO POR STRIPE (el creador sale a un formulario de Stripe y vuelve).
//
// Eso se traduce en «cargos y transferencias separados»: el cobro cae en la cuenta de
// Vibra (como ya ocurre hoy) y la transferencia al creador va aparte, cuando toca pagar.
// Encaja con el ledger actual, que ya lleva el conteo por creador.
//
// 🚨 LÍMITE DURO: TRANSFERENCIAS TRANSFRONTERIZAS 🚨
// La documentación es explícita: salvo que la plataforma esté habilitada para
// «cross-border payouts», la plataforma y la cuenta conectada deben estar EN LA MISMA
// REGIÓN, y **intentar cruzar la frontera devuelve un ERROR**, no un cobro degradado.
// Vibra es mexicana ⇒ hasta que Stripe habilite lo transfronterizo, solo se puede pagar
// a creadores en México. Es la pregunta abierta que decide el alcance del Bloque 5.
//
// 🚨 EL TIPO DE PANEL ES INMUTABLE 🚨
// El panel que se fija al crear la cuenta NO se puede cambiar después: para cambiarlo
// hay que crear una cuenta NUEVA. Por eso la creación (Bloque 2) no se escribe hasta
// tener confirmada la configuración exacta.
//
// Este archivo NO llama a la API todavía: fija el estado y su interpretación, que es lo
// que no depende de la versión de la API de cuentas.

import { logger } from "firebase-functions";

/** Documento `stripeAccounts/{uid}`. Lo escribe SOLO el backend. */
export type StripeConnectAccountDoc = {
  /** `acct_...` de Stripe. Inmutable una vez creado. */
  accountId: string;
  /** País de la cuenta conectada (ISO-2). Decide si la transferencia es transfronteriza. */
  country: string | null;
  /** ¿Puede aceptar cargos? Hoy no lo usamos (Vibra cobra), pero Stripe lo reporta. */
  chargesEnabled: boolean;
  /** 🚨 EL QUE IMPORTA: sin esto en true, no se le puede pagar. */
  payoutsEnabled: boolean;
  /** Requisitos que Stripe pide AHORA. Si trae algo, el creador debe volver al formulario. */
  requirementsCurrentlyDue: string[];
  /** Requisitos con fecha límite futura. Informativo: aún no bloquean. */
  requirementsEventuallyDue: string[];
  /** Motivo por el que Stripe deshabilitó la cuenta, si aplica. */
  disabledReason: string | null;
  updatedAt: FirebaseFirestore.Timestamp | null;
};

/**
 * Estado de cara al usuario. Deriva de los campos de Stripe; no se guarda, se calcula,
 * para que no pueda quedar desincronizado del dato real.
 */
export type StripeConnectStatus =
  /** Nunca empezó: no hay cuenta. */
  | "not_started"
  /** Hay cuenta pero Stripe pide datos AHORA → debe volver al formulario. */
  | "requirements_due"
  /** Stripe deshabilitó la cuenta (rechazo, sospecha, etc.). */
  | "disabled"
  /** Todo listo: se le puede transferir. */
  | "enabled";

/**
 * Traduce lo que devuelve Stripe al estado que ve el creador.
 *
 * El orden de las ramas importa y es deliberado:
 *   1. `disabledReason` gana sobre todo: una cuenta deshabilitada no es «pendiente».
 *   2. Los requisitos vencidos ganan sobre `payoutsEnabled`, porque Stripe puede seguir
 *      reportando payouts habilitados mientras corre el plazo de un requisito nuevo, y
 *      mostrar «listo» cuando falta información es cómo se llega a un pago rechazado.
 *   3. Solo entonces manda `payoutsEnabled`.
 */
export function deriveConnectStatus(
  doc: Pick<
    StripeConnectAccountDoc,
    "accountId" | "payoutsEnabled" | "requirementsCurrentlyDue" | "disabledReason"
  > | null
): StripeConnectStatus {
  if (!doc || !doc.accountId) return "not_started";
  if (doc.disabledReason) return "disabled";
  if (doc.requirementsCurrentlyDue.length > 0) return "requirements_due";
  return doc.payoutsEnabled ? "enabled" : "requirements_due";
}

/** ¿Se le puede transferir dinero a este creador? Es el ÚNICO gate del retiro. */
export function canReceiveTransfers(
  doc: Pick<
    StripeConnectAccountDoc,
    "accountId" | "payoutsEnabled" | "requirementsCurrentlyDue" | "disabledReason"
  > | null
): boolean {
  return deriveConnectStatus(doc) === "enabled";
}

/** Forma mínima del objeto `account` de Stripe que consumimos. */
type StripeAccountLike = {
  id?: unknown;
  country?: unknown;
  charges_enabled?: unknown;
  payouts_enabled?: unknown;
  requirements?: {
    currently_due?: unknown;
    eventually_due?: unknown;
    disabled_reason?: unknown;
  } | null;
};

const strArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/**
 * Normaliza el `account` de Stripe al documento que guardamos.
 *
 * Se toma solo lo que necesitamos: aquí NO se guarda PII. Los datos de identidad los
 * custodia Stripe, igual que antes los custodiaba el proveedor de KYC.
 */
export function accountToDoc(account: unknown): Omit<StripeConnectAccountDoc, "updatedAt"> | null {
  const a = (account ?? {}) as StripeAccountLike;
  const accountId = typeof a.id === "string" ? a.id : "";
  if (!accountId) {
    logger.warn("stripe_connect_account_sin_id");
    return null;
  }
  return {
    accountId,
    country: typeof a.country === "string" ? a.country.toUpperCase() : null,
    chargesEnabled: a.charges_enabled === true,
    payoutsEnabled: a.payouts_enabled === true,
    requirementsCurrentlyDue: strArray(a.requirements?.currently_due),
    requirementsEventuallyDue: strArray(a.requirements?.eventually_due),
    disabledReason:
      typeof a.requirements?.disabled_reason === "string" ? a.requirements.disabled_reason : null,
  };
}

/**
 * País de la plataforma. Toda transferencia a una cuenta conectada de OTRO país es
 * transfronteriza y falla con error mientras Stripe no habilite esa capacidad.
 */
export const PLATFORM_COUNTRY = "MX";

/** ¿Transferir a esta cuenta cruza frontera? Se usará como guarda en el Bloque 5. */
export function isCrossBorder(accountCountry: string | null | undefined): boolean {
  const c = (accountCountry ?? "").trim().toUpperCase();
  return !!c && c !== PLATFORM_COUNTRY;
}
