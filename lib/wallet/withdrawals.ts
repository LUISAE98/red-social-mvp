"use client";

// Puente hacia los callables de retiro y suscripción a las solicitudes.
//
// El creador SOLICITA y administración RESUELVE. Ninguna de las dos escribe en Firestore desde
// el cliente: las reglas lo prohíben (`allow create, update, delete: if false` en
// `withdrawalRequests`) porque los importes se congelan en el servidor y un cliente que
// pudiera escribirlos decidiría cuánto se le paga.

import { httpsCallable } from "firebase/functions";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
  limit as fsLimit,
  type Timestamp,
} from "firebase/firestore";
import { functions, db } from "@/lib/firebase";

/**
 * ⚠️ ESPEJO de `backend/src/wallet/withdrawals.ts`. Solo sirve para MOSTRAR.
 *
 * `sent` se agregó el 2026-08-31: antes un retiro pasaba de `approved` a `paid` en cuanto
 * Stripe aceptaba la orden, cuando en realidad el dinero tarda de uno a siete días en llegar
 * al banco. Ahora `sent` es «va en camino» y `paid` es «el banco lo acreditó».
 */
export type WithdrawalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "sent"
  | "paid"
  | "failed";

export type WithdrawalRequestDoc = {
  id: string;
  creatorId: string;
  status: WithdrawalStatus;
  currency: string;
  /** Lo que salió de su saldo. */
  saldo: number;
  ivaCobrado: number;
  isr: number;
  iva: number;
  ivaComision: number;
  ivaPorDeclarar: number;
  /** Lo que se le manda, en la moneda de liquidación. */
  neto: number;
  /**
   * 💱 Lo que de verdad le llegó al banco, EN SU MONEDA, y a qué cambio.
   *
   * Se rellenan al ENVIAR, no al solicitar: hasta que Stripe no mueve el dinero no existe el
   * tipo de cambio. Salen de la respuesta del `OutboundPayment`, no de una cotización.
   */
  acreditado: number | null;
  acreditadoCurrency: string | null;
  tipoCambio: number | null;
  /** Cuándo espera Stripe que llegue al banco. */
  llegadaEstimada: string | null;
  route: "stripe" | "wallbit";
  payoutCountry: string | null;
  declaredAccountLast4: string | null;
  declaredHolderName: string | null;
  /** 🏷️ El TAG de Wallbit al que hay que transferir. Solo en esa ruta. */
  wallbitTag: string | null;
  stripeRecipientId: string | null;
  stripeAccountBank: string | null;
  createdAt: Timestamp | null;
  reviewedAt: Timestamp | null;
  reviewedBy: string | null;
  rejectionReason: string | null;
  /** El `OutboundPayment` de Stripe, cuando el envío salió. */
  outboundPaymentId: string | null;
  outboundStatus: string | null;
  /** Sesión de Didit donde vive la cuenta COMPLETA. Solo la tiene Vibra, no el creador. */
  payoutAccountSessionId: string | null;
  paymentReference: string | null;
};

const COL = "withdrawalRequests";

/** Solicita el retiro. El importe lo decide el servidor, aquí no viaja ninguna cifra. */
export async function requestWithdrawal(): Promise<{ id: string; neto: number }> {
  const fn = httpsCallable<Record<string, never>, { id: string; neto: number }>(
    functions,
    "requestWithdrawal"
  );
  const { data } = await fn({});
  return data;
}

/** Acepta o rechaza. Solo el dueño de la plataforma; la función lo comprueba. */
export async function reviewWithdrawal(
  id: string,
  aprobar: boolean,
  motivo?: string
): Promise<void> {
  const fn = httpsCallable<{ id: string; aprobar: boolean; motivo?: string }, unknown>(
    functions,
    "reviewWithdrawal"
  );
  await fn({ id, aprobar, ...(motivo ? { motivo } : {}) });
}

/**
 * Cierra una solicitud de Wallbit que ya se transfirió a mano.
 *
 * Las de Stripe no pasan por aquí: se cierran solas cuando sale el `OutboundPayment`, y
 * el backend rechaza el intento.
 */
/**
 * Cierra a mano un retiro de Wallbit.
 *
 * 🚨 `referencia` NO es opcional aunque el tipo lo permitiera antes: el servidor rechaza
 *    cualquier cosa de menos de 6 caracteres. Es el identificador de la transferencia de
 *    Wallbit, y es lo único que respalda ese pago — esa ruta no tiene API que consultar.
 */
export async function markWithdrawalPaid(id: string, referencia: string): Promise<void> {
  const fn = httpsCallable<{ id: string; referencia?: string }, unknown>(
    functions,
    "markWithdrawalPaid"
  );
  await fn({ id, ...(referencia ? { referencia } : {}) });
}

/**
 * Enlace a la sesión de Didit donde está la cuenta completa del creador.
 *
 * ⚠️ Vibra guarda solo los últimos cuatro dígitos y el titular; el número entero vive en
 * Didit a propósito. Para pagar por Wallbit hay que ir allí, y este enlace es el atajo.
 */
export function enlaceDidit(sessionId: string): string {
  return `https://business.didit.me/console/sessions/${sessionId}`;
}

function normalizar(id: string, d: Record<string, unknown>): WithdrawalRequestDoc {
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  const s = (x: unknown) => (typeof x === "string" ? x : null);
  return {
    id,
    creatorId: String(d.creatorId ?? ""),
    status: (d.status as WithdrawalStatus) ?? "pending",
    currency: String(d.currency ?? "USD"),
    saldo: n(d.saldo),
    ivaCobrado: n(d.ivaCobrado),
    isr: n(d.isr),
    iva: n(d.iva),
    ivaComision: n(d.ivaComision),
    ivaPorDeclarar: n(d.ivaPorDeclarar),
    neto: n(d.neto),
    // Nulos mientras el retiro no se haya enviado.
    route: d.route === "wallbit" ? "wallbit" : "stripe",
    payoutCountry: s(d.payoutCountry),
    acreditado: typeof d.acreditado === "number" ? d.acreditado : null,
    acreditadoCurrency: s(d.acreditadoCurrency),
    tipoCambio: typeof d.tipoCambio === "number" ? d.tipoCambio : null,
    llegadaEstimada: s(d.llegadaEstimada),
    declaredAccountLast4: s(d.declaredAccountLast4),
    declaredHolderName: s(d.declaredHolderName),
    wallbitTag: s(d.wallbitTag),
    stripeRecipientId: s(d.stripeRecipientId),
    stripeAccountBank: s(d.stripeAccountBank),
    createdAt: (d.createdAt as Timestamp) ?? null,
    reviewedAt: (d.reviewedAt as Timestamp) ?? null,
    reviewedBy: s(d.reviewedBy),
    rejectionReason: s(d.rejectionReason),
    outboundPaymentId: s(d.outboundPaymentId),
    outboundStatus: s(d.outboundStatus),
    payoutAccountSessionId: s(d.payoutAccountSessionId),
    paymentReference: s(d.paymentReference),
  };
}

/**
 * Todas las solicitudes, para el panel de administración.
 *
 * ⚠️ Sin `where`, así que solo pasa la regla si quien mira es moderador de plataforma. Para un
 * creador la consulta se deniega ENTERA, no devuelve las suyas — es cómo funciona `list` en
 * Firestore. Para eso está `suscribirMisRetiros`.
 */
export function suscribirRetiros(
  cb: (rows: WithdrawalRequestDoc[]) => void,
  onError?: (e: unknown) => void
): () => void {
  const q = query(collection(db, COL), orderBy("createdAt", "desc"), fsLimit(200));
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => normalizar(d.id, d.data() as Record<string, unknown>))),
    (e) => onError?.(e)
  );
}

/**
 * Las del creador que mira.
 *
 * 🚨 El `where("creatorId", "==", uid)` NO es un filtro de conveniencia, es lo que hace que la
 * consulta pase la regla: `list` en Firestore solo puede comprobar los campos FIJADOS con
 * `==`. Sin él, la consulta entera se deniega.
 */
export function suscribirMisRetiros(
  uid: string,
  cb: (rows: WithdrawalRequestDoc[]) => void,
  onError?: (e: unknown) => void
): () => void {
  const q = query(
    collection(db, COL),
    where("creatorId", "==", uid),
    orderBy("createdAt", "desc"),
    fsLimit(50)
  );
  /*
   * 🚨 CON manejador de error, y no es opcional.
   *
   * Sin él esta suscripción se comía el fallo en silencio: faltaba el índice compuesto de
   * `creatorId` + `createdAt` y la consulta se denegaba SIEMPRE, así que el creador no veía
   * ninguno de sus retiros y `retiroEnRevision` nunca se encendía —con lo que su saldo
   * apartado se le presentaba como «te faltan 300 USD para poder retirar»—. Dos síntomas
   * distintos, una consulta rota que nadie veía.
   */
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => normalizar(d.id, d.data() as Record<string, unknown>))),
    (e) => onError?.(e)
  );
}
