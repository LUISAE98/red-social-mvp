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
import { leerImporteFiscal } from "./importeFiscal";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Periodicidad diaria **en el vocabulario de Facturapi**, no en el del SAT.
 *
 * Equivale a la clave `01` del catálogo `c_Periodicidad`; Facturapi hace la traducción al
 * armar el XML. Ver la nota larga en `emitirFacturaGlobal`.
 */
const PERIODICIDAD_FACTURAPI_DIARIA = "day";

/**
 * Una venta que quedó sin facturar en el mes.
 *
 * 💱 `base` y `tax` van en **PESOS**, no en dólares: son los importes congelados el día de la
 * venta (`fiscalMxn`). El ledger vive en USD, pero un CFDI mexicano no.
 */
export type VentaSinFacturar = {
  type: string;
  base: number;
  tax: number;
  /**
   * Ruta del documento de la compra, para poder MARCARLA cuando la global la cubra.
   *
   * Va la ruta y no la referencia de Firestore para que `agruparGlobal` siga siendo pura y
   * comprobable sin base de datos.
   */
  path: string;
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
 *
 * 🚨 **Una venta sin pesos congelados NO entra en la global.** Antes se sumaban sus dólares
 * como si fueran pesos, y una global de 100 USD se habría timbrado como $100 MXN. Quedarse
 * corto es un problema que se arregla con el backfill; timbrar un importe falso, no. Se
 * devuelven aparte para que el proceso lo cante en vez de callárselo.
 */
export async function ventasSinFacturarDelPeriodo(
  creatorId: string,
  periodo: string
): Promise<{ ventas: VentaSinFacturar[]; sinCongelar: number }> {
  const { desde, hasta } = rangoDelPeriodo(periodo);
  const snap = await db
    .collectionGroup("purchases")
    .where("creatorId", "==", creatorId)
    .where("occurredAt", ">=", admin.firestore.Timestamp.fromDate(desde))
    .where("occurredAt", "<", admin.firestore.Timestamp.fromDate(hasta))
    .get();

  const out: VentaSinFacturar[] = [];
  let sinCongelar = 0;
  for (const d of snap.docs) {
    const x = d.data();
    if (x.status !== "paid") continue;
    /**
     * 🚨 Solo lo que está LIBRE.
     *
     * Deja fuera lo que ya facturó el comprador, lo que tiene una nominativa en curso, y lo
     * apartado por otra global **sea cual sea su estado**, incluido `emitiendo`. Una venta a
     * medio marcar es una venta que quizá ya se timbró; meterla en la global del mes siguiente
     * sería timbrarla dos veces, con el sello del creador en ambas. Mejor atascada y visible en
     * el informe que colada.
     *
     * Esto es el primer filtro, el barato. El de verdad es la relectura en transacción de
     * `reservarVentasParaGlobal`, porque entre esta consulta y la reserva puede pasar de todo.
     */
    if (!compraLibre(x)) continue;

    const pesos = leerImporteFiscal(x.fiscalMxn);
    if (!pesos) {
      // Venta anterior al congelado, o comprador no mexicano. Ni una ni otra pueden entrar
      // con los dólares del ledger disfrazados de pesos.
      sinCongelar++;
      continue;
    }
    out.push({
      type: String(x.type ?? ""),
      base: pesos.base,
      tax: pesos.iva,
      path: d.ref.path,
    });
  }
  return { ventas: out, sinCongelar };
}

/**
 * Marca cada venta con la global que la cubrió, en DOS FASES.
 *
 * ⚠️ POR QUÉ DOS FASES Y NO UNA
 *
 * Timbrar y marcar no pueden ser atómicos: el timbrado es una llamada a Facturapi y las marcas
 * son cientos de documentos, muy por encima del límite de una transacción de Firestore. Así que
 * hay que elegir qué se rompe si falla a la mitad, y las dos opciones ingenuas son malas:
 *
 * - **Timbrar y luego marcar**: si el marcado falla a medias, las ventas sin marcar entran en la
 *   global del mes siguiente. Pero la primera global YA las incluyó ⇒ **timbradas dos veces**.
 * - **Marcar y luego timbrar**: si el timbrado falla, las ventas quedan marcadas y no vuelven a
 *   entrar en ninguna global ⇒ **nunca documentadas**.
 *
 * La salida es reservar primero con estado `emitiendo`, timbrar, y confirmar después:
 *
 * 1. `reservar()` — la venta queda apartada. `ventasSinFacturarDelPeriodo` ya la excluye, así que no
 *    puede colarse en otra global aunque todo lo demás se caiga.
 * 2. Se timbra.
 * 3. `confirmar()` — se le pega el folio y el UUID.
 *
 * Lo que se rompa en medio deja ventas en `emitiendo`, que **no se timbran dos veces** y salen
 * contadas en el informe del proceso para revisarlas a mano. Es el estado feo pero seguro.
 */
const LOTE = 400;

async function marcarEnLotes(
  paths: string[],
  valor: Record<string, unknown>
): Promise<void> {
  for (let i = 0; i < paths.length; i += LOTE) {
    const batch = db.batch();
    for (const p of paths.slice(i, i + LOTE)) {
      batch.set(db.doc(p), { globalInvoice: valor }, { merge: true });
    }
    await batch.commit();
  }
}

/**
 * ¿Esta compra está libre para que la reclame un comprobante?
 *
 * Libre es no tener ya una factura nominativa, ni una en curso, ni estar apartada por otra
 * global. Lo comparten los dos caminos —la global y `generateBuyerInvoice`— porque la regla es
 * una sola: **una compra la documenta un comprobante y solo uno**.
 */
export function compraLibre(x: Record<string, unknown> | undefined): boolean {
  if (!x) return false;
  if (x.invoiced === true) return false;
  if (x.nominativaEnCurso) return false;
  if (x.globalInvoice) return false;
  return true;
}

/**
 * ¿Puede el COMPRADOR reclamar esta compra para su factura nominativa?
 *
 * Es casi lo mismo que `compraLibre`, con una excepción que solo vale para este lado:
 * `liberada`. Una compra liberada es la que se sacó de una global cancelando con motivo 04
 * (§B7), precisamente para que este comprador pueda facturarla.
 *
 * 🚨 Sigue estando cerrada para la factura global. Si no, la global del día siguiente se la
 * llevaría antes de que él alcanzara a pedir su factura — se habría cancelado un CFDI para
 * nada, y de forma bastante cruel.
 */
export function compraReclamablePorNominativa(x: Record<string, unknown> | undefined): boolean {
  if (compraLibre(x)) return true;
  if (!x || x.invoiced === true || x.globalInvoice) return false;
  const n = x.nominativaEnCurso as { estado?: string } | undefined;
  return n?.estado === "liberada";
}

/**
 * Fase 1: aparta las ventas antes de timbrar, **en transacción**.
 *
 * 🚨 POR QUÉ TRANSACCIÓN Y POR QUÉ DEVUELVE LO QUE CONSIGUIÓ
 *
 * Entre que el proceso lee las ventas del mes y llega aquí, un comprador puede haber pedido su
 * factura nominativa de una de ellas. Con una escritura ciega, esa venta acabaría en los dos
 * comprobantes — el mismo doble timbrado que este bloque vino a impedir, solo que por la puerta
 * de al lado.
 *
 * Así que se relee dentro de la transacción y se salta lo que ya no está libre. Devuelve las
 * rutas que **de verdad** quedaron apartadas, y el importe de la global se calcula sobre esas,
 * no sobre las que se leyeron al principio.
 *
 * Se salta en silencio en vez de fallar: el comprador ya tiene su factura, que es el resultado
 * correcto. Al proceso mensual solo le toca no contarla dos veces.
 */
export async function reservarVentasParaGlobal(
  paths: string[],
  periodo: string
): Promise<string[]> {
  const reservadas: string[] = [];
  // Trozos holgados: una transacción admite 500 operaciones y aquí cada ruta gasta lectura y
  // escritura.
  const TROZO = 200;
  for (let i = 0; i < paths.length; i += TROZO) {
    const trozo = paths.slice(i, i + TROZO);
    const logradas = await db.runTransaction(async (tx) => {
      const refs = trozo.map((p) => db.doc(p));
      const snaps = await Promise.all(refs.map((r) => tx.get(r)));
      const ok: string[] = [];
      snaps.forEach((snap, n) => {
        if (!compraLibre(snap.data())) return;
        tx.set(
          refs[n],
          {
            globalInvoice: {
              periodo,
              estado: "emitiendo",
              reservadoEn: admin.firestore.FieldValue.serverTimestamp(),
            },
          },
          { merge: true }
        );
        ok.push(trozo[n]);
      });
      return ok;
    });
    reservadas.push(...logradas);
  }

  logger.info("global_invoice_reservadas", {
    periodo,
    pedidas: paths.length,
    reservadas: reservadas.length,
  });
  return reservadas;
}

/** Fase 3: les pega el folio de la global que ya se timbró. */
export async function confirmarVentasEnGlobal(params: {
  paths: string[];
  periodo: string;
  facturapiId: string | null;
  uuid: string | null;
}): Promise<void> {
  await marcarEnLotes(params.paths, {
    periodo: params.periodo,
    estado: "emitida",
    facturapiId: params.facturapiId,
    uuid: params.uuid,
    confirmadoEn: admin.firestore.FieldValue.serverTimestamp(),
  });
  logger.info("global_invoice_confirmadas", {
    periodo: params.periodo,
    ventas: params.paths.length,
    uuid: params.uuid,
  });
}

/**
 * Suelta las reservas `liberada` que ya caducaron (AUD-8).
 *
 * Una venta se marca `liberada` al sacarla de una global cancelando con motivo 04, para que el
 * comprador pueda facturarla. Pero si nunca la factura, esa marca la dejaba **fuera de toda
 * global para siempre** — y la venta seguiría necesitando comprobante.
 *
 * Pasado el plazo se suelta y vuelve al circuito normal: si el comprador no la quiso nominativa,
 * le toca ir a la global, que es donde le corresponde a lo que nadie pide facturado.
 */
const DIAS_LIBERADA = 30;

export async function soltarLiberadasCaducadas(): Promise<number> {
  // Una sola consulta para toda la plataforma, no una por creador (AUD-10).
  const corte = admin.firestore.Timestamp.fromMillis(
    Date.now() - DIAS_LIBERADA * 24 * 3_600_000
  );
  const snap = await db
    .collectionGroup("purchases")
    .where("nominativaEnCurso.estado", "==", "liberada")
    .where("nominativaEnCurso.reservadoEn", "<", corte)
    .get();
  if (snap.empty) return 0;

  const batch = db.batch();
  for (const d of snap.docs) {
    batch.set(
      d.ref,
      { nominativaEnCurso: admin.firestore.FieldValue.delete() },
      { merge: true }
    );
  }
  await batch.commit();
  logger.info("liberadas_caducadas", { ventas: snap.size });
  return snap.size;
}

/**
 * Qué creadores vendieron en un periodo.
 *
 * 🚨 UNA consulta para toda la plataforma, no una por creador (AUD-10). El proceso diario
 * recorría los `creatorTaxProfiles` enteros y lanzaba una consulta de grupo por cada uno: con
 * mil creadores, mil consultas al día para emitir un puñado de facturas. Ahora se pregunta al
 * revés — quién vendió ese día — y solo se trabaja sobre esos.
 */
export async function creadoresQueVendieron(periodo: string): Promise<Set<string>> {
  const { desde, hasta } = rangoDelPeriodo(periodo);
  const snap = await db
    .collectionGroup("purchases")
    .where("occurredAt", ">=", admin.firestore.Timestamp.fromDate(desde))
    .where("occurredAt", "<", admin.firestore.Timestamp.fromDate(hasta))
    .get();
  const out = new Set<string>();
  for (const d of snap.docs) {
    if (d.get("status") !== "paid") continue;
    const c = String(d.get("creatorId") ?? "").trim();
    if (c) out.add(c);
  }
  return out;
}

/**
 * Suelta las ventas que se quedaron apartadas por una global que nunca se timbró.
 *
 * 🚨 SOLO LAS QUE NO TIENEN FOLIO. Un `emitiendo` CON `facturapiId` significa que el CFDI
 *    existe y lo que falló fue algo posterior; soltarla la devolvería al circuito y la
 *    próxima global la timbraría otra vez. Ese caso se arregla confirmándola, no
 *    liberándola, y por eso aquí se salta y se cuenta aparte.
 *
 * Sin folio, en cambio, es seguro: el timbrado no llegó a ocurrir y la venta debe volver a
 * estar disponible. Sin esto, cualquier fallo de emisión deja las ventas bloqueadas hasta que
 * alguien entre a la base de datos a mano.
 */
export async function soltarAtascadasSinFolio(
  creatorId: string
): Promise<{ sueltas: number; conFolio: number }> {
  const snap = await db
    .collectionGroup("purchases")
    .where("creatorId", "==", creatorId)
    .where("globalInvoice.estado", "==", "emitiendo")
    .get();
  if (snap.empty) return { sueltas: 0, conFolio: 0 };

  const batch = db.batch();
  let sueltas = 0;
  let conFolio = 0;
  for (const d of snap.docs) {
    const g = d.get("globalInvoice") as { facturapiId?: string } | undefined;
    if (g?.facturapiId) {
      conFolio++;
      continue;
    }
    batch.set(d.ref, { globalInvoice: admin.firestore.FieldValue.delete() }, { merge: true });
    sueltas++;
  }
  if (sueltas > 0) await batch.commit();
  logger.info("atascadas_soltadas", { creatorId, sueltas, conFolio });
  return { sueltas, conFolio };
}

/**
 * Ventas que se quedaron en `emitiendo`: se reservaron y nadie las confirmó.
 *
 * Son las víctimas de un fallo a media emisión. No se timbran dos veces —quedan excluidas de
 * cualquier global futura— pero **puede que no estén documentadas**, así que hay que mirarlas.
 */
export async function ventasAtascadas(creatorId: string): Promise<number> {
  const snap = await db
    .collectionGroup("purchases")
    .where("creatorId", "==", creatorId)
    .where("globalInvoice.estado", "==", "emitiendo")
    .get();
  return snap.size;
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
      /**
       * 📅 Periodicidad DIARIA desde §A1 (2026-09-02).
       *
       * Era mensual, y el proceso corría el día 5 sobre el mes anterior — unos 35 días de
       * retraso sobre un plazo de **24 horas** (RMF 2026, regla 2.7.1.21). Incumplía por
       * definición en cuanto se encendiera el timbrado.
       *
       * 🚨 FACTURAPI NO USA LOS CÓDIGOS DEL SAT AQUÍ, USA PALABRAS EN INGLÉS.
       *
       *    Este campo es de la API de Facturapi, no del CFDI: ella traduce a la clave del
       *    catálogo `c_Periodicidad` al armar el XML. Mandarle el código `"01"` —que es lo
       *    correcto en el Anexo 20— devuelve un 400: «El campo global.periodicity no tiene un
       *    valor permitido». Costó una tarde descubrirlo, así que queda escrito.
       *
       *    La equivalencia con el catálogo del SAT, para que se pueda comprobar:
       *      day → 01 Diaria · week → 02 Semanal · fortnight → 03 Quincenal
       *      month → 04 Mensual · two_month → 05 Bimestral
       *
       * ⚠️ `months` sí es el MES en el que cae el día, no el día. Con periodicidad diaria el
       * Anexo 20 espera igualmente el mes y el año; el día concreto lo dan las operaciones.
       */
      global: {
        periodicity: PERIODICIDAD_FACTURAPI_DIARIA,
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
