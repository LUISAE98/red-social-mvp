/**
 * Libro mayor de wallet (Opción A).
 *
 * Fuente de verdad de las ganancias del creador. Cada venta genera UNA entrada
 * en `users/{creatorId}/walletLedger/{entryId}` y se mantiene un resumen
 * agregado en `users/{creatorId}/walletSummary/current` de forma transaccional,
 * para que Finanzas lea un solo documento (rápido y auditable).
 *
 * Estados de una entrada:
 *  - "pending"  : pagado pero no entregado (grupo B: saludos, consejos, sesiones).
 *  - "earned"   : cuenta como ganancia del creador.
 *  - "refunded" : estaba "earned" y se reembolsó (resta de ganado).
 *  - "rejected" : estaba "pending" y se rechazó/no se entregó (dinero perdido).
 *
 * Estas funciones son helpers: las Cloud Functions de cada servicio las llaman
 * en el momento correcto (Fase 2). No procesan pagos por sí mismas.
 */

import * as admin from "firebase-admin";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

/** Comisión de la plataforma. El creador recibe el neto (1 - comisión).
 *  25% desde 2026-07-31 (reparto 75/25). Ver docs/modelo-financiero.md. */
export const WALLET_COMMISSION_RATE = 0.25;
export const WALLET_NET_RATE = 1 - WALLET_COMMISSION_RATE; // 0.75

/**
 * Moneda de LIQUIDACIÓN de Vibra (en la que se guarda el ledger y se cobra en Stripe).
 * USD desde el corte a Vibra On, LLC (2026-08-18). ⚠️ Mantener en sync con
 * SETTLEMENT_CURRENCY del frontend en lib/currency/catalog.ts.
 * El comprador siempre ve y paga en su moneda local (ver tax/presentment.ts).
 *
 * ⚠️ Los asientos ANTERIORES al corte llevan `currency: "MXN"` propio y se quedan así:
 * son historia y se describen solos. No se convierten.
 */
export const SETTLEMENT_CURRENCY = "USD";

/**
 * Cargo fijo por transacción que ABSORBE EL COMPRADOR (no el creador). Se suma al
 * precio base del creador antes del impuesto: el comprador paga (base + cargo) + impuesto,
 * el creador recibe 75% de la base. Protege el margen en cobros chicos. Ver docs/modelo-financiero.md (D1).
 *
 * 💵 $0.40 = $0.30 del fijo de Stripe en EE. UU. + $0.05 de Radar, con el margen que
 * exige que Stripe cobre su PORCENTAJE también sobre este cargo (mínimo real
 * 0.35÷(1−tasa): 0.361 nacional, 0.370 internacional).
 */
export const FIXED_SERVICE_FEE_USD = 0.4;

/**
 * Mínimo de una donación, en la moneda de liquidación.
 *
 * ⚠️ ESPEJO de `DONATION_MIN_AMOUNT_USD` en lib/currency/catalog.ts. Hay un test que
 * compara los dos: si se separan, un creador podría configurar un monto que el servidor
 * rechaza al cobrar, o al revés.
 *
 * Era 50 y estaba pensado en pesos. Con la denominación en USD pedía 50 dólares por
 * donación, así que ninguna de las sugeridas por defecto se podía pagar.
 */
export const DONATION_MIN_AMOUNT_USD = 3;

/**
 * Mínimo de un contenido de pago (post premium, ticket de live, VOD).
 *
 * ⚠️ ESPEJO de `PREMIUM_MIN_PRICE_USD` en lib/currency/catalog.ts, con test de paridad.
 *
 * Antes `createPost` usaba un 10 escrito a mano, que eran DIEZ PESOS de cuando la
 * plataforma cobraba en MXN. Con la denominación en USD pasaron a ser diez dólares y el
 * servidor rechazaba cualquier publicación de pago por debajo de eso — un post de 3 USD
 * salía como «El precio no es válido» aunque el panel dijera que era correcto.
 */
export const PREMIUM_MIN_PRICE_USD = 1.5;

export type LedgerServiceType =
  | "supercomment"
  | "profile_donation"
  | "live_donation"
  | "live_ticket"
  | "premium_post"
  | "greeting"
  | "advice"
  | "exclusive_session"
  | "live_session"
  | "subscription"
  | "vod_ticket";

export type LedgerStatus = "pending" | "earned" | "refunded" | "rejected";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Neto (lo que recibe el creador) a partir del bruto (lo que pagó el cliente). */
export function netFromGross(gross: number): number {
  return round2(gross * WALLET_NET_RATE);
}

/** Normaliza la fecha real de la venta a Timestamp; si no hay, usa el reloj del servidor. */
function toOccurredAt(value?: unknown) {
  if (value instanceof admin.firestore.Timestamp) return value;
  if (value instanceof Date) return admin.firestore.Timestamp.fromDate(value);
  if (
    value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    return admin.firestore.Timestamp.fromDate(
      (value as { toDate: () => Date }).toDate()
    );
  }
  return FieldValue.serverTimestamp();
}

function ledgerCollection(creatorId: string) {
  return db.collection("users").doc(creatorId).collection("walletLedger");
}

function summaryRef(creatorId: string) {
  return db
    .collection("users")
    .doc(creatorId)
    .collection("walletSummary")
    .doc("current");
}

/** Id determinista por venta → idempotencia (no duplica la misma entrada). */
function deterministicEntryId(sourceType: string, sourceId: string): string {
  return `${sourceType}__${sourceId}`;
}

type SummaryData = {
  currency: string;
  lifetimeEarnedGross: number;
  lifetimeEarnedNet: number;
  withdrawnGross: number;
  withdrawnNet: number;
  pendingGross: number;
  pendingNet: number;
  refundedGross: number;
  refundedNet: number;
  rejectedGross: number;
  rejectedNet: number;
  /**
   * 🧾 IVA — Total de impuesto COBRADO al comprador en ventas ya ganadas (va al SAT,
   * NO es del creador). Solo informativo/transparencia; no suma a las ganancias.
   * Se acumula al ganar y se resta al reembolsar, en paralelo a lifetimeEarnedNet.
   */
  lifetimeTaxCollected: number;
};

function emptySummary(): SummaryData {
  return {
    currency: SETTLEMENT_CURRENCY,
    lifetimeEarnedGross: 0,
    lifetimeEarnedNet: 0,
    withdrawnGross: 0,
    withdrawnNet: 0,
    pendingGross: 0,
    pendingNet: 0,
    refundedGross: 0,
    refundedNet: 0,
    rejectedGross: 0,
    rejectedNet: 0,
    lifetimeTaxCollected: 0,
  };
}

export type RecordEarningParams = {
  type: LedgerServiceType;
  /** Monto bruto en MXN (lo que paga el cliente). */
  grossAmount: number;
  /** Colección/entidad de origen (p.ej. "greetingRequest"). */
  sourceType: string;
  /** Id del documento de origen. */
  sourceId: string;
  buyerId?: string | null;
  /**
   * true  = grupo A (cuenta como ganado apenas se paga) → estado "earned".
   * false = grupo B (cuenta al entregar/concluir) → estado "pending".
   */
  earnedImmediately: boolean;
  /** Fecha REAL de la venta (para gráficas de tiempo). Si no, usa el reloj. */
  occurredAt?: unknown;
  /** Canal que originó la venta: perfil del creador o una comunidad. */
  channelType?: "profile" | "group";
  /** Id de la comunidad si channelType = "group"; null para perfil. */
  channelId?: string | null;
  /** Id del post del live si la venta pertenece a una transmisión; null si no. */
  liveId?: string | null;
  /** Id de la publicación (para tickets: post premium / VOD); null si no aplica. */
  postId?: string | null;
  /** 🧾 IVA — País fiscal del comprador (ISO-2) o null. Solo registro/transparencia. */
  taxCountry?: string | null;
  /** 🧾 IVA — Impuesto COBRADO al comprador (va al SAT, NO es del creador). Default 0. */
  taxAmount?: number;
};

/**
 * Registra una venta pagada en el libro mayor. Idempotente por (sourceType, sourceId).
 */
export async function recordEarning(
  creatorId: string,
  params: RecordEarningParams
): Promise<void> {
  const gross = round2(params.grossAmount);
  const net = netFromGross(gross);
  // 🧾 IVA — Impuesto cobrado al comprador (informativo; no es del creador).
  const taxAmount = round2(params.taxAmount ?? 0);
  const status: LedgerStatus = params.earnedImmediately ? "earned" : "pending";
  const entryRef = ledgerCollection(creatorId).doc(
    deterministicEntryId(params.sourceType, params.sourceId)
  );
  const sRef = summaryRef(creatorId);

  // Contador público de experiencias. Va aquí y no en otro lado porque ESTE es
  // el embudo por el que pasan las once formas de vender: contando aquí no hay
  // una venta que se escape ni una que se cuente dos veces —el id de la entrada
  // es determinista y arriba se sale si ya existía—.
  //
  // Una venta hecha dentro de una comunidad suma en las dos cuentas: en la del
  // creador, porque la hizo él, y en la de la comunidad, porque ahí ocurrió.
  const creatorRef = db.collection("users").doc(creatorId);
  const groupRef =
    params.channelType === "group" && params.channelId
      ? db.collection("groups").doc(params.channelId)
      : null;

  await db.runTransaction(async (tx) => {
    // Todas las lecturas ANTES de cualquier escritura: es la regla de las
    // transacciones de Firestore.
    const [entrySnap, sSnap, creatorSnap, groupSnap] = await Promise.all([
      tx.get(entryRef),
      tx.get(sRef),
      tx.get(creatorRef),
      groupRef ? tx.get(groupRef) : Promise.resolve(null),
    ]);
    if (entrySnap.exists) return; // ya registrado

    const s = sSnap.exists ? (sSnap.data() as SummaryData) : emptySummary();
    const now = FieldValue.serverTimestamp();

    tx.set(entryRef, {
      creatorId,
      type: params.type,
      status,
      grossAmount: gross,
      netAmount: net,
      commissionRate: WALLET_COMMISSION_RATE,
      // 🧾 IVA — desglose fiscal por venta (informativo; el IVA va al SAT, no al creador).
      taxCountry: params.taxCountry ?? null,
      taxAmount,
      currency: SETTLEMENT_CURRENCY,
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      buyerId: params.buyerId ?? null,
      channelType: params.channelType ?? "profile",
      channelId: params.channelId ?? null,
      liveId: params.liveId ?? null,
      postId: params.postId ?? null,
      createdAt: now,
      occurredAt: toOccurredAt(params.occurredAt),
      earnedAt: status === "earned" ? now : null,
      settledAt: null,
      reversedAt: null,
    });

    if (status === "earned") {
      s.lifetimeEarnedGross = round2(s.lifetimeEarnedGross + gross);
      s.lifetimeEarnedNet = round2(s.lifetimeEarnedNet + net);
      // 🧾 IVA — el impuesto se cobra al ganar (venta inmediata). En pending se cuenta al liberar.
      s.lifetimeTaxCollected = round2((s.lifetimeTaxCollected ?? 0) + taxAmount);
    } else {
      s.pendingGross = round2(s.pendingGross + gross);
      s.pendingNet = round2(s.pendingNet + net);
    }

    tx.set(sRef, { ...s, currency: SETTLEMENT_CURRENCY, updatedAt: now }, { merge: true });

    // Se suma en cuanto la venta ocurre, no cuando el dinero se libera: la
    // experiencia ya pasó. Y no se resta al devolver — decisión de producto, el
    // número solo sube.
    //
    // Se comprueba que el documento exista antes de escribirlo. Con `merge` a
    // secas, una comunidad ya borrada reviviría como un documento fantasma con
    // un solo campo dentro.
    if (creatorSnap.exists) {
      tx.set(
        creatorRef,
        { experiencesCount: FieldValue.increment(1) },
        { merge: true }
      );
    }

    if (groupRef && groupSnap?.exists) {
      tx.set(
        groupRef,
        { experiencesCount: FieldValue.increment(1) },
        { merge: true }
      );
    }
  });
}

/**
 * Sella la fecha real de venta en una entrada YA existente (para el backfill
 * de datos históricos que se registraron sin occurredAt).
 */
export async function stampOccurredAt(
  creatorId: string,
  sourceType: string,
  sourceId: string,
  occurredAt: Date
): Promise<void> {
  const ref = ledgerCollection(creatorId).doc(
    deterministicEntryId(sourceType, sourceId)
  );
  const snap = await ref.get();
  if (!snap.exists) return;
  await ref.set(
    { occurredAt: admin.firestore.Timestamp.fromDate(occurredAt) },
    { merge: true }
  );
}

/**
 * Sella el canal (perfil/comunidad) en una entrada YA existente, para el
 * backfill de datos que se registraron antes de trackear canal.
 */
export async function stampChannel(
  creatorId: string,
  sourceType: string,
  sourceId: string,
  channelType: "profile" | "group",
  channelId: string | null
): Promise<void> {
  const ref = ledgerCollection(creatorId).doc(
    deterministicEntryId(sourceType, sourceId)
  );
  const snap = await ref.get();
  if (!snap.exists) return;
  await ref.set({ channelType, channelId: channelId ?? null }, { merge: true });
}

/**
 * Grupo B: pasa una entrada "pending" a "earned" (servicio entregado/concluido).
 */
export async function settleEarning(
  creatorId: string,
  sourceType: string,
  sourceId: string
): Promise<void> {
  const entryRef = ledgerCollection(creatorId).doc(
    deterministicEntryId(sourceType, sourceId)
  );
  const sRef = summaryRef(creatorId);

  await db.runTransaction(async (tx) => {
    const [entrySnap, sSnap] = await Promise.all([tx.get(entryRef), tx.get(sRef)]);
    if (!entrySnap.exists) return;
    const e = entrySnap.data() as { status: LedgerStatus; grossAmount: number; netAmount: number; taxAmount?: number };
    if (e.status !== "pending") return; // solo pending -> earned

    const s = sSnap.exists ? (sSnap.data() as SummaryData) : emptySummary();
    const now = FieldValue.serverTimestamp();

    tx.update(entryRef, { status: "earned", earnedAt: now, settledAt: now });

    s.pendingGross = round2(s.pendingGross - e.grossAmount);
    s.pendingNet = round2(s.pendingNet - e.netAmount);
    s.lifetimeEarnedGross = round2(s.lifetimeEarnedGross + e.grossAmount);
    s.lifetimeEarnedNet = round2(s.lifetimeEarnedNet + e.netAmount);
    // 🧾 IVA — al liberar (entregado) se cuenta el impuesto cobrado de esta venta.
    s.lifetimeTaxCollected = round2((s.lifetimeTaxCollected ?? 0) + (e.taxAmount ?? 0));

    tx.set(sRef, { ...s, currency: SETTLEMENT_CURRENCY, updatedAt: now }, { merge: true });
  });
}

/**
 * Revierte una entrada:
 *  - si estaba "earned"  → "refunded" (resta de ganado, suma a devuelto).
 *  - si estaba "pending":
 *      · por defecto → "rejected" (resta de por-liberar, suma a perdido).
 *      · con `asRefund: true` → "refunded" (resta de por-liberar, suma a DEVUELTO). Se
 *        usa cuando el COMPRADOR pide la devolución de una experiencia no entregada: para
 *        el creador cuenta como DEVOLUCIÓN, no como "perdido".
 */
export async function reverseEarning(
  creatorId: string,
  sourceType: string,
  sourceId: string,
  opts?: { asRefund?: boolean }
): Promise<void> {
  const entryRef = ledgerCollection(creatorId).doc(
    deterministicEntryId(sourceType, sourceId)
  );
  const sRef = summaryRef(creatorId);

  await db.runTransaction(async (tx) => {
    const [entrySnap, sSnap] = await Promise.all([tx.get(entryRef), tx.get(sRef)]);
    if (!entrySnap.exists) return;
    const e = entrySnap.data() as { status: LedgerStatus; grossAmount: number; netAmount: number; taxAmount?: number };
    if (e.status !== "earned" && e.status !== "pending") return; // ya revertido

    const s = sSnap.exists ? (sSnap.data() as SummaryData) : emptySummary();
    const now = FieldValue.serverTimestamp();

    if (e.status === "earned") {
      tx.update(entryRef, { status: "refunded", reversedAt: now });
      s.lifetimeEarnedGross = round2(s.lifetimeEarnedGross - e.grossAmount);
      s.lifetimeEarnedNet = round2(s.lifetimeEarnedNet - e.netAmount);
      // 🧾 IVA — al reembolsar una venta ganada, se descuenta el IVA que se había cobrado.
      s.lifetimeTaxCollected = round2((s.lifetimeTaxCollected ?? 0) - (e.taxAmount ?? 0));
      s.refundedGross = round2(s.refundedGross + e.grossAmount);
      s.refundedNet = round2(s.refundedNet + e.netAmount);
    } else if (opts?.asRefund) {
      // pending → DEVUELTO (el comprador pidió devolución de algo no entregado).
      tx.update(entryRef, { status: "refunded", reversedAt: now });
      s.pendingGross = round2(s.pendingGross - e.grossAmount);
      s.pendingNet = round2(s.pendingNet - e.netAmount);
      s.refundedGross = round2(s.refundedGross + e.grossAmount);
      s.refundedNet = round2(s.refundedNet + e.netAmount);
    } else {
      tx.update(entryRef, { status: "rejected", reversedAt: now });
      s.pendingGross = round2(s.pendingGross - e.grossAmount);
      s.pendingNet = round2(s.pendingNet - e.netAmount);
      s.rejectedGross = round2(s.rejectedGross + e.grossAmount);
      s.rejectedNet = round2(s.rejectedNet + e.netAmount);
    }

    tx.set(sRef, { ...s, currency: SETTLEMENT_CURRENCY, updatedAt: now }, { merge: true });
  });
}
