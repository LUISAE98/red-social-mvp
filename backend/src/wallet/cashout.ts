// DEVOLUCIÓN EN EFECTIVO del saldo a favor (B7). Modelo B (reembolsos parciales):
//   - TODO el saldo restante del comprador es reembolsable a efectivo, porque cada peso
//     proviene de una devolución respaldada por un cargo original de Stripe.
//   - El comprador SOLICITA el efectivo (requestCashout): se RESERVA el crédito (se descuenta
//     del saldo, keyed por el id de la solicitud) y se crea `cashoutRequests/{id}` con el
//     snapshot de los orígenes (contra qué cargos se reembolsará).
//   - Un SUPERADMIN (moderador) revisa en el panel "Devoluciones" y aprueba o rechaza:
//       · aprobar → se disparan reembolsos de Stripe contra los cargos originales (parciales,
//         `amount` en centavos), del más reciente al más viejo, hasta cubrir el monto. El
//         crédito ya quedó descontado en la reserva.
//       · rechazar → se REVIERTE la reserva (el saldo vuelve al comprador).
//
// Salvaguardas anti-abuso: reembolso SOLO a la tarjeta original (lo fuerza Stripe), monto
// mínimo, una sola solicitud pendiente por comprador, bitácora completa (buyer/creator/motivo)
// e idempotencia por origen (los reembolsos ya hechos no se duplican en reintentos).

import { logger } from "firebase-functions";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { stripeFetch, stripeSecretKey } from "../payments/stripe/stripeClient";
import { spendBuyerCredit, revertBuyerCreditSpend } from "./buyerCredit";
import { capturePaymentIntentForRef } from "../payments/stripe/holdCapture";
import { refundExperienceToCredit } from "./refundToCredit";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** sourceType de la experiencia → colección donde vive el doc (para leer motivo/creador). */
const EXPERIENCE_COLLECTION: Record<string, string> = {
  greetingRequest: "greetingRequests",
  exclusiveSessionRequest: "exclusiveSessionRequests",
  meetGreetRequest: "meetGreetRequests",
};

type CashoutOrigin = {
  sourceType: string;
  sourceId: string;
  creatorId: string;
  type: string;
  reason: string;
  amount: number; // crédito emitido por esta devolución (MXN)
  chargedAmount: number; // lo que se cobró originalmente (MXN) → tope de reembolso
  stripePaymentIntentId: string;
};

/** Lee el saldo a favor actual del comprador. */
async function readBalance(uid: string): Promise<number> {
  const snap = await db.doc(`users/${uid}/buyerCredit/current`).get();
  return num(snap.data()?.balance);
}

/**
 * Arma el snapshot de orígenes (lotes de crédito por devolución) del comprador, enriquecido
 * con creador, motivo de rechazo, monto cobrado y el PaymentIntent de Stripe. Del más reciente
 * al más viejo (así los reembolsos golpean primero los cargos con más probabilidad de intactos).
 */
async function buildOrigins(uid: string): Promise<CashoutOrigin[]> {
  const movSnap = await db
    .collection(`users/${uid}/buyerCreditMovements`)
    .where("type", "==", "issued")
    .get();

  const rows = movSnap.docs
    .map((d) => ({
      sourceType: str(d.get("sourceType")),
      sourceId: str(d.get("sourceId")),
      amount: num(d.get("amount")),
      createdAt: d.get("createdAt"),
    }))
    .filter((r) => r.sourceType && r.sourceId && r.amount > 0)
    .sort((a, b) => {
      const ta = a.createdAt?.toMillis?.() ?? 0;
      const tb = b.createdAt?.toMillis?.() ?? 0;
      return tb - ta; // más reciente primero
    });

  const origins: CashoutOrigin[] = [];
  for (const r of rows) {
    const key = `${r.sourceType}__${r.sourceId}`;
    const [piSnap, expSnap] = await Promise.all([
      db.collection("paymentIntents").doc(key).get(),
      (async () => {
        const col = EXPERIENCE_COLLECTION[r.sourceType];
        return col ? db.collection(col).doc(r.sourceId).get() : null;
      })(),
    ]);
    const pi = piSnap.data() ?? {};
    const stripePaymentIntentId = str(pi.stripePaymentIntentId);
    if (!stripePaymentIntentId) continue; // sin cargo de Stripe → no reembolsable

    const exp = expSnap?.data() ?? {};
    const creatorId = str(exp.creatorId) || str(exp.recipientId) || str(pi.creatorId);
    const reason =
      str(exp.rejectionReason) ||
      (str(exp.status) === "rejected" ? "Rechazada por el creador" : "Devolución solicitada");
    const chargedAmount =
      num(pi.chargedAmount) || round2(num(pi.grossAmount || pi.baseAmount) + 3 + num(pi.taxAmount));

    origins.push({
      sourceType: r.sourceType,
      sourceId: r.sourceId,
      creatorId,
      type: str(exp.type) || r.sourceType,
      reason,
      amount: round2(r.amount),
      chargedAmount: round2(chargedAmount),
      stripePaymentIntentId,
    });
  }
  return origins;
}

/**
 * El COMPRADOR pide su saldo a favor en efectivo. Reserva el crédito (lo descuenta) y crea la
 * solicitud pendiente de revisión del superadmin. Una sola solicitud pendiente a la vez.
 */
export const requestCashout = onCall(
  { region: "us-central1", secrets: [stripeSecretKey] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");

    // Anónimos (invitados) no acumulan saldo a favor de experiencias → no aplica.
    if (request.auth?.token?.firebase?.sign_in_provider === "anonymous") {
      throw new HttpsError("permission-denied", "No disponible para invitados.");
    }

    const balance = await readBalance(uid);
    if (balance <= 0) {
      throw new HttpsError(
        "failed-precondition",
        "No tienes saldo a favor para reembolsar."
      );
    }

    // Una sola solicitud pendiente por comprador.
    const pending = await db
      .collection("cashoutRequests")
      .where("buyerId", "==", uid)
      .where("status", "==", "pending")
      .limit(1)
      .get();
    if (!pending.empty) {
      throw new HttpsError(
        "failed-precondition",
        "Ya tienes una solicitud de efectivo en revisión."
      );
    }

    const origins = await buildOrigins(uid);
    const refundable = round2(origins.reduce((s, o) => s + o.chargedAmount, 0));
    if (origins.length === 0 || refundable <= 0) {
      throw new HttpsError(
        "failed-precondition",
        "No hay devoluciones reembolsables a efectivo."
      );
    }

    // Perfil del comprador (denormalizado para el panel).
    const buyerSnap = await db.doc(`users/${uid}`).get();
    const buyer = buyerSnap.data() ?? {};

    const cashoutRef = db.collection("cashoutRequests").doc();
    const cashoutId = cashoutRef.id;

    // Reservar el crédito: se descuenta ahora, keyed por la solicitud (idempotente).
    const reserved = await spendBuyerCredit(uid, {
      amount: balance,
      sourceType: "cashout",
      sourceId: cashoutId,
    });
    if (reserved <= 0) {
      throw new HttpsError("failed-precondition", "No hay saldo disponible para reembolsar.");
    }

    await cashoutRef.set({
      buyerId: uid,
      buyerName: str(buyer.displayName) || str(buyer.name) || str(buyer.username),
      buyerUsername: str(buyer.username),
      amount: reserved,
      currency: "MXN",
      status: "pending",
      origins,
      refunds: [],
      createdAt: FieldValue.serverTimestamp(),
    });

    logger.info("cashout_requested", { cashoutId, uid, amount: reserved, origins: origins.length });
    return { ok: true, amount: reserved };
  }
);

/**
 * El COMPRADOR descarta el aviso de una solicitud RECHAZADA (el tache de la leyenda). Marca
 * `buyerDismissedAt` en su propia solicitud → persiste entre dispositivos y no vuelve a
 * aparecer. Solo el dueño; solo el flag (no toca saldo ni estado).
 */
export const dismissCashoutNotice = onCall(
  { region: "us-central1" },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
    const cashoutId = str(request.data?.cashoutId);
    if (!cashoutId) throw new HttpsError("invalid-argument", "Falta cashoutId.");
    const ref = db.collection("cashoutRequests").doc(cashoutId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "Solicitud no encontrada.");
    if (str(snap.get("buyerId")) !== uid) {
      throw new HttpsError("permission-denied", "No es tu solicitud.");
    }
    await ref.update({ buyerDismissedAt: FieldValue.serverTimestamp() });
    return { ok: true };
  }
);

/**
 * 🧪 HELPER DE PRUEBA (solo-moderador). Dado el `pi_...` de Stripe que ves en el dashboard,
 * CAPTURA el hold de una experiencia (lo cobra de verdad) y emite el crédito de devolución
 * reembolsable — para poder probar el cash-out sin esperar el día-6 ni el rechazo real.
 * Atajo de QA; NO forma parte del flujo de producción.
 */
export const devCaptureAndCredit = onCall(
  { region: "us-central1", secrets: [stripeSecretKey] },
  async (request) => {
    if (request.auth?.token?.["role"] !== "moderator") {
      throw new HttpsError("permission-denied", "Solo moderadores.");
    }
    const stripePaymentIntentId = str(request.data?.stripePaymentIntentId).trim();
    if (!stripePaymentIntentId) {
      throw new HttpsError("invalid-argument", "Falta stripePaymentIntentId (pi_...).");
    }

    // Localiza el paymentIntents por el pi_... de Stripe.
    const q = await db
      .collection("paymentIntents")
      .where("stripePaymentIntentId", "==", stripePaymentIntentId)
      .limit(1)
      .get();
    if (q.empty) {
      throw new HttpsError("not-found", "No hay paymentIntents con ese pi_...");
    }
    const doc = q.docs[0];
    const pi = doc.data();
    const externalReference = doc.id; // `${sourceType}__${sourceId}`
    const sourceType = str(pi.sourceType);
    const sourceId = str(pi.sourceId);
    if (!EXPERIENCE_COLLECTION[sourceType]) {
      throw new HttpsError("failed-precondition", `No es una experiencia con hold: ${sourceType}`);
    }

    // Resuelve comprador/creador (del intent o del doc de la experiencia).
    const expRef = db.collection(EXPERIENCE_COLLECTION[sourceType]).doc(sourceId);
    const expSnap = await expRef.get();
    const exp = expSnap.data() ?? {};
    const buyerId = str(pi.buyerId) || str(exp.buyerId);
    const creatorId = str(pi.creatorId) || str(exp.creatorId) || str(exp.recipientId);
    if (!buyerId) throw new HttpsError("failed-precondition", "Sin buyerId.");

    // 1) Capturar el hold (cobra de verdad → el cargo queda reembolsable).
    await capturePaymentIntentForRef(externalReference);
    const now = FieldValue.serverTimestamp();
    await doc.ref.set({ status: "paid", updatedAt: now }, { merge: true });
    if (expSnap.exists) {
      await expRef.set({ paymentStatus: "paid", paidAt: now, updatedAt: now }, { merge: true });
    }

    // 2) Emitir el crédito de devolución (reembolsable, con el cargo Stripe detrás).
    const credited = await refundExperienceToCredit({ buyerId, creatorId, sourceType, sourceId });

    logger.info("dev_capture_and_credit", { externalReference, buyerId, credited });
    return { ok: true, externalReference, buyerId, credited };
  }
);

/**
 * El SUPERADMIN (moderador) resuelve una solicitud: `approve` dispara los reembolsos de Stripe
 * contra los cargos originales (parciales, del más reciente al más viejo hasta cubrir el monto);
 * `reject` revierte la reserva (el saldo vuelve al comprador). Retry-safe por origen.
 */
export const resolveCashout = onCall(
  { region: "us-central1", secrets: [stripeSecretKey] },
  async (request) => {
    if (request.auth?.token?.["role"] !== "moderator") {
      throw new HttpsError("permission-denied", "Acceso solo para moderadores.");
    }
    const moderatorUid = request.auth?.uid ?? "";
    const cashoutId = str(request.data?.cashoutId);
    const action = str(request.data?.action);
    const note = str(request.data?.note);
    if (!cashoutId) throw new HttpsError("invalid-argument", "Falta cashoutId.");
    if (action !== "approve" && action !== "reject") {
      throw new HttpsError("invalid-argument", "Acción no válida.");
    }

    const ref = db.collection("cashoutRequests").doc(cashoutId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "Solicitud no encontrada.");
    const data = snap.data() ?? {};
    if (str(data.status) !== "pending") {
      throw new HttpsError("failed-precondition", "La solicitud ya fue resuelta.");
    }
    const buyerId = str(data.buyerId);
    const total = num(data.amount);

    // ---- RECHAZAR: revertir la reserva (saldo vuelve al comprador) ----
    if (action === "reject") {
      await revertBuyerCreditSpend(buyerId, { sourceType: "cashout", sourceId: cashoutId });
      await ref.update({
        status: "rejected",
        resolvedBy: moderatorUid,
        resolvedAt: FieldValue.serverTimestamp(),
        rejectionNote: note,
      });
      logger.info("cashout_rejected", { cashoutId, buyerId, total });
      return { ok: true };
    }

    // ---- APROBAR: reembolsos de Stripe contra los cargos originales ----
    const origins = Array.isArray(data.origins) ? (data.origins as CashoutOrigin[]) : [];
    const alreadyDone = Array.isArray(data.refunds) ? data.refunds : [];
    const doneKeys = new Set(
      alreadyDone.map((r: { sourceType?: string; sourceId?: string }) => `${r.sourceType}__${r.sourceId}`)
    );
    let refundedSoFar = round2(
      alreadyDone.reduce((s: number, r: { amount?: number }) => s + num(r.amount), 0)
    );

    let remaining = round2(total - refundedSoFar);
    for (const o of origins) {
      if (remaining <= 0) break;
      const key = `${o.sourceType}__${o.sourceId}`;
      if (doneKeys.has(key)) continue; // ya reembolsado en un intento previo
      if (!o.stripePaymentIntentId) continue;

      const alloc = round2(Math.min(remaining, num(o.chargedAmount)));
      if (alloc <= 0) continue;

      const res = await stripeFetch<{ id?: string }>("/refunds", {
        method: "POST",
        form: {
          payment_intent: o.stripePaymentIntentId,
          amount: Math.round(alloc * 100), // centavos
          reason: "requested_by_customer",
          metadata: { cashoutId, buyerId, sourceType: o.sourceType, sourceId: o.sourceId },
        },
        idempotencyKey: `cashout_${cashoutId}_${key}`,
      });

      if (!res.ok) {
        await ref.update({ lastError: res.error.slice(0, 300), lastErrorAt: FieldValue.serverTimestamp() });
        logger.error("cashout_refund_failed", { cashoutId, key, err: res.error.slice(0, 300) });
        throw new HttpsError(
          "internal",
          "Un reembolso falló en Stripe. Se reintentará al aprobar de nuevo (los ya hechos no se duplican)."
        );
      }

      await ref.update({
        refunds: FieldValue.arrayUnion({
          sourceType: o.sourceType,
          sourceId: o.sourceId,
          paymentIntent: o.stripePaymentIntentId,
          refundId: str(res.data?.id),
          amount: alloc,
        }),
      });
      refundedSoFar = round2(refundedSoFar + alloc);
      remaining = round2(remaining - alloc);
    }

    await ref.update({
      status: "approved",
      refundedAmount: refundedSoFar,
      resolvedBy: moderatorUid,
      resolvedAt: FieldValue.serverTimestamp(),
      lastError: FieldValue.delete(),
    });
    logger.info("cashout_approved", { cashoutId, buyerId, refundedAmount: refundedSoFar });
    return { ok: true, refundedAmount: refundedSoFar };
  }
);
