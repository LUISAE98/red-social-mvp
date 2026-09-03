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
  facturapiFetch,
  facturapiDownload,
  facturapiTestKey,
  facturapiUserKey,
  type FacturapiAuth,
} from "./facturapiClient";
import { getOrganizationTestKey } from "./facturapiOrganizations";
import { productForType } from "./satProductCatalog";
import { FORMA_PAGO } from "./formaDePago";
import { leerImporteFiscal } from "./importeFiscal";
import { compraLibre } from "./globalInvoice";
import { consumeQuota } from "../quotas";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();
const REGION = "us-central1";

// Tasa de IVA de México (el CFDI es solo para México). El comprador pagó base+IVA.
const IVA_RATE = 0.16;

/** Un CFDI con más conceptos que esto no es una factura, es un error. */
const MAX_COMPRAS_POR_FACTURA = 50;

/** Tope de creadores distintos en una sola petición: cada uno cuesta una factura. */
const MAX_CREADORES_POR_PETICION = 10;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function facturapiErrorMessage(raw: string): string {
  try {
    const j = JSON.parse(raw) as { message?: string };
    if (j?.message) return j.message;
  } catch {
    // no-op
  }
  return raw.slice(0, 200);
}

type FacturapiInvoice = { id: string; uuid?: string; total?: number; verification_url?: string };
type FacturapiCustomer = { id?: string };

/** Motivo por el que el grupo de un creador no se pudo facturar. */
type MotivoNoFacturable =
  | "sin_sello"
  | "sin_datos_fiscales"
  | "error_timbrado"
  /** La factura global se le adelantó mientras se preparaba esta. Ver §A3 y §B7. */
  | "ya_en_global";

type CompraNormalizada = {
  id: string;
  creatorId: string;
  totalMxn: number;
  type: string;
};

/**
 * Da de alta al comprador como cliente en la organización de un creador, o reutiliza el alta
 * previa. Los clientes de Facturapi son POR ORGANIZACIÓN: el que existe en la org de Vibra no
 * sirve para timbrar en la del creador.
 */
async function asegurarClienteEnOrg(params: {
  buyerId: string;
  billingProfileId: string;
  creatorId: string;
  orgKey: string;
  perfil: Record<string, unknown>;
}): Promise<string> {
  const { buyerId, billingProfileId, creatorId, orgKey, perfil } = params;
  const ref = db.doc(`users/${buyerId}/billingProfiles/${billingProfileId}`);
  const porCreador = (perfil.facturapiCustomerByCreator ?? {}) as Record<string, string>;
  const previo = String(porCreador[creatorId] ?? "").trim();
  if (previo) return previo;

  const email = String(perfil.email ?? "").trim();
  const body: Record<string, unknown> = {
    legal_name: String(perfil.legalName ?? ""),
    tax_id: String(perfil.taxId ?? ""),
    tax_system: String(perfil.taxSystem ?? ""),
    address: { zip: String(perfil.zip ?? "") },
    ...(email ? { email } : {}),
  };
  const auth: FacturapiAuth = { orgKey };
  const res = await facturapiFetch<FacturapiCustomer>("/customers", { method: "POST", body, auth });
  if (!res.ok || !res.data?.id) {
    throw new Error(`alta de cliente falló: ${facturapiErrorMessage(res.ok ? "" : res.error)}`);
  }
  const customerId = res.data.id;
  await ref.set(
    { facturapiCustomerByCreator: { ...porCreador, [creatorId]: customerId } },
    { merge: true }
  );
  return customerId;
}

/**
 * Aparta las compras para la factura nominativa, antes de timbrarla.
 *
 * 🚨 Es la otra mitad del candado de §A3. El primer filtro, al leer las compras, mira que
 * estén libres; pero entre esa lectura y el timbrado pasan varias llamadas de red —alta de
 * cliente en Facturapi, lectura del perfil fiscal— y en ese hueco el proceso mensual puede
 * meter la compra en la factura global. Sin esta reserva, la venta acabaría en los dos
 * comprobantes, porque los dos caminos timbraban primero y marcaban después.
 *
 * Devuelve las rutas realmente apartadas. Si no salen todas, no se timbra nada de ese creador.
 */
async function reservarParaNominativa(paths: string[]): Promise<string[]> {
  return db.runTransaction(async (tx) => {
    const refs = paths.map((p) => db.doc(p));
    const snaps = await Promise.all(refs.map((r) => tx.get(r)));
    const ok: string[] = [];
    snaps.forEach((snap, n) => {
      if (!compraLibre(snap.data())) return;
      tx.set(
        refs[n],
        { nominativaEnCurso: { reservadoEn: admin.firestore.FieldValue.serverTimestamp() } },
        { merge: true }
      );
      ok.push(paths[n]);
    });
    return ok;
  });
}

/**
 * Suelta la reserva. Se llama cuando el timbrado falla o cuando no se consiguieron todas.
 *
 * Sin esto, un fallo dejaría la compra apartada para siempre: ni el comprador podría reintentar
 * ni la global la recogería, y nadie lo notaría hasta que alguien reclamara su factura.
 */
async function liberarReservaNominativa(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const batch = db.batch();
  for (const p of paths) {
    batch.set(
      db.doc(p),
      { nominativaEnCurso: admin.firestore.FieldValue.delete() },
      { merge: true }
    );
  }
  await batch.commit();
}

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

    // 2) Tasa de cambio (para el fallback USD→MXN).
    const ratesSnap = await db.doc("config/exchangeRates").get();
    const rates = (ratesSnap.data()?.rates ?? {}) as Record<string, number>;
    const rMxn = Number(rates.MXN);

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
      // Otra petición de factura va por delante con esta compra.
      if (p.nominativaEnCurso) {
        throw new HttpsError(
          "failed-precondition",
          "Ya hay una factura de esta compra en camino, dale un momento."
        );
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
       * 💱 Los PESOS de esta compra.
       *
       * Salen del importe congelado el día de la venta (`fiscalMxn`), con el tipo de cambio que
       * de verdad se le aplicó a este comprador. Reexpedir la factura dentro de dos años da el
       * mismo número.
       *
       * 🚨 La rama anterior leía `intent.settlementCurrency === "MXN"` y **nunca se cumplía**:
       * `settlementCurrency` es siempre `"USD"` desde el corte a la denominación en dólares
       * (`tax/composeCharge.ts`). Era código muerto de cuando la denominación era en pesos, y
       * todas las facturas caían al respaldo de la tabla sin que se notara.
       *
       * El respaldo se queda **solo para las ventas anteriores al congelado**, hasta que el
       * backfill las alcance. Ver `pendientesimpuestos.md` §A0.
       */
      const congelado = leerImporteFiscal(p.fiscalMxn);
      let totalMxn: number;
      if (congelado) {
        totalMxn = congelado.total;
      } else {
        const grossUsd = Number(p.grossAmount) || 0;
        const taxUsd = Number(p.taxAmount) || 0;
        if (!Number.isFinite(rMxn) || rMxn <= 0) {
          throw new HttpsError("failed-precondition", "No hay tasa de cambio disponible para facturar esta compra.");
        }
        totalMxn = round2((grossUsd + taxUsd) * rMxn);
      }
      if (!(totalMxn > 0)) throw new HttpsError("failed-precondition", "Monto inválido para facturar.");

      const lista = porCreador.get(creatorId) ?? [];
      lista.push({ id: pid, creatorId, totalMxn, type: String(p.type ?? "") });
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
    const emitidas: Array<{
      creatorId: string;
      invoiceId: string;
      uuid: string | null;
      total: number | null;
      purchaseIds: string[];
    }> = [];
    const noFacturables: Array<{ creatorId: string; motivo: MotivoNoFacturable; detalle?: string }> = [];

    for (const [creatorId, compras] of porCreador) {
      // 4a) El creador debe tener organización y sello VIGENTE: sin eso no hay emisor.
      const fiscalSnap = await db.doc(`creatorTaxProfiles/${creatorId}`).get();
      const fiscal = fiscalSnap.exists ? fiscalSnap.data() ?? {} : {};
      const orgId = String(fiscal.facturapiOrgId ?? "").trim();
      const csdStatus = String(fiscal.csdStatus ?? "none");
      if (!orgId) {
        noFacturables.push({ creatorId, motivo: "sin_datos_fiscales" });
        continue;
      }
      if (csdStatus !== "valid") {
        noFacturables.push({ creatorId, motivo: "sin_sello" });
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
      const reservadas = await reservarParaNominativa(paths);
      if (reservadas.length !== paths.length) {
        // Lo poco que se haya apartado se suelta: nadie va a timbrarlo en esta pasada.
        await liberarReservaNominativa(reservadas);
        noFacturables.push({ creatorId, motivo: "ya_en_global" });
        continue;
      }

      try {
        const orgKey = await getOrganizationTestKey(orgId);
        const auth: FacturapiAuth = { orgKey };
        const customerId = await asegurarClienteEnOrg({
          buyerId: uid,
          billingProfileId,
          creatorId,
          orgKey,
          perfil: prof,
        });

        const items = compras.map((c) => {
          // El total ya incluye IVA; la base (precio del concepto) = total / 1.16.
          const baseMxn = round2(c.totalMxn / (1 + IVA_RATE));
          const prod = productForType(c.type);
          return {
            quantity: 1,
            product: {
              description: prod.description,
              product_key: prod.productKey,
              unit_key: prod.unitKey,
              price: baseMxn, // sin IVA; Facturapi calcula el 16% encima
              tax_included: false,
              taxes: [{ type: "IVA", rate: IVA_RATE, factor: "Tasa" }],
            },
          };
        });

        const res = await facturapiFetch<FacturapiInvoice>("/invoices", {
          method: "POST",
          body: {
            customer: customerId,
            items,
            use: usoCfdi,
            /**
             * 🧾 Cómo pagó de verdad, no una suposición.
             *
             * Lo guardó el webhook al confirmarse el pago, que es el único momento en que
             * se sabe. Si falta —una compra anterior al 2026-08-29, o un cargo que llegó
             * sin expandir— va `99`, «por definir»: decir que no consta es cierto, decir
             * «tarjeta de crédito» sin saberlo no.
             */
            payment_form: formaPago,
            payment_method: "PUE", // Pago en una sola exhibición
            currency: "MXN",
          },
          auth,
        });
        if (!res.ok) throw new Error(facturapiErrorMessage(res.error));
        const inv = res.data;

        // Correo al comprador. Si falla NO se tira: la factura ya está timbrada.
        const email = String(prof.email ?? "").trim();
        let emailSentTo: string | null = null;
        if (email) {
          const mailRes = await facturapiFetch(`/invoices/${inv.id}/email`, {
            method: "POST",
            body: { email: [email] },
            auth,
          });
          if (mailRes.ok) emailSentTo = email;
          else logger.warn("generateBuyerInvoice email_failed", { invoiceId: inv.id, error: String(mailRes.error).slice(0, 200) });
        }

        const usados = compras.map((c) => c.id);
        const now = admin.firestore.FieldValue.serverTimestamp();
        await db.collection("users").doc(uid).collection("invoices").doc(inv.id).set({
          buyerId: uid,
          // Quién EMITE: el creador. Vibra solo timbra por su cuenta.
          issuerCreatorId: creatorId,
          facturapiOrgId: orgId,
          facturapiInvoiceId: inv.id,
          uuid: inv.uuid ?? null,
          total: typeof inv.total === "number" ? inv.total : null,
          currency: "MXN",
          status: "valid",
          purchaseIds: usados,
          billingProfileId,
          verificationUrl: inv.verification_url ?? null,
          sentTo: emailSentTo,
          createdAt: now,
        });

        // Confirmada: la reserva se convierte en la marca definitiva y se limpia.
        const batch = db.batch();
        for (const pid of usados) {
          batch.set(
            db.doc(`users/${uid}/purchases/${pid}`),
            {
              invoiced: true,
              invoiceId: inv.id,
              invoiceUuid: inv.uuid ?? null,
              nominativaEnCurso: admin.firestore.FieldValue.delete(),
            },
            { merge: true }
          );
        }
        await batch.commit();

        emitidas.push({
          creatorId,
          invoiceId: inv.id,
          uuid: inv.uuid ?? null,
          total: typeof inv.total === "number" ? inv.total : null,
          purchaseIds: usados,
        });
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
