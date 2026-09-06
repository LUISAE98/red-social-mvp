// Nota de crédito — el CFDI de egreso que documenta una devolución.
//
// CUÁNDO ES ESTE DOCUMENTO Y NO UNA CANCELACIÓN
//
// La regla, de `pendientesimpuestos.md`: **cancelar sirve dentro del mes y para operaciones
// completas; fuera de eso, nota de crédito.** En concreto:
//
//   · Devolución **PARCIAL** → siempre nota de crédito. Un CFDI no se cancela a medias.
//   · Devolución total con el **mes ya cerrado** → nota de crédito. Cancelar ya no se puede.
//   · Devolución total dentro del mes → **cancelar**, que es más limpio. No pasa por aquí.
//
// ⚠️ LA EMITE EL CREADOR, NO VIBRA
//
// La venta la facturó el creador con su propio sello, así que el egreso que la corrige tiene que
// salir de la misma organización. Vibra solo timbra por su cuenta. Es el mismo esquema que la
// factura nominativa.
//
// ⚠️ SOLO CONTRA UNA FACTURA NOMINATIVA
//
// Una nota de crédito **relaciona un UUID**, y para eso hace falta que la compra tenga su propia
// factura. Una venta que solo está dentro de una factura global no se corrige así: se cancela la
// global y se reexpide sin ella. Son caminos distintos y mezclarlos deja CFDI que no cuadran.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import {
  facturapiFetch,
  facturapiTestKey,
  facturapiUserKey,
  type FacturapiAuth,
} from "./facturapiClient";
import { getOrganizationTestKey } from "./facturapiOrganizations";
import { requirePlatformMod } from "../authz";
import { leerImporteFiscal } from "./importeFiscal";

const REGION = "us-central1";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

/**
 * `c_TipoRelacion` `01` — «Nota de crédito de los documentos relacionados».
 *
 * Es la única clave que describe lo que hacemos. Las otras del catálogo son sustituciones,
 * traslados, anticipos y devoluciones de mercancía, ninguna aplicable a un servicio digital.
 */
const RELACION_NOTA_CREDITO = "01";

const IVA_RATE = 0.16;

/**
 * Cuánto queda por acreditar de una compra.
 *
 * 🚨 SE LLEVA ACUMULADO, no por nota. Tres devoluciones parciales del 40% tienen que fallar en
 *    la tercera, no acreditar el 120% de una venta. Validando cada nota contra el total original
 *    el creador acabaría con más egresos que ingresos, y eso el SAT lo cruza.
 *
 * Se separa del emisor para poder probarlo sin tocar Firestore ni Facturapi: es la regla que de
 * verdad protege el dinero, y una regla que no se puede probar no protege nada.
 */
export function restantePorAcreditar(baseFacturada: number, yaAcreditado: number): number {
  return round2(Math.max(0, round2(baseFacturada) - round2(yaAcreditado)));
}

/** Tolerancia de medio centavo, para que el redondeo no bloquee la última devolución. */
export function cabeLaNota(pedido: number, restante: number): boolean {
  return pedido > 0 && pedido <= restante + 0.005;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export type ResultadoNotaCredito = {
  facturapiId: string;
  uuid: string | null;
  /** Importe acreditado en esta nota, sin impuesto. */
  base: number;
  /** Lo acreditado en total sobre esa compra, contando las notas anteriores. */
  acumulado: number;
  /** Lo que todavía queda por acreditar. */
  restante: number;
};

type FacturapiInvoice = { id: string; uuid?: string };

/**
 * Emite la nota de crédito de una compra ya facturada.
 *
 * @param base Importe SIN impuesto que se devuelve. El IVA se calcula encima, igual que en la
 *             venta: si se pasara el total con impuesto, la nota acreditaría de más.
 *
 * 🚨 EL TOPE ES ACUMULADO, no por nota. Tres devoluciones parciales del 40% tienen que fallar en
 *    la tercera, no acreditar el 120% de una venta. Sin llevar la cuenta, cada nota se validaría
 *    contra el total original y el creador acabaría con más egresos que ingresos.
 */
export async function emitirNotaDeCredito(params: {
  buyerId: string;
  purchaseId: string;
  base: number;
  /** Cómo se le devolvió el dinero. Va tal cual al CFDI. */
  formaPago?: string;
  pedidoPor: string;
}): Promise<ResultadoNotaCredito> {
  const { buyerId, purchaseId, pedidoPor } = params;
  const base = round2(params.base);

  logger.info("nota_credito_inicio", { buyerId, purchaseId, base, pedidoPor });

  if (!(base > 0)) {
    throw new HttpsError("invalid-argument", "El importe a devolver tiene que ser mayor que cero.");
  }

  const compraRef = db.doc(`users/${buyerId}/purchases/${purchaseId}`);
  const compraSnap = await compraRef.get();
  if (!compraSnap.exists) throw new HttpsError("not-found", "Compra no encontrada.");
  const compra = compraSnap.data() ?? {};

  const uuidOriginal = String(compra.invoiceUuid ?? "").trim();
  if (compra.invoiced !== true || !uuidOriginal) {
    throw new HttpsError(
      "failed-precondition",
      "Esta compra no tiene factura propia. Si está dentro de una global, hay que cancelar la global y reexpedirla, no emitir una nota de crédito."
    );
  }

  const pesos = leerImporteFiscal(compra.fiscalMxn);
  if (!pesos) {
    throw new HttpsError(
      "failed-precondition",
      "Esta compra no tiene sus pesos congelados, así que no se puede saber cuánto se facturó."
    );
  }

  /**
   * 🚨 El tope es lo que se FACTURÓ, no lo que se cobró.
   *
   * Son el mismo número hoy, pero si algún día divergen, acreditar por encima de lo facturado
   * dejaría un egreso sin ingreso que lo respalde.
   */
  const yaAcreditado = round2(Number(compra.notasCredito?.acumulado ?? 0));
  const restanteAntes = restantePorAcreditar(pesos.base, yaAcreditado);
  if (!cabeLaNota(base, restanteAntes)) {
    throw new HttpsError(
      "failed-precondition",
      `No se puede acreditar ${base.toFixed(2)}: de esta compra solo quedan ${restanteAntes.toFixed(2)} por devolver.`
    );
  }

  const creatorId = String(compra.creatorId ?? "").trim();
  if (!creatorId) throw new HttpsError("failed-precondition", "La compra no dice de quién es.");

  const fiscalSnap = await db.doc(`creatorTaxProfiles/${creatorId}`).get();
  const fiscal = fiscalSnap.exists ? (fiscalSnap.data() ?? {}) : {};
  const orgId = String(fiscal.facturapiOrgId ?? "").trim();
  if (!orgId || fiscal.csdStatus !== "valid") {
    throw new HttpsError(
      "failed-precondition",
      "El creador no tiene su sello digital vigente, así que no puede emitir la nota de crédito."
    );
  }

  const customerId = String(compra.invoiceCustomerId ?? "").trim();
  const auth: FacturapiAuth = { orgKey: await getOrganizationTestKey(orgId) };

  /**
   * La tasa se decide por si la venta llevó impuesto, no por costumbre. Una venta de
   * exportación fue al 0%, y su nota de crédito tiene que ir al 0% también: devolver con 16%
   * lo que se cobró sin él acreditaría un impuesto que nunca se trasladó.
   */
  const llevaIva = pesos.iva > 0;

  const res = await facturapiFetch<FacturapiInvoice>("/invoices", {
    method: "POST",
    body: {
      ...(customerId ? { customer: customerId } : {}),
      /** `E` de egreso. Es lo que convierte esto en una nota de crédito y no en otra venta. */
      type: "E",
      /**
       * 🚨 SIN ESTO ES UN EGRESO HUÉRFANO. El SAT necesita saber qué documento corrige; una
       *    nota de crédito sin relación no acredita nada y deja las dos operaciones sueltas.
       */
      related_documents: [
        { relationship: RELACION_NOTA_CREDITO, documents: [uuidOriginal] },
      ],
      items: [
        {
          quantity: 1,
          product: {
            description: `Devolución · ${purchaseId}`,
            product_key: String(compra.satProductKey ?? "84111506"),
            unit_key: "E48",
            price: base,
            tax_included: false,
            taxes: [{ type: "IVA", rate: llevaIva ? IVA_RATE : 0, factor: "Tasa" }],
          },
        },
      ],
      use: "G02", // Devoluciones, descuentos o bonificaciones.
      payment_form: params.formaPago ?? "99",
      payment_method: "PUE",
      currency: "MXN",
    },
    auth,
  });
  if (!res.ok) {
    logger.error("nota_credito_falló", { purchaseId, err: String(res.error).slice(0, 300) });
    throw new HttpsError(
      "internal",
      `No se pudo emitir la nota de crédito: ${String(res.error).slice(0, 300)}`
    );
  }

  const nota = res.data;
  const acumulado = round2(yaAcreditado + base);

  /**
   * 🚨 SE REGISTRA COMO DOCUMENTO DEL COMPRADOR, no solo en la compra.
   *
   * `users/{buyerId}/invoices` no es «las facturas»: es **los comprobantes fiscales emitidos a
   * este comprador**, y una nota de crédito lo es. Sin este registro, `descargarDocumentoFiscal`
   * no sabría de quién es ni con qué llave pedirla, y el comprador no podría bajarse el PDF de
   * su propia devolución.
   */
  await db.collection("users").doc(buyerId).collection("invoices").doc(nota.id).set({
    buyerId,
    issuerCreatorId: creatorId,
    facturapiOrgId: orgId,
    facturapiInvoiceId: nota.id,
    uuid: nota.uuid ?? null,
    /** `E` de egreso: es lo que distingue una nota de crédito de una factura. */
    tipo: "E",
    relacionadaCon: uuidOriginal,
    total: base,
    currency: "MXN",
    status: "valid",
    purchaseIds: [purchaseId],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await compraRef.set(
    {
      notasCredito: {
        acumulado,
        /** El historial completo, para poder reconstruir qué se devolvió y cuándo. */
        emitidas: admin.firestore.FieldValue.arrayUnion({
          facturapiId: nota.id,
          uuid: nota.uuid ?? null,
          base,
          emitidaPor: pedidoPor,
          emitidaEn: new Date().toISOString(),
        }),
      },
    },
    { merge: true }
  );

  logger.info("nota_credito", { purchaseId, id: nota.id, uuid: nota.uuid, base, acumulado });

  return {
    facturapiId: nota.id,
    uuid: nota.uuid ?? null,
    base,
    acumulado,
    restante: round2(pesos.base - acumulado),
  };
}

/**
 * El botón de administración.
 *
 * ⚠️ Manual a propósito, como el resto de los actos fiscales irreversibles. Una nota de crédito
 * timbrada no se deshace con un botón.
 */
export const emitirNotaDeCreditoCallable = onCall(
  { region: REGION, cors: true, secrets: [facturapiTestKey, facturapiUserKey] },
  async (request) => {
    const uid = requirePlatformMod(request);

    const data = (request.data ?? {}) as Record<string, unknown>;
    const buyerId = String(data.buyerId ?? "").trim();
    const purchaseId = String(data.purchaseId ?? "").trim();
    const base = Number(data.base);
    const formaPago = String(data.formaPago ?? "").trim() || undefined;

    if (!buyerId || !purchaseId) {
      throw new HttpsError("invalid-argument", "Faltan el comprador y la compra.");
    }
    if (!Number.isFinite(base) || base <= 0) {
      throw new HttpsError("invalid-argument", "Falta el importe a devolver, sin impuesto.");
    }

    /** La red contra el error mudo. Ver la misma nota en `cancelacionGlobal.ts`. */
    try {
      return await emitirNotaDeCredito({ buyerId, purchaseId, base, formaPago, pedidoPor: uid });
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      const mensaje = err instanceof Error ? err.message : String(err);
      logger.error("nota_credito_excepcion", {
        buyerId,
        purchaseId,
        err: mensaje,
        stack: err instanceof Error ? err.stack?.slice(0, 1500) : null,
      });
      throw new HttpsError("internal", `Falló la nota de crédito: ${mensaje.slice(0, 300)}`);
    }
  }
);
