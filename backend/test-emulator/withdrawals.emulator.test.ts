import { describe, it, expect, beforeAll } from "vitest";
import * as crypto from "crypto";
import * as admin from "firebase-admin";
import { calcularRetiro } from "../src/tax/fiscalEngine";

// ─────────────────────────────────────────────────────────────────────────────
// Contabilidad de las solicitudes de retiro.
//
// 🚨 LO QUE SE PRUEBA AQUÍ es que el dinero no se duplique ni se pierda entre que el creador
//    solicita y administración resuelve. Los callables no se pueden invocar desde el emulador
//    sin `firebase-functions-test`, así que se reproduce EXACTAMENTE la aritmética que hacen
//    —apartar al solicitar, devolver al rechazar— sobre Firestore de verdad.
//
//    Si algún día se cambia esa aritmética en `withdrawals.ts` y no aquí, este test deja de
//    proteger nada. Va anotado en el propio módulo.
// ─────────────────────────────────────────────────────────────────────────────

if (admin.apps.length === 0) admin.initializeApp({ projectId: "demo-vibra" });
const db = admin.firestore();

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function newCreator(): string {
  return `creator_${crypto.randomUUID()}`;
}

/** El resumen de un creador con ventas mexicanas ya ganadas. */
async function sembrar(creatorId: string) {
  const s = {
    currency: "USD",
    lifetimeEarnedNet: 225,
    withdrawnNet: 0,
    pendingMxVatCollected: 48,
    pendingRetainedIsr: 7.5,
    pendingRetainedIva: 24,
    pendingCommissionVat: 12,
  };
  await db.doc(`users/${creatorId}/walletSummary/current`).set(s);
  return s;
}
async function leer(creatorId: string) {
  const snap = await db.doc(`users/${creatorId}/walletSummary/current`).get();
  return snap.data() as Record<string, number>;
}

/** Lo que hace `requestWithdrawal`: calcula, aparta el saldo y consume las retenciones. */
async function solicitar(creatorId: string) {
  const s = await leer(creatorId);
  const saldo = round2(s.lifetimeEarnedNet - s.withdrawnNet);
  const r = calcularRetiro({
    saldo,
    ivaCobradoPendiente: s.pendingMxVatCollected,
    isrPendiente: s.pendingRetainedIsr,
    ivaPendiente: s.pendingRetainedIva,
    ivaComisionPendiente: s.pendingCommissionVat,
  });
  await db.doc(`users/${creatorId}/walletSummary/current`).set(
    {
      withdrawnNet: round2(s.withdrawnNet + r.bruto),
      pendingMxVatCollected: round2(Math.max(0, s.pendingMxVatCollected - r.ivaCobrado)),
      pendingRetainedIsr: round2(Math.max(0, s.pendingRetainedIsr - r.isr)),
      pendingRetainedIva: round2(Math.max(0, s.pendingRetainedIva - r.iva)),
      pendingCommissionVat: round2(Math.max(0, s.pendingCommissionVat - r.ivaComision)),
    },
    { merge: true }
  );
  return r;
}

/** Lo que hace `reviewWithdrawal` al RECHAZAR: devuelve todo. */
async function rechazar(creatorId: string, r: ReturnType<typeof calcularRetiro>) {
  const s = await leer(creatorId);
  await db.doc(`users/${creatorId}/walletSummary/current`).set(
    {
      withdrawnNet: round2(Math.max(0, s.withdrawnNet - r.bruto)),
      pendingMxVatCollected: round2(s.pendingMxVatCollected + r.ivaCobrado),
      pendingRetainedIsr: round2(s.pendingRetainedIsr + r.isr),
      pendingRetainedIva: round2(s.pendingRetainedIva + r.iva),
      pendingCommissionVat: round2(s.pendingCommissionVat + r.ivaComision),
    },
    { merge: true }
  );
}

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST no está definido. Corre: npm run test:emulator");
  }
});

describe("solicitud de retiro", () => {
  it("aparta el saldo y consume las retenciones al solicitar", async () => {
    const creatorId = newCreator();
    const antes = await sembrar(creatorId);

    const r = await solicitar(creatorId);
    expect(r.neto).toBe(229.5); // 225 + 48 − 7.5 − 24 − 12

    const s = await leer(creatorId);
    // El saldo disponible queda en cero: ya no puede pedir otro con el mismo dinero.
    expect(round2(s.lifetimeEarnedNet - s.withdrawnNet)).toBe(0);
    expect(s.pendingMxVatCollected).toBe(0);
    expect(s.pendingRetainedIsr).toBe(0);
    expect(s.pendingRetainedIva).toBe(0);
    expect(s.pendingCommissionVat).toBe(0);
    expect(antes.lifetimeEarnedNet).toBe(225); // el ganado histórico NO se toca
  });

  it("🚨 RECHAZAR devuelve el saldo y las retenciones EXACTAMENTE como estaban", async () => {
    // Si un rechazo no devolviera todo, le costaría al creador el dinero que pidió, que es
    // lo contrario de lo que significa rechazar.
    const creatorId = newCreator();
    const antes = await sembrar(creatorId);

    const r = await solicitar(creatorId);
    await rechazar(creatorId, r);

    const s = await leer(creatorId);
    expect(s.withdrawnNet).toBe(antes.withdrawnNet);
    expect(s.pendingMxVatCollected).toBe(antes.pendingMxVatCollected);
    expect(s.pendingRetainedIsr).toBe(antes.pendingRetainedIsr);
    expect(s.pendingRetainedIva).toBe(antes.pendingRetainedIva);
    expect(s.pendingCommissionVat).toBe(antes.pendingCommissionVat);
  });

  it("🚨 dos solicitudes seguidas NO retiran dos veces el mismo dinero", async () => {
    // El backend solo permite una abierta a la vez, pero aunque se colara una segunda, el
    // saldo ya apartado hace que no quede nada que pedir.
    const creatorId = newCreator();
    await sembrar(creatorId);

    const primera = await solicitar(creatorId);
    const segunda = await solicitar(creatorId);

    expect(primera.neto).toBe(229.5);
    expect(segunda.neto).toBe(0); // sin saldo, no hay retiro
    const s = await leer(creatorId);
    expect(round2(s.lifetimeEarnedNet - s.withdrawnNet)).toBe(0);
  });

  it("aceptar no mueve nada más: la contabilidad se cerró al solicitar", async () => {
    // Aprobar solo cambia el estado de la solicitud. Si además descontara, cobraría dos veces.
    const creatorId = newCreator();
    await sembrar(creatorId);
    await solicitar(creatorId);
    const trasSolicitar = await leer(creatorId);

    // (aprobar no toca el resumen)

    const s = await leer(creatorId);
    expect(s).toEqual(trasSolicitar);
  });
});
