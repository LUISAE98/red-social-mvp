// Emitir la factura nominativa de un comprador a nombre de UN creador.
//
// Vive aparte porque tiene DOS llamadores y ninguno puede ser el dueño del otro:
//
//   1. `generateBuyerInvoice` — el comprador la pide y se emite al momento.
//   2. `colaDeFacturas` — la pidió hace semanas, cuando el creador no tenía sello, y se emite
//      sola en cuanto lo sube.
//
// Los dos tienen que producir exactamente la misma factura. Duplicar el timbrado en dos sitios
// era pedir que se desincronizaran, y en un CFDI eso significa dos facturas distintas por la
// misma venta según por dónde entró la petición.
//
// Aquí viven también las reservas, por el mismo motivo: la regla de quién se queda una compra
// (`pendientesimpuestos.md` §A3) tiene que ser una sola para los dos caminos.

import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { facturapiFetch, type FacturapiAuth } from "./facturapiClient";
import { getOrganizationTestKey } from "./facturapiOrganizations";
import { productForType } from "./satProductCatalog";
import { compraReclamablePorNominativa } from "./globalInvoice";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

/** Tasa de IVA de México. El CFDI es solo mexicano y el comprador pagó base + IVA. */
const IVA_RATE = 0.16;

export function facturapiErrorMessage(raw: string): string {
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

/**
 * Una compra ya normalizada, con sus pesos **congelados el día de la venta**.
 *
 * 🚨 Lleva la base y el IVA por separado, no solo el total. Antes solo viajaba `totalMxn` y la
 * base se despejaba aquí dividiendo entre 1.16 — tirando justamente el desglose exacto que §A0
 * se había tomado la molestia de congelar y cuadrar.
 *
 * El problema no era estético: Facturapi recalcula el IVA como `base × 0.16`, y
 * `round2(total / 1.16) × 1.16` no siempre devuelve `total`. El CFDI podía totalizar un centavo
 * distinto de lo que pagó el comprador.
 */
export type CompraNormalizada = {
  id: string;
  creatorId: string;
  /** Base sin impuesto, en pesos. Del congelado, no despejada. */
  baseMxn: number;
  /** IVA mexicano de la venta, en pesos. Cero en exportación. */
  ivaMxn: number;
  type: string;
};

/**
 * Por qué una compra está apartada.
 *
 * - `emitiendo` — se está timbrando ahora mismo. Dura segundos, y si falla se suelta.
 * - `en_cola` — el creador no tenía sello. Puede durar semanas y **no se suelta**: es lo que
 *   mantiene correcta la factura global, porque esa venta ya no puede entrar en ella.
 * - `liberada` — se la sacó de una global cancelando con motivo 04 (§B7) para que el
 *   comprador pueda facturarla. La global no puede volver a llevársela, pero él sí puede
 *   reclamarla; es la única reserva que no bloquea a quien la creó.
 */
export type EstadoReserva = "emitiendo" | "en_cola" | "liberada";

/**
 * Aparta las compras antes de timbrarlas, releyendo dentro de una transacción.
 *
 * 🚨 Es la mitad del candado de §A3. Entre que se comprueba que una compra está libre y que se
 * timbra pasan varias llamadas de red —alta del cliente en Facturapi, lectura del perfil
 * fiscal—, y en ese hueco el proceso mensual puede meterla en la factura global. Sin releer
 * aquí, la venta acabaría en los dos comprobantes.
 *
 * Devuelve las rutas realmente apartadas. Si no salen todas, no se timbra nada.
 */
export async function reservarParaNominativa(
  paths: string[],
  estado: EstadoReserva
): Promise<string[]> {
  if (paths.length === 0) return [];
  return db.runTransaction(async (tx) => {
    const refs = paths.map((p) => db.doc(p));
    const snaps = await Promise.all(refs.map((r) => tx.get(r)));
    const ok: string[] = [];
    snaps.forEach((snap, n) => {
      if (!compraReclamablePorNominativa(snap.data())) return;
      tx.set(
        refs[n],
        {
          nominativaEnCurso: {
            estado,
            reservadoEn: admin.firestore.FieldValue.serverTimestamp(),
          },
        },
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
 * Sin esto, un fallo dejaría la compra apartada para siempre — ni el comprador podría
 * reintentar ni la global la recogería, y nadie lo notaría hasta que alguien reclamara su
 * factura meses después.
 */
export async function liberarReservaNominativa(paths: string[]): Promise<void> {
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

/**
 * Da de alta al comprador como cliente en la organización de un creador, o reutiliza el alta
 * previa. Los clientes de Facturapi son POR ORGANIZACIÓN: el que existe en la org de Vibra no
 * sirve para timbrar en la del creador.
 */
export async function asegurarClienteEnOrg(params: {
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

export type FacturaEmitida = {
  creatorId: string;
  invoiceId: string;
  uuid: string | null;
  total: number | null;
  purchaseIds: string[];
};

/**
 * Timbra la factura, la manda por correo y marca las compras.
 *
 * ⚠️ **Da por hecho que las compras YA están apartadas.** No reserva: quien llame decide con qué
 * estado apartarlas, porque el comprador que la pide ahora y la cola que la emite semanas
 * después no apartan igual.
 *
 * Si algo falla, lanza. Soltar la reserva es cosa del llamador, que es quien sabe si la compra
 * debe volver a estar libre o quedarse en cola.
 */
export async function emitirNominativa(params: {
  buyerId: string;
  creatorId: string;
  orgId: string;
  compras: CompraNormalizada[];
  billingProfileId: string;
  /** Perfil de facturación del comprador, ya leído. */
  perfil: Record<string, unknown>;
  usoCfdi: string;
  /** Clave `c_FormaPago` del SAT. `99` si no consta. */
  formaPago: string;
}): Promise<FacturaEmitida> {
  const { buyerId, creatorId, orgId, compras, billingProfileId, perfil, usoCfdi, formaPago } =
    params;

  const orgKey = await getOrganizationTestKey(orgId);
  const auth: FacturapiAuth = { orgKey };
  const customerId = await asegurarClienteEnOrg({
    buyerId,
    billingProfileId,
    creatorId,
    orgKey,
    perfil,
  });

  const items = compras.map((c) => {
    const prod = productForType(c.type);
    /**
     * 🚨 La base va TAL CUAL viene congelada, sin despejarla de nada.
     *
     * Y la tasa se decide por si esa venta llevó impuesto o no, en vez de dar el 16% por
     * sentado: una venta a comprador extranjero es exportación a 0%, y aunque hoy no lleve
     * CFDI, dejarlo cableado sería una bomba para el día que §B8 cambie eso.
     */
    const llevaIva = c.ivaMxn > 0;
    return {
      quantity: 1,
      product: {
        description: prod.description,
        product_key: prod.productKey,
        unit_key: prod.unitKey,
        price: c.baseMxn, // sin IVA; Facturapi lo calcula encima
        tax_included: false,
        taxes: [{ type: "IVA", rate: llevaIva ? IVA_RATE : 0, factor: "Tasa" }],
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
       * Lo guardó el webhook al confirmarse el pago, que es el único momento en que se sabe.
       * Si falta —una compra anterior al 2026-08-29, o un cargo que llegó sin expandir— va
       * `99`, «por definir»: decir que no consta es cierto, decir «tarjeta de crédito» sin
       * saberlo no.
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
  const email = String(perfil.email ?? "").trim();
  let emailSentTo: string | null = null;
  if (email) {
    const mailRes = await facturapiFetch(`/invoices/${inv.id}/email`, {
      method: "POST",
      body: { email: [email] },
      auth,
    });
    if (mailRes.ok) emailSentTo = email;
    else {
      logger.warn("emitirNominativa email_failed", {
        invoiceId: inv.id,
        error: String(mailRes.error).slice(0, 200),
      });
    }
  }

  const usados = compras.map((c) => c.id);
  await db.collection("users").doc(buyerId).collection("invoices").doc(inv.id).set({
    buyerId,
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
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Confirmada: la reserva se convierte en la marca definitiva y se limpia.
  const batch = db.batch();
  for (const pid of usados) {
    batch.set(
      db.doc(`users/${buyerId}/purchases/${pid}`),
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

  return {
    creatorId,
    invoiceId: inv.id,
    uuid: inv.uuid ?? null,
    total: typeof inv.total === "number" ? inv.total : null,
    purchaseIds: usados,
  };
}
