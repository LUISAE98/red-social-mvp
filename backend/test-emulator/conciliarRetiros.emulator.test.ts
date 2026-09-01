// La conciliación de los retiros que van en camino.
//
// 🚨 ES EL ÚNICO CAMINO DEL SISTEMA QUE DEVUELVE DINERO SOLO, sin que nadie lo pida.
//
// Un `OutboundPayment` nace en `processing` y tarda de uno a siete días en llegar al banco.
// En ese trayecto puede volver: cuenta cerrada, datos que no coinciden, el banco que lo
// rechaza. Stripe lo marca `returned` —típicamente a los 2-3 días hábiles— y ahí **el dinero
// vuelve a nuestra cuenta pero el creador ya lo tenía descontado de su saldo**.
//
// Si esta función no lo devuelve, el creador pierde su dinero en silencio y nadie se entera
// hasta que reclama. Hasta el 2026-08-31 ni siquiera existía: se marcaba `paid` al crear el
// pago, así que un retiro devuelto quedaba como cobrado para siempre.
//
// Se prueba contra el emulador porque toca Firestore de verdad, con `leerPago` sustituido:
// lo que se comprueba es qué hace la función con cada respuesta de Stripe, no Stripe.

import { describe, it, expect, beforeAll, vi } from "vitest";
import * as crypto from "crypto";
import * as admin from "firebase-admin";

import { conciliarRetirosEnCamino } from "../src/wallet/withdrawals";

/**
 * Qué contesta Stripe en cada test. Se cambia antes de llamar a la función.
 *
 * Vitest ELEVA los `vi.mock` por encima de los imports del archivo, así que el import de
 * abajo ya recibe la versión sustituida aunque esté escrito antes en el código.
 */
let respuestaDeStripe: { ok: true; estado: string } | { ok: false; motivo: string } = {
  ok: true,
  estado: "processing",
};

vi.mock("../src/payments/stripe/outboundPayment", () => ({
  leerPago: async () => respuestaDeStripe,
  enviarPago: async () => ({ ok: false, motivo: "no se usa en este test" }),
}));

if (admin.apps.length === 0) admin.initializeApp({ projectId: "demo-vibra" });
const db = admin.firestore();

function nuevoId(): string {
  return `c_${crypto.randomUUID()}`;
}

/** Un creador con un retiro YA enviado: su saldo está descontado y las retenciones consumidas. */
async function sembrarRetiroEnCamino(creatorId: string) {
  const resumen = {
    currency: "USD",
    lifetimeEarnedNet: 400,
    // Ya se le descontó al solicitar: es lo que hay que devolverle si el banco lo rechaza.
    withdrawnNet: 400,
    pendingMxVatCollected: 0,
    pendingRetainedIsr: 0,
    pendingRetainedIva: 0,
    pendingCommissionVat: 0,
  };
  await db.doc(`users/${creatorId}/walletSummary/current`).set(resumen);

  const ref = db.collection("withdrawalRequests").doc();
  await ref.set({
    creatorId,
    status: "sent",
    currency: "USD",
    saldo: 400,
    ivaCobrado: 64,
    isr: 10,
    iva: 32,
    ivaComision: 16,
    neto: 406,
    route: "stripe",
    outboundPaymentId: `obp_test_${crypto.randomUUID()}`,
  });
  return ref;
}

async function leerResumen(creatorId: string) {
  const snap = await db.doc(`users/${creatorId}/walletSummary/current`).get();
  return snap.data() as Record<string, number>;
}

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST no está definido. Corre: npm run test:emulator");
  }
});

describe("conciliarRetirosEnCamino", () => {
  it("🟢 `posted` cierra el retiro como pagado y NO toca el saldo", async () => {
    const creatorId = nuevoId();
    const ref = await sembrarRetiroEnCamino(creatorId);
    respuestaDeStripe = { ok: true, estado: "posted" };

    await conciliarRetirosEnCamino();

    const w = (await ref.get()).data() ?? {};
    expect(w.status).toBe("paid");
    expect(w.outboundStatus).toBe("posted");
    expect(w.paidAt).toBeTruthy();

    // El dinero salió de verdad: el saldo se queda descontado.
    const s = await leerResumen(creatorId);
    expect(s.withdrawnNet).toBe(400);
  });

  it("🚨 `returned` devuelve el saldo Y las retenciones, y marca el retiro fallido", async () => {
    const creatorId = nuevoId();
    const ref = await sembrarRetiroEnCamino(creatorId);
    respuestaDeStripe = { ok: true, estado: "returned" };

    await conciliarRetirosEnCamino();

    const w = (await ref.get()).data() ?? {};
    expect(w.status).toBe("failed");
    expect(w.outboundStatus).toBe("returned");
    // Un rechazo mudo es lo peor que se le puede enseñar a alguien esperando dinero.
    expect(String(w.rejectionReason)).toContain("returned");

    const s = await leerResumen(creatorId);
    // El saldo vuelve entero.
    expect(s.withdrawnNet).toBe(0);
    // Y las retenciones también: se consumieron al solicitar y hay que reponerlas.
    expect(s.pendingMxVatCollected).toBe(64);
    expect(s.pendingRetainedIsr).toBe(10);
    expect(s.pendingRetainedIva).toBe(32);
    expect(s.pendingCommissionVat).toBe(16);
  });

  it("🚨 `failed` devuelve igual que `returned`", async () => {
    const creatorId = nuevoId();
    await sembrarRetiroEnCamino(creatorId);
    respuestaDeStripe = { ok: true, estado: "failed" };

    await conciliarRetirosEnCamino();

    const s = await leerResumen(creatorId);
    expect(s.withdrawnNet).toBe(0);
    expect(s.pendingRetainedIsr).toBe(10);
  });

  it("🟢 `processing` lo deja en camino y no devuelve nada", async () => {
    const creatorId = nuevoId();
    const ref = await sembrarRetiroEnCamino(creatorId);
    respuestaDeStripe = { ok: true, estado: "processing" };

    await conciliarRetirosEnCamino();

    expect((await ref.get()).data()?.status).toBe("sent");
    // 🚨 Devolverle el saldo de un pago que sigue vivo sería pagarle dos veces.
    expect((await leerResumen(creatorId)).withdrawnNet).toBe(400);
  });

  it("🚨 si Stripe no contesta, NO se toca nada", async () => {
    // Un fallo de red no puede convertirse en un retiro dado por bueno ni en un saldo
    // devuelto. Se reintenta en la siguiente pasada, que es dentro de una hora.
    const creatorId = nuevoId();
    const ref = await sembrarRetiroEnCamino(creatorId);
    respuestaDeStripe = { ok: false, motivo: "timeout" };

    await conciliarRetirosEnCamino();

    expect((await ref.get()).data()?.status).toBe("sent");
    expect((await leerResumen(creatorId)).withdrawnNet).toBe(400);
  });

  it("🚨 conciliar DOS VECES un retiro devuelto no devuelve el saldo dos veces", async () => {
    // El cron corre cada hora y una pasada puede solaparse con la siguiente. La transacción
    // relee el estado y solo actúa si sigue en `sent`; sin eso, el creador cobraría de más.
    const creatorId = nuevoId();
    await sembrarRetiroEnCamino(creatorId);
    respuestaDeStripe = { ok: true, estado: "returned" };

    await conciliarRetirosEnCamino();
    await conciliarRetirosEnCamino();

    const s = await leerResumen(creatorId);
    expect(s.withdrawnNet).toBe(0);
    expect(s.pendingRetainedIsr).toBe(10);
  });
});
