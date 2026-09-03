import { describe, it, expect } from "vitest";
import * as crypto from "crypto";
import * as admin from "firebase-admin";
import { encolarFactura } from "../src/facturacion/colaDeFacturas";
import {
  reservarParaNominativa,
  liberarReservaNominativa,
} from "../src/facturacion/emitirNominativa";
import {
  ventasSinFacturarDelPeriodo,
  reservarVentasParaGlobal,
} from "../src/facturacion/globalInvoice";

// ─────────────────────────────────────────────────────────────────────────────
// Cola de facturas pendientes del sello del creador (§B5).
//
// Lo que se prueba no es que la petición se guarde —eso es lo fácil— sino la parte que de
// verdad importa: **una petición encolada saca la venta de la factura global**. Sin eso, la
// venta acabaría en la global, y cuando el creador subiera su sello habría que cancelarla con
// motivo 04 para poder emitir la nominativa.
//
// Requiere FIRESTORE_EMULATOR_HOST.
// ─────────────────────────────────────────────────────────────────────────────

if (admin.apps.length === 0) admin.initializeApp({ projectId: "demo-vibra" });
const db = admin.firestore();

const PERIODO = "2026-07";

function newId(p: string): string {
  return `${p}_${crypto.randomUUID()}`;
}

async function sembrarVenta(creatorId: string, buyerId: string): Promise<string> {
  const id = `profileDonation__${crypto.randomUUID()}`;
  await db.doc(`users/${buyerId}/purchases/${id}`).set({
    creatorId,
    buyerId,
    type: "profile_donation",
    status: "paid",
    grossAmount: 100,
    taxAmount: 16,
    fiscalMxn: { total: 2146, base: 1850, iva: 296, tipoCambio: 18.5, fuente: "cobro" },
    occurredAt: admin.firestore.Timestamp.fromDate(new Date(Date.UTC(2026, 6, 15, 18, 0, 0))),
  });
  return id;
}

describe("encolar una factura", () => {
  it("🚨 saca la venta de la factura global, que es lo que evita el motivo 04", async () => {
    const creatorId = newId("creator");
    const buyerId = newId("buyer");
    const compra = await sembrarVenta(creatorId, buyerId);

    const antes = await ventasSinFacturarDelPeriodo(creatorId, PERIODO);
    expect(antes.ventas).toHaveLength(1);

    const ok = await encolarFactura({
      buyerId,
      creatorId,
      billingProfileId: "perfil1",
      purchaseIds: [compra],
      motivo: "sin_sello",
    });

    expect(ok).toBe(true);
    const despues = await ventasSinFacturarDelPeriodo(creatorId, PERIODO);
    expect(despues.ventas).toHaveLength(0);
  });

  it("guarda REFERENCIAS, no una copia de los datos fiscales", async () => {
    // Los datos buenos son los del momento de emitir, no los de cuando la pidió. Copiarlos
    // aquí significaría timbrar con un RFC que el comprador ya cambió.
    const creatorId = newId("creator");
    const buyerId = newId("buyer");
    const compra = await sembrarVenta(creatorId, buyerId);

    await encolarFactura({
      buyerId,
      creatorId,
      billingProfileId: "perfil1",
      purchaseIds: [compra],
      motivo: "sin_sello",
    });

    const q = await db.collection("pendingInvoices").where("creatorId", "==", creatorId).get();
    expect(q.size).toBe(1);
    const d = q.docs[0].data();
    expect(d.billingProfileId).toBe("perfil1");
    expect(d.purchaseIds).toEqual([compra]);
    expect(d.estado).toBe("pendiente");
    // Ni rastro de RFC, razón social ni régimen.
    expect(Object.keys(d)).not.toContain("taxId");
    expect(Object.keys(d)).not.toContain("legalName");
  });

  it("marca la reserva como `en_cola`, distinguible de la de segundos", async () => {
    const creatorId = newId("creator");
    const buyerId = newId("buyer");
    const compra = await sembrarVenta(creatorId, buyerId);

    await encolarFactura({
      buyerId,
      creatorId,
      billingProfileId: "perfil1",
      purchaseIds: [compra],
      motivo: "sin_sello",
    });

    const p = await db.doc(`users/${buyerId}/purchases/${compra}`).get();
    expect(p.get("nominativaEnCurso").estado).toBe("en_cola");
  });

  it("🚨 NO encola si la global se le adelantó, y lo dice", async () => {
    // Encolar una venta que ya está en un CFDI timbrado sería prometer una factura que después
    // habría que arrancarle a la global.
    const creatorId = newId("creator");
    const buyerId = newId("buyer");
    const compra = await sembrarVenta(creatorId, buyerId);
    await reservarVentasParaGlobal([`users/${buyerId}/purchases/${compra}`], PERIODO);

    const ok = await encolarFactura({
      buyerId,
      creatorId,
      billingProfileId: "perfil1",
      purchaseIds: [compra],
      motivo: "sin_sello",
    });

    expect(ok).toBe(false);
    const q = await db.collection("pendingInvoices").where("creatorId", "==", creatorId).get();
    expect(q.size).toBe(0);
  });

  it("encola solo las compras que consiguió apartar", async () => {
    const creatorId = newId("creator");
    const buyerId = newId("buyer");
    const libre = await sembrarVenta(creatorId, buyerId);
    const tomada = await sembrarVenta(creatorId, buyerId);
    await reservarVentasParaGlobal([`users/${buyerId}/purchases/${tomada}`], PERIODO);

    await encolarFactura({
      buyerId,
      creatorId,
      billingProfileId: "perfil1",
      purchaseIds: [libre, tomada],
      motivo: "sin_sello",
    });

    const q = await db.collection("pendingInvoices").where("creatorId", "==", creatorId).get();
    expect(q.docs[0].get("purchaseIds")).toEqual([libre]);
  });

  it("🚨 una reserva `en_cola` NO se la lleva la global después", async () => {
    // Es lo que la mantiene a salvo durante las semanas que el creador tarde en subir el sello.
    const creatorId = newId("creator");
    const buyerId = newId("buyer");
    const compra = await sembrarVenta(creatorId, buyerId);
    const path = `users/${buyerId}/purchases/${compra}`;

    await encolarFactura({
      buyerId,
      creatorId,
      billingProfileId: "perfil1",
      purchaseIds: [compra],
      motivo: "sin_sello",
    });

    const reservadas = await reservarVentasParaGlobal([path], PERIODO);
    expect(reservadas).toEqual([]);
    expect((await db.doc(path).get()).get("globalInvoice")).toBeUndefined();
  });
});

describe("las dos clases de reserva", () => {
  it("la de `emitiendo` se suelta y la venta vuelve a estar libre", async () => {
    const creatorId = newId("creator");
    const buyerId = newId("buyer");
    const compra = await sembrarVenta(creatorId, buyerId);
    const path = `users/${buyerId}/purchases/${compra}`;

    await reservarParaNominativa([path], "emitiendo");
    expect((await ventasSinFacturarDelPeriodo(creatorId, PERIODO)).ventas).toHaveLength(0);

    await liberarReservaNominativa([path]);
    expect((await ventasSinFacturarDelPeriodo(creatorId, PERIODO)).ventas).toHaveLength(1);
  });
});

describe("compra liberada de una global (§B7)", () => {
  // Tras cancelar con motivo 04, la venta queda `liberada`. Es la única reserva asimétrica: le
  // cierra la puerta a la factura global y se la abre al comprador. Si fuera simétrica, el
  // trámite de cancelar un CFDI no habría servido de nada.
  it("🚨 la global NO puede volver a llevársela", async () => {
    const creatorId = newId("creator");
    const buyerId = newId("buyer");
    const compra = await sembrarVenta(creatorId, buyerId);
    const path = `users/${buyerId}/purchases/${compra}`;
    await db.doc(path).set(
      { nominativaEnCurso: { estado: "liberada", reservadoEn: admin.firestore.Timestamp.now() } },
      { merge: true }
    );

    expect(await reservarVentasParaGlobal([path], PERIODO)).toEqual([]);
    expect((await ventasSinFacturarDelPeriodo(creatorId, PERIODO)).ventas).toHaveLength(0);
  });

  it("🚨 pero el COMPRADOR sí puede reclamarla", async () => {
    const creatorId = newId("creator");
    const buyerId = newId("buyer");
    const compra = await sembrarVenta(creatorId, buyerId);
    const path = `users/${buyerId}/purchases/${compra}`;
    await db.doc(path).set(
      { nominativaEnCurso: { estado: "liberada", reservadoEn: admin.firestore.Timestamp.now() } },
      { merge: true }
    );

    expect(await reservarParaNominativa([path], "emitiendo")).toEqual([path]);
    expect((await db.doc(path).get()).get("nominativaEnCurso").estado).toBe("emitiendo");
  });

  it("una `en_cola` sigue cerrada para todos, incluido el comprador", async () => {
    // La diferencia con `liberada` es deliberada: en cola YA hay una factura prometida.
    const creatorId = newId("creator");
    const buyerId = newId("buyer");
    const compra = await sembrarVenta(creatorId, buyerId);
    const path = `users/${buyerId}/purchases/${compra}`;
    await encolarFactura({
      buyerId,
      creatorId,
      billingProfileId: "perfil1",
      purchaseIds: [compra],
      motivo: "sin_sello",
    });

    expect(await reservarParaNominativa([path], "emitiendo")).toEqual([]);
    expect(await reservarVentasParaGlobal([path], PERIODO)).toEqual([]);
  });
});
