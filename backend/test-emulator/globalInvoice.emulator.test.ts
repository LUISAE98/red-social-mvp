import { describe, it, expect } from "vitest";
import * as crypto from "crypto";
import * as admin from "firebase-admin";
import {
  ventasSinFacturarDelPeriodo,
  reservarVentasParaGlobal,
  confirmarVentasEnGlobal,
  ventasAtascadas,
  agruparGlobal,
  compraLibre,
} from "../src/facturacion/globalInvoice";

// ─────────────────────────────────────────────────────────────────────────────
// La factura global y su marca sobre las ventas que cubrió (§A2).
//
// Lo que se protege aquí es una sola cosa: **que ninguna venta pueda timbrarse dos veces**.
// Antes la global no escribía nada de vuelta, así que una venta incluida en ella seguía
// apareciendo como «sin facturar» para siempre — y el comprador todavía podía pedir su
// nominativa de algo que ya llevaba el sello del creador.
//
// Requiere FIRESTORE_EMULATOR_HOST. Cada test usa su propio creatorId.
// ─────────────────────────────────────────────────────────────────────────────

if (admin.apps.length === 0) admin.initializeApp({ projectId: "demo-vibra" });
const db = admin.firestore();

const PERIODO = "2026-07";

function newCreator(): string {
  return `creator_${crypto.randomUUID()}`;
}

/** Siembra una compra en el espejo del comprador, como la deja el trigger. */
async function sembrarVenta(
  creatorId: string,
  opts: { base?: number; iva?: number; congelada?: boolean; invoiced?: boolean } = {}
): Promise<string> {
  const buyerId = `buyer_${crypto.randomUUID()}`;
  const id = `profileDonation__${crypto.randomUUID()}`;
  const base = opts.base ?? 1850;
  const iva = opts.iva ?? 296;
  await db.doc(`users/${buyerId}/purchases/${id}`).set({
    creatorId,
    buyerId,
    type: "profile_donation",
    status: "paid",
    ...(opts.invoiced ? { invoiced: true } : {}),
    grossAmount: 100,
    taxAmount: 16,
    ...(opts.congelada === false
      ? {}
      : { fiscalMxn: { total: base + iva, base, iva, tipoCambio: 18.5, fuente: "cobro" } }),
    occurredAt: admin.firestore.Timestamp.fromDate(new Date(Date.UTC(2026, 6, 15, 18, 0, 0))),
  });
  return `users/${buyerId}/purchases/${id}`;
}

describe("qué entra en la factura global", () => {
  it("toma las ventas pagadas y congeladas, en PESOS", async () => {
    const creatorId = newCreator();
    await sembrarVenta(creatorId);
    await sembrarVenta(creatorId);

    const { ventas } = await ventasSinFacturarDelPeriodo(creatorId, PERIODO);
    expect(ventas).toHaveLength(2);

    const g = agruparGlobal(creatorId, PERIODO, ventas);
    // 1850 pesos, no los 100 dólares del ledger. Ese era el error.
    expect(g.base).toBe(3700);
    expect(g.tax).toBe(592);
  });

  it("deja fuera la que el comprador ya facturó", async () => {
    const creatorId = newCreator();
    await sembrarVenta(creatorId);
    await sembrarVenta(creatorId, { invoiced: true });

    const { ventas } = await ventasSinFacturarDelPeriodo(creatorId, PERIODO);
    expect(ventas).toHaveLength(1);
  });

  it("🚨 deja fuera la que no tiene pesos congelados, y la cuenta", async () => {
    const creatorId = newCreator();
    await sembrarVenta(creatorId);
    await sembrarVenta(creatorId, { congelada: false });

    const { ventas, sinCongelar } = await ventasSinFacturarDelPeriodo(creatorId, PERIODO);
    expect(ventas).toHaveLength(1);
    expect(sinCongelar).toBe(1);
  });
});

describe("la marca de la global", () => {
  it("🚨 una venta ya cubierta NO vuelve a entrar en otra global", async () => {
    // El corazón de §A2. Sin esto, la misma venta se timbra cada mes.
    const creatorId = newCreator();
    const path = await sembrarVenta(creatorId);

    const antes = await ventasSinFacturarDelPeriodo(creatorId, PERIODO);
    expect(antes.ventas).toHaveLength(1);

    await reservarVentasParaGlobal([path], PERIODO);
    await confirmarVentasEnGlobal({
      paths: [path],
      periodo: PERIODO,
      facturapiId: "fact_1",
      uuid: "UUID-1",
    });

    const despues = await ventasSinFacturarDelPeriodo(creatorId, PERIODO);
    expect(despues.ventas).toHaveLength(0);
  });

  it("guarda el folio y el UUID que la cubrieron, para poder cancelar con motivo 04", async () => {
    const creatorId = newCreator();
    const path = await sembrarVenta(creatorId);

    await reservarVentasParaGlobal([path], PERIODO);
    await confirmarVentasEnGlobal({
      paths: [path],
      periodo: PERIODO,
      facturapiId: "fact_9",
      uuid: "UUID-9",
    });

    const g = (await db.doc(path).get()).get("globalInvoice");
    expect(g.estado).toBe("emitida");
    expect(g.facturapiId).toBe("fact_9");
    expect(g.uuid).toBe("UUID-9");
    expect(g.periodo).toBe(PERIODO);
  });

  it("🚨 una venta RESERVADA que nunca se confirmó tampoco se cuela en otra global", async () => {
    // Es el fallo a media emisión: se apartó, se cayó el timbrado. Puede haberse timbrado o
    // no, así que meterla en la global siguiente sería arriesgarse a timbrarla dos veces.
    const creatorId = newCreator();
    const path = await sembrarVenta(creatorId);

    await reservarVentasParaGlobal([path], PERIODO);

    const { ventas } = await ventasSinFacturarDelPeriodo(creatorId, PERIODO);
    expect(ventas).toHaveLength(0);
  });

  it("las atascadas se pueden contar para revisarlas a mano", async () => {
    const creatorId = newCreator();
    const atascada = await sembrarVenta(creatorId);
    const buena = await sembrarVenta(creatorId);

    await reservarVentasParaGlobal([atascada, buena], PERIODO);
    await confirmarVentasEnGlobal({
      paths: [buena],
      periodo: PERIODO,
      facturapiId: "fact_2",
      uuid: "UUID-2",
    });

    expect(await ventasAtascadas(creatorId)).toBe(1);
  });

  it("la reserva devuelve solo lo que consiguió apartar", async () => {
    const creatorId = newCreator();
    const libre = await sembrarVenta(creatorId);
    const tomada = await sembrarVenta(creatorId, { invoiced: true });

    const reservadas = await reservarVentasParaGlobal([libre, tomada], PERIODO);
    expect(reservadas).toEqual([libre]);
  });

  it("🚨 la reserva NO pisa una compra que el comprador ya facturó", async () => {
    // La carrera de §A3: entre que el proceso lee las ventas del mes y llega a reservar, el
    // comprador pidió su nominativa. Sin la relectura en transacción, la venta acabaría en los
    // dos comprobantes.
    const creatorId = newCreator();
    const path = await sembrarVenta(creatorId, { invoiced: true });

    const reservadas = await reservarVentasParaGlobal([path], PERIODO);

    expect(reservadas).toEqual([]);
    expect((await db.doc(path).get()).get("globalInvoice")).toBeUndefined();
  });

  it("🚨 la reserva NO pisa una compra con la nominativa EN CURSO", async () => {
    // El caso más apretado: el comprador todavía no tiene su factura, pero ya la apartó. Si la
    // global se la llevara, se timbrarían las dos.
    const creatorId = newCreator();
    const path = await sembrarVenta(creatorId);
    await db.doc(path).set(
      { nominativaEnCurso: { reservadoEn: admin.firestore.Timestamp.now() } },
      { merge: true }
    );

    const reservadas = await reservarVentasParaGlobal([path], PERIODO);

    expect(reservadas).toEqual([]);
    expect((await db.doc(path).get()).get("globalInvoice")).toBeUndefined();
  });

  it("una compra con la nominativa en curso tampoco sale como «sin facturar»", async () => {
    const creatorId = newCreator();
    const path = await sembrarVenta(creatorId);
    await sembrarVenta(creatorId);
    await db.doc(path).set(
      { nominativaEnCurso: { reservadoEn: admin.firestore.Timestamp.now() } },
      { merge: true }
    );

    const { ventas } = await ventasSinFacturarDelPeriodo(creatorId, PERIODO);
    expect(ventas).toHaveLength(1);
    expect(ventas[0].path).not.toBe(path);
  });

  it("marcar dos veces no rompe nada: la confirmación pisa la reserva", async () => {
    const creatorId = newCreator();
    const path = await sembrarVenta(creatorId);

    await reservarVentasParaGlobal([path], PERIODO);
    await confirmarVentasEnGlobal({ paths: [path], periodo: PERIODO, facturapiId: "a", uuid: "A" });
    await confirmarVentasEnGlobal({ paths: [path], periodo: PERIODO, facturapiId: "a", uuid: "A" });

    const g = (await db.doc(path).get()).get("globalInvoice");
    expect(g.estado).toBe("emitida");
    expect(await ventasAtascadas(creatorId)).toBe(0);
  });
});

describe("la regla de exclusión mutua", () => {
  // Una compra la documenta un comprobante y solo uno. Las dos vías —la global y
  // `generateBuyerInvoice`— preguntan lo mismo antes de apartarla, y por eso la respuesta vive
  // en una sola función en vez de duplicada en cada lado.
  it("libre es no tener factura, ni una en curso, ni estar en una global", () => {
    expect(compraLibre({ status: "paid" })).toBe(true);

    expect(compraLibre({ invoiced: true })).toBe(false);
    expect(compraLibre({ nominativaEnCurso: { reservadoEn: 1 } })).toBe(false);
    expect(compraLibre({ globalInvoice: { estado: "emitida" } })).toBe(false);
    // 🚨 También la reservada a medias: no se sabe si llegó a timbrarse.
    expect(compraLibre({ globalInvoice: { estado: "emitiendo" } })).toBe(false);

    expect(compraLibre(undefined)).toBe(false);
  });
});
