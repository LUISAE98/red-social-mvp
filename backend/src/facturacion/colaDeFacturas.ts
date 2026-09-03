// Cola de facturas pendientes del sello del creador (`pendientesimpuestos.md` §B5).
//
// EL PROBLEMA
//
// Bajo intermediación el emisor de la factura de venta es el CREADOR, con su sello digital. Si
// no lo ha subido, no hay quién emita — y hasta ahora la petición del comprador simplemente se
// perdía. Volvía días después, se encontraba lo mismo, y así.
//
// 🚨 Y HAY ALGO PEOR QUE PERDER LA PETICIÓN
//
// Sin cola, esa venta sigue contando como «nadie la facturó», así que **entra en la factura
// global** del periodo. Cuando el creador por fin sube su sello y el comprador reclama, ya no se
// le puede emitir sin más: hay que cancelar la global con motivo 04, reexpedirla sin esa
// operación y entonces emitir la nominativa. Tres pasos y un trámite, por no haber guardado una
// petición.
//
// CÓMO FUNCIONA
//
//   1. El comprador pide su factura y el creador no tiene sello.
//   2. Las compras se APARTAN con `nominativaEnCurso.estado = "en_cola"`. Desde ese momento la
//      factura global las excluye, que es la mitad importante de este bloque.
//   3. La petición se guarda en `pendingInvoices` — solo REFERENCIAS: el id del perfil de
//      facturación y los ids de las compras. Nunca una copia de sus datos fiscales, que pueden
//      cambiar entre que la pide y que se emite, y la buena es siempre la de ese momento.
//   4. Cuando `csdStatus` del creador pasa a `valid`, un disparador emite todo lo suyo.
//
// ⚠️ Una reserva `en_cola` **no se suelta** si el creador nunca sube el sello. Es deliberado:
// soltarla devolvería la venta a la factura global y volveríamos al problema del motivo 04. La
// presión para que suba el sello es otra —tiene la wallet bloqueada—, no la de perder la venta.

import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { facturapiTestKey, facturapiUserKey } from "./facturapiClient";
import {
  emitirNominativa,
  liberarReservaNominativa,
  reservarParaNominativa,
  type CompraNormalizada,
} from "./emitirNominativa";
import { leerImporteFiscal } from "./importeFiscal";
import { FORMA_PAGO } from "./formaDePago";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();
const REGION = "us-central1";

/** Una petición de factura esperando al sello de su creador. */
export type FacturaEnCola = {
  buyerId: string;
  creatorId: string;
  /** Referencia, NO copia. Los datos fiscales buenos son los del momento de emitir. */
  billingProfileId: string;
  purchaseIds: string[];
  estado: "pendiente" | "emitida" | "fallida";
  motivo: "sin_sello" | "sin_datos_fiscales";
  intentos: number;
  ultimoError?: string | null;
  invoiceId?: string | null;
  uuid?: string | null;
};

/**
 * Guarda una petición que no se pudo emitir, con sus compras ya apartadas.
 *
 * Devuelve `false` si no se pudo apartar ninguna compra —se las llevó la global o ya estaban
 * facturadas— porque entonces no hay nada que encolar.
 */
export async function encolarFactura(params: {
  buyerId: string;
  creatorId: string;
  billingProfileId: string;
  purchaseIds: string[];
  motivo: "sin_sello" | "sin_datos_fiscales";
}): Promise<boolean> {
  const paths = params.purchaseIds.map((id) => `users/${params.buyerId}/purchases/${id}`);
  const reservadas = await reservarParaNominativa(paths, "en_cola");
  if (reservadas.length === 0) return false;

  // Solo las que se apartaron de verdad. Encolar una que se llevó la global sería prometer una
  // factura que luego habría que arrancarle a un CFDI ya timbrado.
  const ids = reservadas.map((p) => p.split("/").pop() as string);

  await db.collection("pendingInvoices").add({
    buyerId: params.buyerId,
    creatorId: params.creatorId,
    billingProfileId: params.billingProfileId,
    purchaseIds: ids,
    estado: "pendiente",
    motivo: params.motivo,
    intentos: 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  logger.info("factura_encolada", {
    buyerId: params.buyerId,
    creatorId: params.creatorId,
    compras: ids.length,
    motivo: params.motivo,
  });
  return true;
}

/**
 * Rehace una compra desde su documento, con los pesos congelados que ya lleva.
 *
 * 🚨 SIN CONGELADO DEVUELVE `null`, y no aproxima (AUD-3). Aquí había un respaldo que convertía
 * con la tasa de HOY: para una venta de hace semanas eso no es su tipo de cambio, y de ese
 * número saldría el importe de un CFDI. Que no salga la factura se arregla; que salga por el
 * importe equivocado, no.
 */
function compraDesdeDoc(
  id: string,
  x: Record<string, unknown>,
  creatorId: string
): CompraNormalizada | null {
  const congelado = leerImporteFiscal(x.fiscalMxn);
  if (!congelado) return null;
  return {
    id,
    creatorId,
    baseMxn: congelado.base,
    ivaMxn: congelado.iva,
    type: String(x.type ?? ""),
  };
}

/**
 * Emite todo lo que un creador tenía en cola.
 *
 * Cada petición va por su cuenta: una que falle no detiene a las demás, porque son de
 * compradores distintos y no hay motivo para castigarlos a todos.
 */
export async function procesarColaDeCreador(creatorId: string): Promise<{
  emitidas: number;
  fallidas: number;
  saltadas: number;
}> {
  const r = { emitidas: 0, fallidas: 0, saltadas: 0 };

  const fiscalSnap = await db.doc(`creatorTaxProfiles/${creatorId}`).get();
  const fiscal = fiscalSnap.exists ? fiscalSnap.data() ?? {} : {};
  const orgId = String(fiscal.facturapiOrgId ?? "").trim();
  if (!orgId || fiscal.csdStatus !== "valid") return r;

  const pendientes = await db
    .collection("pendingInvoices")
    .where("creatorId", "==", creatorId)
    .where("estado", "==", "pendiente")
    .get();
  if (pendientes.empty) return r;


  for (const doc of pendientes.docs) {
    const q = doc.data() as FacturaEnCola;
    try {
      const perfilSnap = await db
        .doc(`users/${q.buyerId}/billingProfiles/${q.billingProfileId}`)
        .get();
      if (!perfilSnap.exists) {
        /**
         * Borró el perfil fiscal con el que la pidió y no se puede adivinar cuál quiere ahora.
         *
         * 🚨 Se SUELTAN las reservas (AUD-5). Sin esto, esas compras quedaban apartadas para
         *    siempre: ni facturadas ni en ninguna global. Aquí soltar es lo correcto — ya no hay
         *    factura nominativa que esperar, así que la venta debe volver a la global, que es
         *    donde le toca estar si nadie la pide.
         */
        await liberarReservaNominativa(
          q.purchaseIds.map((id) => `users/${q.buyerId}/purchases/${id}`)
        );
        await doc.ref.set(
          { estado: "fallida", ultimoError: "perfil de facturación borrado", updatedAt: admin.firestore.FieldValue.serverTimestamp() },
          { merge: true }
        );
        r.fallidas++;
        continue;
      }
      const perfil = perfilSnap.data() ?? {};

      const compras: CompraNormalizada[] = [];
      /**
       * 🚨 Las que NO se pudieron resolver se cuentan aparte (AUD-4).
       *
       * Antes se descartaban en silencio: se emitía la factura con las demás, la petición se
       * marcaba `emitida`, y esas compras se quedaban `en_cola` **para siempre** — ni
       * facturadas ni en ninguna global, sin que nadie se enterara.
       */
      const irresolubles: string[] = [];
      let formaPago: string | null = null;
      for (const pid of q.purchaseIds) {
        const pSnap = await db.doc(`users/${q.buyerId}/purchases/${pid}`).get();
        if (!pSnap.exists) {
          irresolubles.push(pid);
          continue;
        }
        const x = pSnap.data() ?? {};
        // Ya se emitió por otra vía: no es un problema, sale de la petición sin más.
        if (x.invoiced === true) continue;
        const c = compraDesdeDoc(pid, x, creatorId);
        if (c) compras.push(c);
        else irresolubles.push(pid);
        if (!formaPago) {
          const intent = await db.doc(`paymentIntents/${pid}`).get();
          const guardada = intent.exists ? String(intent.get("satFormaPago") ?? "") : "";
          formaPago = guardada || FORMA_PAGO.POR_DEFINIR;
        }
      }

      if (compras.length === 0) {
        // Nada que emitir. Se sueltan las reservas para que la global las recoja (AUD-5).
        await liberarReservaNominativa(
          q.purchaseIds.map((id) => `users/${q.buyerId}/purchases/${id}`)
        );
        await doc.ref.set(
          { estado: "fallida", ultimoError: "sin compras facturables", updatedAt: admin.firestore.FieldValue.serverTimestamp() },
          { merge: true }
        );
        r.saltadas++;
        continue;
      }

      const inv = await emitirNominativa({
        buyerId: q.buyerId,
        creatorId,
        orgId,
        compras,
        billingProfileId: q.billingProfileId,
        perfil,
        usoCfdi: String(perfil.usoCfdi ?? "G03").trim(),
        formaPago: formaPago ?? FORMA_PAGO.POR_DEFINIR,
      });

      /**
       * Si quedaron compras sin resolver, la petición NO se cierra: se queda `pendiente` con
       * las que faltan, para que `reintentarColaDeFacturas` o la barrida diaria las recojan.
       * Cerrarla las perdería, que es justo lo que arregla AUD-4.
       */
      await doc.ref.set(
        {
          estado: irresolubles.length > 0 ? "pendiente" : "emitida",
          purchaseIds: irresolubles.length > 0 ? irresolubles : q.purchaseIds,
          invoiceId: inv.invoiceId,
          uuid: inv.uuid,
          ...(irresolubles.length > 0
            ? { ultimoError: `${irresolubles.length} compra(s) sin importe congelado` }
            : {}),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      if (irresolubles.length > 0) {
        logger.warn("cola_factura_parcial", { creatorId, cola: doc.id, pendientes: irresolubles.length });
      }
      r.emitidas++;
    } catch (err) {
      const detalle = err instanceof Error ? err.message : String(err);
      logger.error("cola_factura_fallo", { creatorId, cola: doc.id, detalle: detalle.slice(0, 300) });
      /**
       * Se queda `pendiente` y suma un intento. **No se suelta la reserva**: la compra sigue
       * apartada, así que no se cuela en la factura global mientras se arregla lo que falló.
       */
      await doc.ref.set(
        {
          intentos: (Number(q.intentos) || 0) + 1,
          ultimoError: detalle.slice(0, 300),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      r.fallidas++;
    }
  }

  logger.info("cola_facturas_procesada", { creatorId, ...r });
  return r;
}

/**
 * Qué creadores tienen algo esperando en la cola.
 *
 * 🚨 UNA consulta para toda la plataforma (AUD-10). La barrida diaria necesita saber a quién
 * mirar, y preguntárselo a cada creador uno por uno era el mismo derroche que la global.
 */
export async function creadoresConColaPendiente(): Promise<Set<string>> {
  const snap = await db
    .collection("pendingInvoices")
    .where("estado", "==", "pendiente")
    .get();
  const out = new Set<string>();
  for (const d of snap.docs) {
    const c = String(d.get("creatorId") ?? "").trim();
    if (c) out.add(c);
  }
  return out;
}

/**
 * 🔔 El disparador: el creador subió su sello.
 *
 * Se escucha el perfil fiscal entero y se filtra por la TRANSICIÓN a `valid`. Reaccionar a
 * cualquier escritura reemitiría en cada cambio de dirección o de correo.
 */
export const onCsdValidoEmitirCola = onDocumentWritten(
  {
    document: "creatorTaxProfiles/{creatorId}",
    region: REGION,
    secrets: [facturapiTestKey, facturapiUserKey],
    /**
     * 🚨 Nueve minutos, no los 60 s de por defecto (AUD-9). Cada petición encolada son varias
     * lecturas más el alta del cliente, el timbrado y el correo en Facturapi. Un creador con
     * unas cuantas reventaba el timeout, y lo que quedara a medias no se reintentaba.
     *
     * NO se pone `retry: true` a propósito: reintentar un disparador que ya timbró en
     * Facturapi podría emitir dos veces. La red de seguridad es la barrida diaria, que recoge
     * lo que quedó `pendiente` sin volver a timbrar nada ya emitido.
     */
    timeoutSeconds: 540,
  },
  async (event) => {
    const antes = event.data?.before?.data();
    const despues = event.data?.after?.data();
    if (!despues) return;
    if (antes?.csdStatus === "valid") return; // ya lo era
    if (despues.csdStatus !== "valid") return;

    await procesarColaDeCreador(event.params.creatorId);
  }
);

/**
 * Reintento manual desde administración, para lo que se quedó `pendiente` tras un fallo.
 *
 * El disparador solo salta en la transición del sello; una petición que falló por un error de
 * Facturapi con el sello ya puesto no tiene quien la despierte.
 */
export const reintentarColaDeFacturas = onCall(
  { region: REGION, cors: true, secrets: [facturapiTestKey, facturapiUserKey] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
    const userSnap = await db.doc(`users/${uid}`).get();
    if (userSnap.get("isPlatformMod") !== true) {
      throw new HttpsError("permission-denied", "Solo administración.");
    }
    const creatorId = String((request.data ?? {}).creatorId ?? "").trim();
    if (!creatorId) throw new HttpsError("invalid-argument", "Falta el creador.");
    return await procesarColaDeCreador(creatorId);
  }
);
