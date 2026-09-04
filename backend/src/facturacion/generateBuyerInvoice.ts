// Facturas de venta al COMPRADOR — modelo de INTERMEDIACIÓN.
//
// ⚠️ CAMBIO DE MODELO (2026-08-26). Antes Vibra era la vendedora y emitía UNA factura con su
// propio sello. Ahora **el vendedor es el creador**, así que:
//
//   · Una selección de compras produce **una factura POR CREADOR**, no una sola.
//     10 conceptos de 3 creadores = 3 facturas.
//   · Cada una se timbra en la ORGANIZACIÓN de ese creador, con SU sello digital.
//     El emisor es él; Vibra solo la emite por su cuenta, al amparo del mandato de cobro.
//   · Un creador sin sello vigente **no bloquea a los demás**: su grupo se reporta como
//     no facturable y el resto se timbra igual.
//
// El cliente (comprador) vive por organización en Facturapi, así que hay que darlo de alta en
// la de cada creador. Se guarda el id por creador para no repetir el alta en cada factura.
//
// 💱 Moneda: el CFDI va en MXN con los PESOS realmente cobrados, tomados del
// `paymentIntents/{id}`. Si no hubiera intent (flujos legados), se convierte (base+IVA)
// USD→MXN con la tasa vigente.

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
import { FORMA_PAGO } from "./formaDePago";
import { leerImporteFiscal } from "./importeFiscal";
import {
  emitirNominativa,
  facturapiErrorMessage,
  liberarReservaNominativa,
  reservarParaNominativa,
  type CompraNormalizada,
  type FacturaEmitida,
} from "./emitirNominativa";
import { encolarFactura } from "./colaDeFacturas";
import { consumeQuota } from "../quotas";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();
const REGION = "us-central1";

/** Un CFDI con más conceptos que esto no es una factura, es un error. */
const MAX_COMPRAS_POR_FACTURA = 50;

/** Tope de creadores distintos en una sola petición: cada uno cuesta una factura. */
const MAX_CREADORES_POR_PETICION = 10;

/** Motivo por el que el grupo de un creador no se pudo facturar. */
type MotivoNoFacturable =
  | "sin_sello"
  | "sin_datos_fiscales"
  | "error_timbrado"
  /** La factura global se le adelantó mientras se preparaba esta. Ver §A3 y §B7. */
  | "ya_en_global";

export const generateBuyerInvoice = onCall(
  { region: REGION, cors: true, secrets: [facturapiTestKey, facturapiUserKey] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");

    const data = (request.data ?? {}) as Record<string, unknown>;
    // ⚠️ Sin duplicados y con tope. El mismo id repetido creaba varios conceptos por una sola
    // compra —una factura por más de lo cobrado— y solo se marcaba una vez como facturada.
    const purchaseIds = Array.from(
      new Set(
        (Array.isArray(data.purchaseIds) ? data.purchaseIds : []).map((x) => String(x).trim())
      )
    ).filter(Boolean);

    if (purchaseIds.length > MAX_COMPRAS_POR_FACTURA) {
      throw new HttpsError(
        "invalid-argument",
        `Puedes facturar hasta ${MAX_COMPRAS_POR_FACTURA} movimientos a la vez.`
      );
    }
    const billingProfileId = String(data.billingProfileId ?? "").trim();
    if (purchaseIds.length === 0) throw new HttpsError("invalid-argument", "Selecciona al menos un movimiento.");
    if (!billingProfileId) throw new HttpsError("invalid-argument", "Falta el perfil de facturación.");

    // 1) Perfil de facturación del comprador (datos fiscales + uso de CFDI).
    const profSnap = await db.doc(`users/${uid}/billingProfiles/${billingProfileId}`).get();
    if (!profSnap.exists) throw new HttpsError("not-found", "Perfil de facturación no encontrado.");
    const prof = profSnap.data() ?? {};
    const usoCfdi = String(prof.usoCfdi ?? "G03").trim();

    // 3) Leer y validar las compras, y AGRUPARLAS POR CREADOR.
    const porCreador = new Map<string, CompraNormalizada[]>();

    /**
     * 🧾 Cómo se pagó, para el CFDI.
     *
     * Se toma de la PRIMERA compra que la traiga. El CFDI solo admite una forma de pago, y
     * facturar juntas dos compras pagadas de formas distintas es un caso raro que no
     * merece partir la factura en dos.
     */
    let formaPago: string | null = null;
    for (const pid of purchaseIds) {
      const pSnap = await db.doc(`users/${uid}/purchases/${pid}`).get();
      if (!pSnap.exists) throw new HttpsError("not-found", `Compra ${pid} no encontrada.`);
      const p = pSnap.data() ?? {};
      if (p.status !== "paid") throw new HttpsError("failed-precondition", "Solo puedes facturar compras pagadas.");
      if (p.invoiced === true) throw new HttpsError("failed-precondition", "Una de las compras ya fue facturada.");

      /**
       * 🚨 EL CANDADO CONTRA EL DOBLE TIMBRADO (`pendientesimpuestos.md` §A3).
       *
       * Si la compra ya entró en la factura global del creador, no se puede emitir su
       * nominativa sin más. El SAT pide tres pasos —cancelar la global con motivo **04**,
       * reexpedirla sin esta operación, y entonces sí emitir la nominativa— y el segundo
       * necesita el sello del creador.
       *
       * Antes esto no se comprobaba, sencillamente porque la global no marcaba nada. El
       * resultado habría sido la misma venta timbrada dos veces, con el sello del creador en
       * ambas: el comprador se quedaba tan contento y el creador con un problema.
       */
      if (p.globalInvoice) {
        const estado = (p.globalInvoice as { estado?: string }).estado;
        throw new HttpsError(
          "failed-precondition",
          estado === "emitiendo"
            ? "Estamos documentando una de estas compras en este momento, vuelve a intentarlo en unos minutos."
            : "Una de estas compras ya quedó incluida en la factura global del creador. Todavía puedes tener tu factura, pero hay que emitirla a mano, escríbenos y la preparamos."
        );
      }
      /**
       * Otra petición de factura va por delante con esta compra. Los dos casos se cuentan
       * distinto porque el comprador puede hacer cosas muy distintas con cada respuesta.
       *
       * `emitiendo` dura segundos y se arregla esperando. `en_cola` puede durar semanas y no
       * depende de él: es el creador quien tiene que subir su sello. Decirle «dale un momento»
       * en ese caso lo dejaría recargando la pantalla para siempre.
       */
      if (p.nominativaEnCurso) {
        const estado = (p.nominativaEnCurso as { estado?: string }).estado;
        /**
         * 🔓 `liberada` NO bloquea. Es una compra que se sacó de una factura global cancelando
         *    con motivo 04 (§B7) **para que este comprador la facture**. Rechazarla aquí haría
         *    inútil todo ese trámite.
         */
        if (estado !== "liberada") {
          throw new HttpsError(
            "failed-precondition",
            estado === "en_cola"
              ? "Tu factura de esta compra ya está guardada, esperando a que el creador suba su sello digital. Se emite sola en cuanto lo haga."
              : "Ya hay una factura de esta compra en camino, dale un momento."
          );
        }
      }

      const creatorId = String(p.creatorId ?? "").trim();
      if (!creatorId) {
        throw new HttpsError("failed-precondition", "Una de las compras no tiene creador asociado.");
      }

      // La forma de pago vive en el intent, que comparte el id determinista de la compra.
      const intentSnap = await db.doc(`paymentIntents/${pid}`).get();
      const intent = intentSnap.exists ? intentSnap.data() ?? {} : null;

      // La forma de pago de ESTA compra. Si son varias en una factura, la de la primera
      // manda: el CFDI solo admite una, y agrupar compras pagadas de formas distintas es
      // un caso raro que no merece partir la factura.
      if (!formaPago) {
        const guardada = typeof intent?.satFormaPago === "string" ? intent.satFormaPago : null;
        formaPago = guardada || FORMA_PAGO.POR_DEFINIR;
      }
      /**
       * 💱 Los PESOS de esta compra, TAL CUAL se congelaron el día de la venta.
       *
       * Con el tipo de cambio que de verdad se le aplicó a este comprador, así que reexpedir la
       * factura dentro de dos años da el mismo número.
       *
       * 🚨 SIN CONGELADO NO SE FACTURA, y no se aproxima (AUD-3).
       *
       *    Aquí había un respaldo que convertía con la tasa de HOY. Tenía sentido como puente
       *    para las ventas anteriores al congelado, pero el backfill ya no dejó ninguna y las
       *    nuevas congelan solas. Hoy ese camino solo puede dispararse cuando el congelado
       *    falló — y entonces metería un importe aproximado en un CFDI de verdad, que es
       *    exactamente lo que §A0 vino a prohibir.
       *
       *    Negarse es más ruidoso y más correcto: una factura que no sale se arregla; una
       *    factura timbrada por el importe equivocado, no.
       */
      const congelado = leerImporteFiscal(p.fiscalMxn);
      if (!congelado) {
        logger.error("generateBuyerInvoice sin_importe_congelado", { uid, purchaseId: pid, creatorId });
        throw new HttpsError(
          "failed-precondition",
          "No podemos facturar esta compra ahora mismo, escríbenos y lo resolvemos."
        );
      }

      const lista = porCreador.get(creatorId) ?? [];
      lista.push({
        id: pid,
        creatorId,
        baseMxn: congelado.base,
        ivaMxn: congelado.iva,
        type: String(p.type ?? ""),
      });
      porCreador.set(creatorId, lista);
    }

    if (porCreador.size > MAX_CREADORES_POR_PETICION) {
      throw new HttpsError(
        "invalid-argument",
        `Estás facturando a ${porCreador.size} creadores a la vez. El máximo es ${MAX_CREADORES_POR_PETICION}.`
      );
    }

    // Facturapi cobra por factura emitida, y ahora se emite una por creador.
    for (let i = 0; i < porCreador.size; i++) {
      await consumeQuota(uid, "invoice");
    }

    // 4) Una factura por creador.
    const emitidas: FacturaEmitida[] = [];
    const noFacturables: Array<{ creatorId: string; motivo: MotivoNoFacturable; detalle?: string }> = [];

    for (const [creatorId, compras] of porCreador) {
      // 4a) El creador debe tener organización y sello VIGENTE: sin eso no hay emisor.
      const fiscalSnap = await db.doc(`creatorTaxProfiles/${creatorId}`).get();
      const fiscal = fiscalSnap.exists ? fiscalSnap.data() ?? {} : {};
      const orgId = String(fiscal.facturapiOrgId ?? "").trim();
      const csdStatus = String(fiscal.csdStatus ?? "none");
      /**
       * 🕓 Sin emisor posible → A LA COLA, no a la basura (`pendientesimpuestos.md` §B5).
       *
       * Antes esto solo se reportaba y la petición se perdía. Peor: la venta seguía contando
       * como no facturada, así que entraba en la factura global, y cuando el creador subía su
       * sello ya no se le podía emitir sin cancelar la global con motivo 04.
       *
       * Encolar APARTA las compras, y con eso la global deja de verlas.
       */
      if (!orgId || csdStatus !== "valid") {
        const motivo = !orgId ? "sin_datos_fiscales" : "sin_sello";
        const encolada = await encolarFactura({
          buyerId: uid,
          creatorId,
          billingProfileId,
          purchaseIds: compras.map((c) => c.id),
          motivo,
        });
        // Si no se pudo apartar ninguna, es que se las llevó la global mientras tanto.
        noFacturables.push({ creatorId, motivo: encolada ? motivo : "ya_en_global" });
        continue;
      }

      /**
       * 🚨 APARTAR ANTES DE TIMBRAR (`pendientesimpuestos.md` §A3).
       *
       * Las comprobaciones de arriba se hicieron hace varias llamadas de red. En ese hueco el
       * proceso mensual pudo meter estas compras en la factura global — y como los dos caminos
       * timbraban primero y marcaban después, la venta acababa en los dos comprobantes.
       *
       * Se reserva en transacción, releyendo. Si el hueco se cerró, se abandona ESTE creador y
       * los demás siguen, en vez de tumbar la petición entera de un comprador que quizá está
       * facturando compras de cinco creadores distintos.
       */
      const paths = compras.map((c) => `users/${uid}/purchases/${c.id}`);
      const reservadas = await reservarParaNominativa(paths, "emitiendo");
      if (reservadas.length !== paths.length) {
        // Lo poco que se haya apartado se suelta: nadie va a timbrarlo en esta pasada.
        await liberarReservaNominativa(reservadas);
        noFacturables.push({ creatorId, motivo: "ya_en_global" });
        continue;
      }

      try {
        const inv = await emitirNominativa({
          buyerId: uid,
          creatorId,
          orgId,
          compras,
          billingProfileId,
          perfil: prof,
          usoCfdi,
          formaPago: formaPago ?? FORMA_PAGO.POR_DEFINIR,
        });
        emitidas.push(inv);
      } catch (err) {
        // Un creador que falla no tumba a los demás: se reporta y se sigue.
        const detalle = err instanceof Error ? err.message : String(err);
        logger.error("generateBuyerInvoice creator_failed", { creatorId, detalle: detalle.slice(0, 300) });
        /**
         * 🚨 Soltar la reserva. Si no, un timbrado fallido dejaría la compra apartada para
         *    siempre — ni el comprador podría reintentar, ni la global la recogería. Es el
         *    fallo silencioso más caro de este flujo, porque nadie lo nota hasta que alguien
         *    reclama su factura meses después.
         */
        await liberarReservaNominativa(paths).catch((e) =>
          logger.error("generateBuyerInvoice reserva_no_liberada", {
            creatorId,
            detalle: e instanceof Error ? e.message : String(e),
          })
        );
        noFacturables.push({ creatorId, motivo: "error_timbrado", detalle: detalle.slice(0, 200) });
      }
    }

    if (emitidas.length === 0) {
      throw new HttpsError(
        "failed-precondition",
        "No se pudo emitir ninguna factura. Los creadores de estas compras aún no tienen su sello digital al día."
      );
    }

    return { ok: true, invoices: emitidas, skipped: noFacturables };
  }
);

// Descarga el PDF de una factura del comprador (base64) para bajarla desde el panel.
export const downloadBuyerInvoice = onCall(
  { region: REGION, cors: true, secrets: [facturapiTestKey, facturapiUserKey] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
    const invoiceId = String((request.data as { invoiceId?: unknown })?.invoiceId ?? "").trim();
    if (!invoiceId) throw new HttpsError("invalid-argument", "Falta la factura a descargar.");

    // El dueño solo baja SUS facturas.
    const snap = await db.doc(`users/${uid}/invoices/${invoiceId}`).get();
    if (!snap.exists) throw new HttpsError("not-found", "Factura no encontrada.");
    const doc = snap.data() ?? {};
    const facturapiId = String(doc.facturapiInvoiceId ?? invoiceId);
    const uuid = String(doc.uuid ?? invoiceId);

    // La factura vive en la organización del CREADOR que la emitió. Las anteriores al cambio
    // de modelo se timbraron en la de Vibra y no traen `facturapiOrgId`: para ésas se usa la
    // llave de Vibra, o dejarían de poder descargarse.
    const orgId = String(doc.facturapiOrgId ?? "").trim();
    let auth: FacturapiAuth = "secret";
    if (orgId) {
      try {
        auth = { orgKey: await getOrganizationTestKey(orgId) };
      } catch (err) {
        logger.error("downloadBuyerInvoice org_key_failed", {
          orgId,
          err: err instanceof Error ? err.message : String(err),
        });
        throw new HttpsError("failed-precondition", "No se pudo acceder a la factura del creador.");
      }
    }

    const res = await facturapiDownload(`/invoices/${facturapiId}/pdf`, { auth });
    if (!res.ok) throw new HttpsError("failed-precondition", `No se pudo descargar la factura: ${facturapiErrorMessage(res.error)}`);

    return { ok: true, pdfBase64: res.data, filename: `factura-${uuid}.pdf` };
  }
);
