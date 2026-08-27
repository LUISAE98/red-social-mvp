// Factura GLOBAL mensual — las ventas que ningún comprador pidió facturadas.
//
// La mayoría de los compradores no piden factura, pero la venta existió y hay que documentarla.
// Para eso está la factura global: una sola al mes que agrupa todo lo no facturado, con el
// receptor genérico de público en general.
//
// ⚠️ QUIÉN LA EMITE — DECISIÓN DE LUIS (2026-08-26): **Vibra, por cuenta del creador.**
//
// Bajo intermediación el vendedor es el creador, así que la obligación es suya. La alternativa
// era que cada uno emitiera la suya cada mes; no escala y deja expuesto a quien se olvide. Vibra
// la emite con SU sello digital, igual que las facturas de venta individuales.
//
// **Corolario que cambia el onboarding:** el sello se necesita desde la PRIMERA VENTA, no antes
// del primer retiro. Un creador que vende en marzo y sube el sello en junio deja tres meses sin
// factura global — y esos meses no se pueden recuperar sin trámite.
//
// Se distingue de `creatorMonthlyDocs` en el emisor: allí emite Vibra a su propio nombre (su
// comisión, sus retenciones); aquí emite **a nombre del creador**, en la organización de él.

import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import { facturapiFetch, type FacturapiAuth } from "./facturapiClient";
import { getOrganizationTestKey } from "./facturapiOrganizations";
import { productForType } from "./satProductCatalog";
import { rangoDelPeriodo } from "./creatorMonthlyDocs";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Una venta que quedó sin facturar en el mes. */
export type VentaSinFacturar = {
  type: string;
  base: number;
  tax: number;
};

export type ResumenGlobal = {
  creatorId: string;
  periodo: string;
  ventas: number;
  base: number;
  tax: number;
  /** Agrupado por tipo de servicio: la global lleva un concepto por tipo, no uno por venta. */
  porTipo: Record<string, { ventas: number; base: number; tax: number }>;
};

/**
 * Agrupa las ventas no facturadas de un mes.
 *
 * Un concepto por TIPO de servicio, no uno por venta: una global con seiscientos renglones es
 * inmanejable y no aporta nada — lo que el SAT necesita es el total por tipo de operación.
 *
 * Función PURA, para poder probarla sin Firestore.
 */
export function agruparGlobal(
  creatorId: string,
  periodo: string,
  ventas: VentaSinFacturar[]
): ResumenGlobal {
  const r: ResumenGlobal = { creatorId, periodo, ventas: 0, base: 0, tax: 0, porTipo: {} };
  for (const v of ventas) {
    if (!(v.base > 0)) continue;
    r.ventas += 1;
    r.base = round2(r.base + v.base);
    r.tax = round2(r.tax + v.tax);
    const t = (r.porTipo[v.type] ??= { ventas: 0, base: 0, tax: 0 });
    t.ventas += 1;
    t.base = round2(t.base + v.base);
    t.tax = round2(t.tax + v.tax);
  }
  return r;
}

/**
 * Lee las ventas del mes que NADIE facturó.
 *
 * Se leen del espejo de compras del comprador, que es donde vive `invoiced`. El ledger del
 * creador no sabe si el comprador pidió factura: eso pasa del lado de quien compra.
 */
export async function ventasSinFacturarDelMes(
  creatorId: string,
  periodo: string
): Promise<VentaSinFacturar[]> {
  const { desde, hasta } = rangoDelPeriodo(periodo);
  const snap = await db
    .collectionGroup("purchases")
    .where("creatorId", "==", creatorId)
    .where("occurredAt", ">=", admin.firestore.Timestamp.fromDate(desde))
    .where("occurredAt", "<", admin.firestore.Timestamp.fromDate(hasta))
    .get();

  const out: VentaSinFacturar[] = [];
  for (const d of snap.docs) {
    const x = d.data();
    if (x.status !== "paid") continue;
    if (x.invoiced === true) continue; // ya la pidió el comprador
    out.push({
      type: String(x.type ?? ""),
      base: Number(x.grossAmount) || 0,
      tax: Number(x.taxAmount) || 0,
    });
  }
  return out;
}

type FacturapiDoc = { id: string; uuid?: string };

/**
 * Emite la factura global del mes en la organización del creador, con SU sello.
 *
 * ⚠️ Requiere sello vigente. Sin él no hay emisor posible y el mes se queda sin documentar,
 * que es exactamente lo que obliga a pedir el sello desde la primera venta.
 */
export async function emitirFacturaGlobal(
  resumen: ResumenGlobal,
  orgId: string,
  /** Código postal FISCAL DEL CREADOR. En la global el domicilio es el del emisor. */
  zipEmisor: string
): Promise<FacturapiDoc> {
  const orgKey = await getOrganizationTestKey(orgId);
  const auth: FacturapiAuth = { orgKey };
  const { desde } = rangoDelPeriodo(resumen.periodo);

  const items = Object.entries(resumen.porTipo).map(([tipo, t]) => {
    const prod = productForType(tipo);
    // El importe guardado ya trae el impuesto aparte, así que la base va limpia.
    return {
      quantity: 1,
      product: {
        description: `${prod.description} · ${t.ventas} operación(es) · ${resumen.periodo}`,
        product_key: prod.productKey,
        unit_key: prod.unitKey,
        price: t.base,
        tax_included: false,
        taxes: t.tax > 0 ? [{ type: "IVA", rate: 0.16, factor: "Tasa" }] : [],
      },
    };
  });

  const res = await facturapiFetch<FacturapiDoc>("/invoices", {
    method: "POST",
    body: {
      // Receptor de público en general. 🔁 FISCALISTA: confirmar la forma exacta del global.
      customer: {
        legal_name: "PUBLICO EN GENERAL",
        tax_id: "XAXX010101000",
        tax_system: "616", // Sin obligaciones fiscales
        // El domicilio del receptor genérico es el del EMISOR, o sea el del creador.
        address: { zip: zipEmisor },
      },
      items,
      use: "S01", // Sin efectos fiscales
      payment_form: "04",
      payment_method: "PUE",
      currency: "MXN",
      // Periodicidad mensual del comprobante global.
      global: {
        periodicity: "04", // Mensual
        months: String(desde.getUTCMonth() + 1).padStart(2, "0"),
        year: desde.getUTCFullYear(),
      },
    },
    auth,
  });
  if (!res.ok) throw new Error(`factura global falló: ${String(res.error).slice(0, 200)}`);
  logger.info("global_invoice_issued", {
    creatorId: resumen.creatorId,
    periodo: resumen.periodo,
    uuid: res.data.uuid ?? null,
  });
  return res.data;
}
