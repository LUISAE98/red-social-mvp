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

/** Comisión de la plataforma. El creador recibe el neto (1 - comisión). */
export const WALLET_COMMISSION_RATE = 0.23;
export const WALLET_NET_RATE = 1 - WALLET_COMMISSION_RATE; // 0.77

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
};

function emptySummary(): SummaryData {
  return {
    currency: "MXN",
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
  const status: LedgerStatus = params.earnedImmediately ? "earned" : "pending";
  const entryRef = ledgerCollection(creatorId).doc(
    deterministicEntryId(params.sourceType, params.sourceId)
  );
  const sRef = summaryRef(creatorId);

  await db.runTransaction(async (tx) => {
    const [entrySnap, sSnap] = await Promise.all([tx.get(entryRef), tx.get(sRef)]);
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
      currency: "MXN",
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      buyerId: params.buyerId ?? null,
      createdAt: now,
      earnedAt: status === "earned" ? now : null,
      settledAt: null,
      reversedAt: null,
    });

    if (status === "earned") {
      s.lifetimeEarnedGross = round2(s.lifetimeEarnedGross + gross);
      s.lifetimeEarnedNet = round2(s.lifetimeEarnedNet + net);
    } else {
      s.pendingGross = round2(s.pendingGross + gross);
      s.pendingNet = round2(s.pendingNet + net);
    }

    tx.set(sRef, { ...s, currency: "MXN", updatedAt: now }, { merge: true });
  });
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
    const e = entrySnap.data() as { status: LedgerStatus; grossAmount: number; netAmount: number };
    if (e.status !== "pending") return; // solo pending -> earned

    const s = sSnap.exists ? (sSnap.data() as SummaryData) : emptySummary();
    const now = FieldValue.serverTimestamp();

    tx.update(entryRef, { status: "earned", earnedAt: now, settledAt: now });

    s.pendingGross = round2(s.pendingGross - e.grossAmount);
    s.pendingNet = round2(s.pendingNet - e.netAmount);
    s.lifetimeEarnedGross = round2(s.lifetimeEarnedGross + e.grossAmount);
    s.lifetimeEarnedNet = round2(s.lifetimeEarnedNet + e.netAmount);

    tx.set(sRef, { ...s, currency: "MXN", updatedAt: now }, { merge: true });
  });
}

/**
 * Revierte una entrada:
 *  - si estaba "earned"  → "refunded" (resta de ganado, suma a devuelto).
 *  - si estaba "pending" → "rejected" (resta de por-liberar, suma a perdido).
 */
export async function reverseEarning(
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
    const e = entrySnap.data() as { status: LedgerStatus; grossAmount: number; netAmount: number };
    if (e.status !== "earned" && e.status !== "pending") return; // ya revertido

    const s = sSnap.exists ? (sSnap.data() as SummaryData) : emptySummary();
    const now = FieldValue.serverTimestamp();

    if (e.status === "earned") {
      tx.update(entryRef, { status: "refunded", reversedAt: now });
      s.lifetimeEarnedGross = round2(s.lifetimeEarnedGross - e.grossAmount);
      s.lifetimeEarnedNet = round2(s.lifetimeEarnedNet - e.netAmount);
      s.refundedGross = round2(s.refundedGross + e.grossAmount);
      s.refundedNet = round2(s.refundedNet + e.netAmount);
    } else {
      tx.update(entryRef, { status: "rejected", reversedAt: now });
      s.pendingGross = round2(s.pendingGross - e.grossAmount);
      s.pendingNet = round2(s.pendingNet - e.netAmount);
      s.rejectedGross = round2(s.rejectedGross + e.grossAmount);
      s.rejectedNet = round2(s.rejectedNet + e.netAmount);
    }

    tx.set(sRef, { ...s, currency: "MXN", updatedAt: now }, { merge: true });
  });
}
