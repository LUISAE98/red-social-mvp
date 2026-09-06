// Sacar una venta de una factura global ya timbrada (`pendientesimpuestos.md` §B7).
//
// EL CASO
//
// Un comprador pide su factura nominativa de una operación que ya quedó incluida en la factura
// global del creador. La cola de §B5 evita la mayoría de estos casos —una petición hecha a
// tiempo aparta la venta—, pero no todos: quien la pide tres semanas después llega tarde.
//
// EL PROCEDIMIENTO DEL SAT SON TRES PASOS
//
//   1. Cancelar la global con motivo **04**, «Operación nominativa relacionada en una factura
//      global». No lleva sustitución: el 04 no la exige, a diferencia del 01.
//   2. **Reexpedir la global sin esa operación.** Las demás ventas del periodo siguen
//      necesitando su comprobante.
//   3. Emitir la nominativa. Eso ya lo hace el comprador desde su pantalla.
//
// ⚠️ ES MANUAL Y A PROPÓSITO. Cancelar y reexpedir CFDI no puede dispararse solo: es un acto
// fiscal irreversible sobre un documento que ya existe. Lo lanza administración cuando el
// comprador lo pide.
//
// ⚠️ EL ORDEN NO ES NEGOCIABLE: CANCELAR Y LUEGO REEXPEDIR
//
// Si se reexpidiera primero y la cancelación fallara, quedarían **dos globales vivas cubriendo
// las mismas ventas** — timbradas dos veces, que es justo lo que todo este bloque evita. Al
// revés, un fallo deja el periodo con la global cancelada y las demás ventas sin cubrir: está
// mal, pero se arregla reintentando, y ningún CFDI dice algo falso mientras tanto.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { facturapiFetch, facturapiTestKey, facturapiUserKey, type FacturapiAuth } from "./facturapiClient";
import { getOrganizationTestKey } from "./facturapiOrganizations";
import {
  agruparGlobal,
  emitirFacturaGlobal,
  type VentaSinFacturar,
} from "./globalInvoice";
import { leerImporteFiscal } from "./importeFiscal";
import { registrarDocumento } from "./creatorMonthlyDocs";
import { requirePlatformMod } from "../authz";
import { dentroDePlazo, mensajeFueraDePlazo } from "./plazoCancelacion";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();
const REGION = "us-central1";

/** «Operación nominativa relacionada en una factura global» del catálogo del SAT. */
const MOTIVO_NOMINATIVA = "04";

/**
 * «Comprobante emitido con errores sin sustitución», para sacar de la global una venta que se
 * DEVOLVIÓ.
 *
 * 🚨 No es el `01`, aunque después se reexpida. El `01` exige indicar el documento sustituto **en
 *    la propia petición de cancelación**, y aquí se cancela ANTES de reexpedir — por el orden que
 *    explica la cabecera de este archivo, que no es negociable. En el momento de cancelar no hay
 *    nada que relacionar, así que el honesto es el `02`.
 */
const MOTIVO_DEVOLUCION = "02";

/**
 * Saca una venta de su factura global para que el comprador pueda tener la suya.
 *
 * Deja rastro en `cancelacionesGlobales` paso a paso: si algo falla a la mitad, el documento
 * dice exactamente dónde se quedó. Cancelar un CFDI no es algo que se pueda reconstruir
 * mirando el resultado.
 */
export async function liberarDeGlobal(params: {
  buyerId: string;
  purchaseId: string;
  /** Quién lo pidió, para el rastro. */
  pedidoPor: string;
  /**
   * Por qué se saca la venta de la global. Cambia el motivo de cancelación ante el SAT y lo que
   * le pasa a la compra después:
   *
   * · `nominativa` — el comprador pide su factura. Motivo 04, y la compra queda `liberada` para
   *   que él pueda facturarla sin que la global del día siguiente se la lleve.
   * · `devolucion` — se le devolvió el dinero. Motivo 02, y la compra queda marcada como
   *   devuelta: **no vuelve a ninguna global**, porque esa venta ya no existe.
   */
  causa?: "nominativa" | "devolucion";
}): Promise<{ canceladoUuid: string | null; nuevaGlobalUuid: string | null; ventasRestantes: number }> {
  const { buyerId, purchaseId, pedidoPor } = params;
  const causa = params.causa ?? "nominativa";
  const motivo = causa === "devolucion" ? MOTIVO_DEVOLUCION : MOTIVO_NOMINATIVA;

  logger.info("liberar_global_inicio", { buyerId, purchaseId, pedidoPor });

  const compraRef = db.doc(`users/${buyerId}/purchases/${purchaseId}`);
  const compraSnap = await compraRef.get();
  if (!compraSnap.exists) throw new HttpsError("not-found", "Compra no encontrada.");
  const compra = compraSnap.data() ?? {};

  const global = compra.globalInvoice as
    | { estado?: string; facturapiId?: string; uuid?: string; periodo?: string }
    | undefined;
  if (!global?.facturapiId || global.estado !== "emitida") {
    throw new HttpsError(
      "failed-precondition",
      "Esta compra no está en ninguna factura global timbrada, no hay nada que cancelar."
    );
  }
  const creatorId = String(compra.creatorId ?? "").trim();
  const periodo = String(global.periodo ?? "").trim();
  if (!creatorId || !periodo) {
    throw new HttpsError("failed-precondition", "A la marca de la global le faltan datos.");
  }

  /**
   * 🚨 EL PLAZO SE COMPRUEBA ANTES DE APARTAR NADA.
   *
   * Pasado el 31 de marzo del año siguiente el SAT ya no admite la cancelación. Descubrirlo por
   * el error del PAC funcionaría, pero llegaríamos con la venta a medio trámite y con un mensaje
   * que no le explica a nadie que existe otra vía. La global la emite el CREADOR con su sello,
   * así que el plazo es el suyo.
   */
  const emitidaEn = (compra.globalInvoice as { emitidaEn?: admin.firestore.Timestamp })?.emitidaEn;
  /*
   * ⚠️ El periodo puede venir como MES (`2026-08`) o como DÍA (`2026-08-31`), porque los
   *    comprobantes de la cadencia diaria anterior siguen existiendo. `new Date("2026-08")` da
   *    una fecha válida —el día 1— así que se le añade el día solo cuando falta.
   */
  const fechaGlobal =
    emitidaEn?.toDate?.() ??
    new Date(`${periodo.length === 7 ? `${periodo}-01` : periodo}T12:00:00Z`);
  if (!dentroDePlazo(fechaGlobal, "moral")) {
    throw new HttpsError("failed-precondition", mensajeFueraDePlazo(fechaGlobal, "moral"));
  }

  const fiscalSnap = await db.doc(`creatorTaxProfiles/${creatorId}`).get();
  const fiscal = fiscalSnap.exists ? fiscalSnap.data() ?? {} : {};
  const orgId = String(fiscal.facturapiOrgId ?? "").trim();
  if (!orgId || fiscal.csdStatus !== "valid") {
    // Reexpedir necesita el sello del creador. Cancelar sin poder reexpedir dejaría al resto
    // de sus ventas sin comprobante.
    throw new HttpsError(
      "failed-precondition",
      "El creador no tiene su sello digital vigente, así que la global no se puede reexpedir."
    );
  }

  // Las demás ventas que cubría la MISMA global. Se reexpide con todas menos esta.
  logger.info("liberar_global_puertas_ok", { creatorId, periodo, orgId });

  const hermanasSnap = await db
    .collectionGroup("purchases")
    .where("creatorId", "==", creatorId)
    .where("globalInvoice.facturapiId", "==", global.facturapiId)
    .get();

  const restantes: VentaSinFacturar[] = [];
  const refsRestantes: FirebaseFirestore.DocumentReference[] = [];
  for (const d of hermanasSnap.docs) {
    if (d.ref.path === compraRef.path) continue;
    const x = d.data();
    const pesos = leerImporteFiscal(x.fiscalMxn);
    if (!pesos) continue;
    restantes.push({ type: String(x.type ?? ""), base: pesos.base, tax: pesos.iva, path: d.ref.path });
    refsRestantes.push(d.ref);
  }

  logger.info("liberar_global_hermanas", {
    encontradas: hermanasSnap.size,
    restantes: restantes.length,
  });

  const rastro = db.collection("cancelacionesGlobales").doc();
  await rastro.set({
    creatorId,
    buyerId,
    purchaseId,
    periodo,
    globalAnterior: { facturapiId: global.facturapiId, uuid: global.uuid ?? null },
    ventasRestantes: restantes.length,
    estado: "cancelando",
    pedidoPor,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const orgKey = await getOrganizationTestKey(orgId);
  const auth: FacturapiAuth = { orgKey };

  // ── Paso 1 · Cancelar con motivo 04 ────────────────────────────────────────
  const cancel = await facturapiFetch<{ uuid?: string; status?: string }>(
    `/invoices/${global.facturapiId}?motive=${motivo}`,
    { method: "DELETE", auth }
  );
  if (!cancel.ok) {
    await rastro.set(
      { estado: "fallida", ultimoError: String(cancel.error).slice(0, 300) },
      { merge: true }
    );
    throw new HttpsError("internal", `No se pudo cancelar la global: ${String(cancel.error).slice(0, 200)}`);
  }
  await rastro.set({ estado: "reexpidiendo" }, { merge: true });

  /*
   * La venta sale de la global. Qué le pasa después depende de POR QUÉ salió.
   *
   * 🚨 Si el comprador va a facturarla, no se queda LIBRE del todo: se marca `liberada` para que
   *    la global del día siguiente no se la vuelva a llevar antes de que él alcance a pedir su
   *    factura. Sería una carrera cruel — se cancela un CFDI para él y se lo quitan al día
   *    siguiente.
   *
   * 🚨 Si fue una DEVOLUCIÓN, se marca `devuelta` y no vuelve a ninguna global: esa venta ya no
   *    existe, y dejarla libre haría que el proceso del día siguiente la volviera a facturar.
   */
  await compraRef.set(
    {
      globalInvoice: admin.firestore.FieldValue.delete(),
      ...(causa === "devolucion"
        ? {
            devuelta: {
              sacadaDe: global.facturapiId,
              motivo: MOTIVO_DEVOLUCION,
              enfechada: admin.firestore.FieldValue.serverTimestamp(),
            },
          }
        : {
            nominativaEnCurso: {
              estado: "liberada",
              reservadoEn: admin.firestore.FieldValue.serverTimestamp(),
              canceladaDe: global.facturapiId,
            },
          }),
    },
    { merge: true }
  );

  // ── Paso 2 · Reexpedir la global sin ella ──────────────────────────────────
  let nuevaUuid: string | null = null;
  if (restantes.length > 0) {
    const resumen = agruparGlobal(creatorId, periodo, restantes);
    const nueva = await emitirFacturaGlobal(resumen, orgId, String(fiscal.zip ?? ""));
    nuevaUuid = nueva.uuid ?? null;

    const batch = db.batch();
    for (const ref of refsRestantes) {
      batch.set(
        ref,
        {
          globalInvoice: {
            periodo,
            estado: "emitida",
            facturapiId: nueva.id,
            uuid: nuevaUuid,
            confirmadoEn: admin.firestore.FieldValue.serverTimestamp(),
          },
        },
        { merge: true }
      );
    }
    await batch.commit();

    // El registro del periodo apunta ahora a la global buena.
    await registrarDocumento({
      creatorId,
      periodo,
      tipo: "global",
      facturapiId: nueva.id,
      uuid: nuevaUuid,
      acumulado: resumen,
    });

    /**
     * 🧾 SE DEJA ESCRITO POR QUÉ CAMBIÓ DE FOLIO.
     *
     * El creador abre su wallet y ve que su factura del mes tiene otro folio que la semana
     * pasada. Sin esta marca no hay forma de que sepa qué pasó, y lo que pasó es normal y no
     * requiere que haga nada — pero un CFDI que cambia solo, sin explicación, asusta.
     *
     * Se lleva la CUENTA, no solo la última vez: en un mes con varios compradores pidiendo su
     * factura, la global se reexpide una vez por cada uno.
     */
    await db
      .collection("creatorMonthlyDocs")
      .doc(`${creatorId}_${periodo}_global`)
      .set(
        {
          reexpedida: {
            veces: admin.firestore.FieldValue.increment(1),
            ultimaEn: admin.firestore.FieldValue.serverTimestamp(),
            causa,
          },
        },
        { merge: true }
      );
  } else {
    /**
     * La global solo cubría esta venta. No se reexpide nada —una global vacía no existe— pero
     * el registro del periodo tiene que dejar de decir que hay una global viva, o `yaEmitido`
     * daría el día por documentado.
     */
    await db
      .collection("creatorMonthlyDocs")
      .doc(`${creatorId}_${periodo}_global`)
      .set(
        { facturapiId: null, uuid: null, timbrado: false, canceladaEn: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
  }

  await rastro.set(
    { estado: "hecha", nuevaGlobal: { uuid: nuevaUuid }, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );

  logger.info("global_liberada_motivo_04", {
    creatorId,
    buyerId,
    purchaseId,
    periodo,
    ventasRestantes: restantes.length,
  });

  return {
    canceladoUuid: global.uuid ?? null,
    nuevaGlobalUuid: nuevaUuid,
    ventasRestantes: restantes.length,
  };
}

export const cancelarGlobalPorNominativa = onCall(
  { region: REGION, cors: true, secrets: [facturapiTestKey, facturapiUserKey] },
  async (request) => {
    /**
     * 🚨 El supermoderador se identifica por el claim `role=moderator` MÁS sesión de Google,
     * no por un campo de Firestore. Aquí había un `userSnap.get("isPlatformMod")` que leía
     * un campo que no existe, así que esta función estaba cerrada para todo el mundo.
     */
    const uid = requirePlatformMod(request);

    const data = (request.data ?? {}) as Record<string, unknown>;
    const buyerId = String(data.buyerId ?? "").trim();
    const purchaseId = String(data.purchaseId ?? "").trim();
    if (!buyerId || !purchaseId) {
      throw new HttpsError("invalid-argument", "Faltan el comprador y la compra.");
    }

    /**
     * 🚨 SIN ESTO, CUALQUIER FALLO LLEGA COMO «internal» A SECAS.
     *
     * Una excepción que no sea `HttpsError` la convierte el runtime en un `internal` sin
     * mensaje, y como esta función no registraba nada, no quedaba rastro por ningún lado: ni
     * en el cliente, ni en los logs, ni en `cancelacionesGlobales` —que se escribe más tarde—.
     * Diagnosticar eso costó una tarde.
     */
    try {
      const causa = data.causa === "devolucion" ? "devolucion" : "nominativa";
      return await liberarDeGlobal({ buyerId, purchaseId, pedidoPor: uid, causa });
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      const mensaje = err instanceof Error ? err.message : String(err);
      logger.error("liberar_global_excepcion", {
        buyerId,
        purchaseId,
        err: mensaje,
        stack: err instanceof Error ? err.stack?.slice(0, 1500) : null,
      });
      throw new HttpsError("internal", `Falló al liberar de la global: ${mensaje.slice(0, 300)}`);
    }
  }
);
