// Cancelar un comprobante mensual del creador — la comisión o la constancia de retenciones.
//
// EL CASO
//
// Un mes se emitió con datos equivocados y hay que rehacerlo. Hasta el 2026-09-04 no había forma:
// el candado que impide emitir dos veces el mismo mes solo se podía quitar a mano desde la base
// de datos, con un script que **dejaba el CFDI vivo en Facturapi**. En sandbox daba igual; en
// producción eso son dos comprobantes vigentes del mismo periodo, que es justo lo que el candado
// existe para evitar.
//
// ⚠️ EL MOTIVO ES EL `02`, Y NO ES INTERCAMBIABLE
//
// El catálogo del SAT tiene cuatro. El `01` es «con errores CON sustitución» y **exige que el
// documento nuevo ya exista**, para relacionarlo. Aquí se cancela ANTES de reexpedir —el mes se
// vuelve a correr después, desde el panel— así que en el momento de cancelar no hay nada con qué
// relacionar. El honesto es el `02`, «con errores sin sustitución».
//
// ⚠️ LOS DOS DOCUMENTOS NO SE CANCELAN IGUAL
//
// - **La constancia** es un CFDI de retenciones: se cancela al instante y **no necesita que el
//   creador acepte**. Lo dice la propia documentación de Facturapi.
// - **La comisión** es una factura normal a nombre del creador. Por encima de 1 000 pesos el SAT
//   exige su aceptación, y hasta que la dé el comprobante queda **en proceso**, no cancelado.
//
// 🚨 De ahí la regla de este módulo: **el candado solo se suelta cuando el CFDI está de verdad
//    cancelado**. Si queda en proceso, el registro se marca y se queda donde está. Soltarlo antes
//    permitiría reexpedir mientras el viejo sigue vigente.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { facturapiFetch, facturapiTestKey, facturapiUserKey } from "./facturapiClient";
import { requirePlatformMod } from "../authz";
import { dentroDePlazo, mensajeFueraDePlazo } from "./plazoCancelacion";

const REGION = "us-central1";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

/** «Comprobante emitido con errores sin relación». Ver la nota de arriba. */
const MOTIVO_SIN_SUSTITUCION = "02";

/** Los dos comprobantes mensuales que se pueden cancelar. */
export type TipoComprobanteMensual = "comision" | "retenciones";

/**
 * Cada tipo vive en un endpoint distinto de Facturapi, y eso decide cómo se cancela.
 *
 * No es un detalle de implementación: la constancia va por `/retentions`, que cancela en firme, y
 * la comisión por `/invoices`, que puede quedar esperando al receptor.
 */
const ENDPOINT: Record<TipoComprobanteMensual, string> = {
  comision: "invoices",
  retenciones: "retentions",
};

export type ResultadoCancelacion = {
  /** Qué se canceló. */
  tipo: TipoComprobanteMensual;
  /** Folio de Facturapi del documento cancelado, o null si nunca se timbró. */
  folio: string | null;
  /** UUID del SAT, si lo tenía. */
  uuid: string | null;
  /**
   * `cancelado` — en firme, el mes ya se puede volver a emitir.
   * `en_proceso` — esperando que el creador acepte. El candado sigue puesto.
   * `sin_timbrar` — no había CFDI, solo el registro. Se retiró sin más.
   */
  estado: "cancelado" | "en_proceso" | "sin_timbrar";
  /** Si el mes quedó libre para volver a emitirse. */
  liberado: boolean;
};

/**
 * Cancela el comprobante y, si queda en firme, retira el candado del mes.
 *
 * El registro **no se borra**: se copia a `creatorMonthlyDocsAnulados` con quién lo pidió y en
 * qué estado quedó el CFDI. Un mes que se emitió dos veces tiene que poder explicarse años
 * después, y para eso hace falta saber que hubo un documento anterior y qué pasó con él.
 */
export async function cancelarComprobanteMensual(params: {
  creatorId: string;
  /** Mes natural, `YYYY-MM`. */
  periodo: string;
  tipo: TipoComprobanteMensual;
  /** Quién lo pidió, para el rastro. */
  pedidoPor: string;
}): Promise<ResultadoCancelacion> {
  const { creatorId, periodo, tipo, pedidoPor } = params;
  const id = `${creatorId}_${periodo}_${tipo}`;

  logger.info("cancelar_mensual_inicio", { id, pedidoPor });

  const ref = db.collection("creatorMonthlyDocs").doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "No hay ningún comprobante de ese creador para ese mes.");
  }

  const datos = snap.data() ?? {};
  const folio = String(datos.facturapiId ?? "").trim() || null;
  const uuid = String(datos.uuid ?? "").trim() || null;

  /**
   * Sin folio no hubo CFDI: el mes se calculó con el interruptor de timbrado apagado y solo
   * quedó el registro. Se retira sin llamar a nadie.
   */
  if (!folio) {
    await archivar({ ref, datos, id, pedidoPor, estado: "sin_timbrar" });
    logger.info("cancelar_mensual_sin_timbrar", { id });
    return { tipo, folio: null, uuid: null, estado: "sin_timbrar", liberado: true };
  }

  /**
   * 🚨 El plazo, antes de llamar a Facturapi. Los comprobantes mensuales los emite VIBRA, que es
   * persona moral, así que el límite es el 31 de marzo del año siguiente.
   */
  const fechaEmision = (datos.createdAt as admin.firestore.Timestamp)?.toDate?.() ??
    new Date(`${periodo}-15T12:00:00Z`);
  if (!dentroDePlazo(fechaEmision, "moral")) {
    throw new HttpsError("failed-precondition", mensajeFueraDePlazo(fechaEmision, "moral"));
  }

  const res = await facturapiFetch<{ status?: string; cancellation_status?: string }>(
    `/${ENDPOINT[tipo]}/${folio}?motive=${MOTIVO_SIN_SUSTITUCION}`,
    { method: "DELETE", auth: "secret" }
  );
  if (!res.ok) {
    logger.error("cancelar_mensual_falló", { id, folio, err: String(res.error).slice(0, 300) });
    throw new HttpsError(
      "internal",
      `No se pudo cancelar en Facturapi: ${String(res.error).slice(0, 300)}`
    );
  }

  /**
   * 🚨 Aquí se decide si el mes queda libre.
   *
   * Facturapi devuelve el estado del comprobante tras la petición. `canceled` es en firme;
   * cualquier otra cosa —típicamente esperando la aceptación del creador— deja el CFDI vivo.
   * Ante la duda, NO se libera: reexpedir con el anterior vigente es el error caro.
   */
  const estadoFacturapi = String(res.data?.status ?? res.data?.cancellation_status ?? "").trim();
  const enFirme = estadoFacturapi === "canceled";

  if (!enFirme) {
    await ref.set(
      {
        cancelacionPendiente: {
          pedidaPor: pedidoPor,
          pedidaEn: admin.firestore.FieldValue.serverTimestamp(),
          estadoFacturapi: estadoFacturapi || "desconocido",
        },
      },
      { merge: true }
    );
    logger.warn("cancelar_mensual_en_proceso", { id, folio, estadoFacturapi });
    return { tipo, folio, uuid, estado: "en_proceso", liberado: false };
  }

  await archivar({ ref, datos, id, pedidoPor, estado: "cancelado" });
  logger.info("cancelar_mensual_hecho", { id, folio, uuid });
  return { tipo, folio, uuid, estado: "cancelado", liberado: true };
}

/** Guarda el registro anulado y retira el candado del mes. */
async function archivar(params: {
  ref: FirebaseFirestore.DocumentReference;
  datos: FirebaseFirestore.DocumentData;
  id: string;
  pedidoPor: string;
  estado: "cancelado" | "sin_timbrar";
}) {
  const { ref, datos, id, pedidoPor, estado } = params;
  await db.collection("creatorMonthlyDocsAnulados").add({
    ...datos,
    idOriginal: id,
    estadoCancelacion: estado,
    /** A diferencia del script manual que esto sustituye, aquí el CFDI SÍ quedó cancelado. */
    cfdiCanceladoEnFacturapi: estado === "cancelado",
    pedidoPor,
    anuladoEn: admin.firestore.FieldValue.serverTimestamp(),
  });
  await ref.delete();
}

/**
 * El botón de administración.
 *
 * ⚠️ Es manual a propósito, igual que la cancelación de la global: cancelar un CFDI es un acto
 * fiscal irreversible sobre un documento que ya existe.
 */
export const cancelarComprobanteMensualCallable = onCall(
  { region: REGION, cors: true, secrets: [facturapiTestKey, facturapiUserKey] },
  async (request) => {
    const uid = requirePlatformMod(request);

    const data = (request.data ?? {}) as Record<string, unknown>;
    const creatorId = String(data.creatorId ?? "").trim();
    const periodo = String(data.periodo ?? "").trim();
    const tipo = String(data.tipo ?? "").trim();

    if (!creatorId || !/^\d{4}-\d{2}$/.test(periodo)) {
      throw new HttpsError("invalid-argument", "Faltan el creador o el mes en formato YYYY-MM.");
    }
    if (tipo !== "comision" && tipo !== "retenciones") {
      throw new HttpsError("invalid-argument", "El tipo debe ser «comision» o «retenciones».");
    }

    /**
     * 🚨 La red contra el error mudo. Una excepción que no sea `HttpsError` llega al cliente como
     * `internal` sin mensaje, y diagnosticar eso desde fuera es casi imposible. Ver la misma nota
     * en `cancelacionGlobal.ts`.
     */
    try {
      return await cancelarComprobanteMensual({ creatorId, periodo, tipo, pedidoPor: uid });
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      const mensaje = err instanceof Error ? err.message : String(err);
      logger.error("cancelar_mensual_excepcion", {
        creatorId,
        periodo,
        tipo,
        err: mensaje,
        stack: err instanceof Error ? err.stack?.slice(0, 1500) : null,
      });
      throw new HttpsError("internal", `Falló al cancelar: ${mensaje.slice(0, 300)}`);
    }
  }
);
