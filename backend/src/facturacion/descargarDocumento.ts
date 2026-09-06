// Descargar el PDF o el XML de un CFDI.
//
// 🚨 NO HAY QUE DISEÑAR ESTOS PDF. Facturapi los genera —`GET /invoices/{id}/pdf` y su gemelo de
//    retenciones— con el formato oficial del SAT. Lo que faltaba no era el documento, era la
//    puerta para que su dueño lo bajara. Diseñar un PDF propio para un CFDI sería rehacer peor
//    algo que ya viene hecho, y encima tendría que cuadrar con el XML timbrado.
//
//    Los que sí hay que generar son los que NO son CFDI: el comprobante de retiro y el de
//    liquidación mensual. Esos no existen en ningún sitio más que en nuestra base de datos.
//
// ⚠️ QUIÉN PUEDE BAJAR QUÉ
//
// La autorización no se pregunta a Facturapi, se resuelve contra NUESTROS registros, que son los
// que saben de quién es cada documento:
//
//   · Factura o nota de crédito → la baja el COMPRADOR a quien se le emitió.
//   · Comisión o constancia → las baja el CREADOR sobre el que se emitieron.
//   · Un supermoderador puede bajar cualquiera, para soporte.
//
// Nunca se acepta un id de Facturapi a secas: sin el registro que lo ata a alguien, cualquiera
// con un id ajeno se llevaría la factura de otro.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import {
  facturapiDownload,
  facturapiTestKey,
  facturapiUserKey,
  type FacturapiAuth,
} from "./facturapiClient";
import { getOrganizationTestKey } from "./facturapiOrganizations";
import { esPlatformMod } from "../authz";

const REGION = "us-central1";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

/** Qué documento se pide. Cada uno vive en un sitio y lo firma una organización distinta. */
export type TipoDocumento =
  | "factura"
  | "notaCredito"
  /** Los tres del creador. La `global` es SU factura, la que emite a público en general. */
  | "global"
  | "comision"
  | "retenciones";

export type Formato = "pdf" | "xml";

/**
 * Resuelve el documento y comprueba que quien lo pide tenga derecho a él.
 *
 * Devuelve la ruta de Facturapi y con qué llave firmarla. Separado del callable para poder
 * razonarlo de un vistazo: es la parte que, si se equivoca, entrega la factura de un tercero.
 */
async function resolver(params: {
  uid: string;
  esModerador: boolean;
  tipo: TipoDocumento;
  /** Id del registro NUESTRO, no de Facturapi. */
  referencia: string;
  /** Para las facturas y notas, el comprador dueño del registro. */
  buyerId?: string;
}): Promise<{ path: string; auth: FacturapiAuth }> {
  const { uid, esModerador, tipo, referencia } = params;

  if (tipo === "factura" || tipo === "notaCredito") {
    const buyerId = String(params.buyerId ?? "").trim();
    if (!buyerId) throw new HttpsError("invalid-argument", "Falta el comprador.");
    if (buyerId !== uid && !esModerador) {
      throw new HttpsError("permission-denied", "Solo puedes bajar tus propios comprobantes.");
    }

    const snap = await db.doc(`users/${buyerId}/invoices/${referencia}`).get();
    if (!snap.exists) throw new HttpsError("not-found", "Ese comprobante no existe.");

    /**
     * 🚨 La emitió el CREADOR con su propia organización, así que hay que firmar con su llave.
     *    Con la de Vibra, Facturapi contestaría que el documento no existe — y sería cierto, no
     *    existe en la organización de Vibra.
     *
     * ⚠️ SALVO que no traiga `facturapiOrgId`. Las facturas anteriores al cambio al modelo de
     *
     *    intermediación se timbraron en la organización de Vibra. Exigirlo las dejaría sin
     *    poder descargarse para siempre, y son facturas válidas. Portado de
     *    `downloadBuyerInvoice`, que ya lo hacía bien.
     */
    const orgId = String(snap.get("facturapiOrgId") ?? "").trim();
    const auth: FacturapiAuth = orgId
      ? { orgKey: await getOrganizationTestKey(orgId) }
      : "secret";

    return {
      path: `/invoices/${String(snap.get("facturapiInvoiceId") ?? referencia)}`,
      auth,
    };
  }

  // Comisión y constancia: las emite VIBRA sobre un creador, y viven en el registro mensual.
  const snap = await db.doc(`creatorMonthlyDocs/${referencia}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "Ese comprobante no existe.");

  const creatorId = String(snap.get("creatorId") ?? "").trim();
  if (creatorId !== uid && !esModerador) {
    throw new HttpsError("permission-denied", "Solo puedes bajar tus propios comprobantes.");
  }

  const folio = String(snap.get("facturapiId") ?? "").trim();
  if (!folio) {
    throw new HttpsError(
      "failed-precondition",
      "Ese mes se calculó pero no se timbró, así que no hay documento que bajar."
    );
  }

  // La constancia es una RETENCIÓN y vive en otro endpoint. Pedirla en `/invoices` da 404.
  const base = tipo === "retenciones" ? "retentions" : "invoices";

  /**
   * 🚨 LA GLOBAL LA FIRMA EL CREADOR, los otros dos VIBRA.
   *
   * La factura global es del creador: la emite él a «público en general», con su propio sello y
   * en SU organización de Facturapi. La comisión y la constancia las emite Vibra. Pedir la
   * global con la llave de Vibra devuelve «no existe», y sería cierto: no existe ahí.
   */
  if (tipo === "global") {
    const fiscal = await db.doc(`creatorTaxProfiles/${creatorId}`).get();
    const orgId = String(fiscal.get("facturapiOrgId") ?? "").trim();
    if (!orgId) {
      throw new HttpsError("failed-precondition", "El creador no tiene organización de facturación.");
    }
    return { path: `/${base}/${folio}`, auth: { orgKey: await getOrganizationTestKey(orgId) } };
  }

  return { path: `/${base}/${folio}`, auth: "secret" };
}

/**
 * Devuelve el documento en base64.
 *
 * ⚠️ Base64 por un callable es razonable para un CFDI —decenas de kilobytes— y evita montar
 * URLs firmadas para algo que se baja una vez. Si algún día hiciera falta un ZIP con el año
 * entero, ese sí tendría que pasar por Storage.
 */
export const descargarDocumentoFiscal = onCall(
  { region: REGION, cors: true, secrets: [facturapiTestKey, facturapiUserKey] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");

    const data = (request.data ?? {}) as Record<string, unknown>;
    const tipo = String(data.tipo ?? "") as TipoDocumento;
    const referencia = String(data.referencia ?? "").trim();
    const formato = (String(data.formato ?? "pdf") === "xml" ? "xml" : "pdf") as Formato;
    const buyerId = String(data.buyerId ?? "").trim() || undefined;

    if (!["factura", "notaCredito", "global", "comision", "retenciones"].includes(tipo)) {
      throw new HttpsError("invalid-argument", "Tipo de documento desconocido.");
    }
    if (!referencia) throw new HttpsError("invalid-argument", "Falta la referencia del documento.");

    try {
      const { path, auth } = await resolver({
        uid,
        esModerador: esPlatformMod(request),
        tipo,
        referencia,
        buyerId,
      });

      const res = await facturapiDownload(`${path}/${formato}`, { auth });
      if (!res.ok) {
        throw new HttpsError(
          "internal",
          `No se pudo bajar el documento: ${String(res.error).slice(0, 300)}`
        );
      }

      logger.info("documento_descargado", { uid, tipo, referencia, formato });
      return {
        formato,
        /** `application/pdf` o `application/xml`, para que el navegador sepa qué hacer con él. */
        mime: formato === "pdf" ? "application/pdf" : "application/xml",
        base64: res.data,
      };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      const mensaje = err instanceof Error ? err.message : String(err);
      logger.error("documento_descarga_excepcion", { uid, tipo, referencia, err: mensaje });
      throw new HttpsError("internal", `Falló la descarga: ${mensaje.slice(0, 300)}`);
    }
  }
);
