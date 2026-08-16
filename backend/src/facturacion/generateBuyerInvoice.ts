// Factura del COMPRADOR (Vibra → comprador) — Bloque 2.
//
// MODELO VENDEDOR DIRECTO: Vibra es el emisor. Se timbra el CFDI 4.0 en la ORG de
// Vibra (secret key), con el comprador como `customer` (creado/validado antes vía
// buyerBillingProfiles). Los conceptos son las compras seleccionadas.
//
// 💱 Moneda: el CFDI va en MXN con los PESOS realmente cobrados. Para cada compra
// tomamos el `settlementAmount` (MXN) del `paymentIntents/{id}` — para las
// experiencias el id del espejo de compra == externalReference del intent. Si no
// hubiera intent (flujos legados), caemos a convertir (base+IVA) USD→MXN con la
// tasa vigente. El total del CFDI = lo cobrado; la base = total / 1.16 (IVA 16%).
//
// Documento resultante: `users/{uid}/invoices/{facturapiInvoiceId}` (dueño lee;
// escritura solo backend). Cada compra facturada se marca `invoiced: true`.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { facturapiFetch, facturapiDownload, facturapiTestKey } from "./facturapiClient";
import { productForType } from "./satProductCatalog";
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

export const generateBuyerInvoice = onCall(
  { region: REGION, cors: true, secrets: [facturapiTestKey] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");

    const data = (request.data ?? {}) as Record<string, unknown>;
    // ⚠️ Sin duplicados y con tope.
    //
    // El mismo id repetido creaba VARIOS conceptos en el CFDI por una sola compra
    // —una factura por más de lo que se cobró— y al final solo se marcaba una vez
    // como facturada. Y sin tope, una llamada con miles de ids salía cara en
    // lecturas y podía timbrar un documento absurdo.
    const purchaseIds = Array.from(
      new Set(
        (Array.isArray(data.purchaseIds) ? data.purchaseIds : []).map((x) => String(x).trim())
      )
    ).filter(Boolean);

    if (purchaseIds.length > MAX_COMPRAS_POR_FACTURA) {
      throw new HttpsError(
        "invalid-argument",
        `Puedes facturar hasta ${MAX_COMPRAS_POR_FACTURA} movimientos por factura.`
      );
    }
    const billingProfileId = String(data.billingProfileId ?? "").trim();
    if (purchaseIds.length === 0) throw new HttpsError("invalid-argument", "Selecciona al menos un movimiento.");
    if (!billingProfileId) throw new HttpsError("invalid-argument", "Falta el perfil de facturación.");

    // Facturapi cobra por factura emitida. Va después de validar la petición
    // para no gastarle el día a quien mandó datos incompletos.
    await consumeQuota(uid, "invoice");

    // 1) Perfil de facturación (customer de Facturapi + uso de CFDI).
    const profSnap = await db.doc(`users/${uid}/billingProfiles/${billingProfileId}`).get();
    if (!profSnap.exists) throw new HttpsError("not-found", "Perfil de facturación no encontrado.");
    const prof = profSnap.data() ?? {};
    const customerId = String(prof.facturapiCustomerId ?? "").trim();
    if (!customerId) throw new HttpsError("failed-precondition", "El perfil de facturación no tiene cliente de Facturapi.");
    const usoCfdi = String(prof.usoCfdi ?? "G03").trim();

    // 2) Tasa de cambio (para el fallback USD→MXN).
    const ratesSnap = await db.doc("config/exchangeRates").get();
    const rates = (ratesSnap.data()?.rates ?? {}) as Record<string, number>;
    const rMxn = Number(rates.MXN);

    // 3) Armar conceptos desde las compras (validando propiedad/estado/no duplicado).
    const items: Array<Record<string, unknown>> = [];
    const usedPurchaseIds: string[] = [];
    for (const pid of purchaseIds) {
      const pSnap = await db.doc(`users/${uid}/purchases/${pid}`).get();
      if (!pSnap.exists) throw new HttpsError("not-found", `Compra ${pid} no encontrada.`);
      const p = pSnap.data() ?? {};
      if (p.status !== "paid") throw new HttpsError("failed-precondition", "Solo puedes facturar compras pagadas.");
      if (p.invoiced === true) throw new HttpsError("failed-precondition", "Una de las compras ya fue facturada.");

      // MXN real cobrado (del intent). Para experiencias, id de compra == intent id.
      const intentSnap = await db.doc(`paymentIntents/${pid}`).get();
      const intent = intentSnap.exists ? intentSnap.data() ?? {} : null;
      let totalMxn: number;
      if (intent && intent.settlementCurrency === "MXN" && Number.isFinite(Number(intent.settlementAmount))) {
        totalMxn = Number(intent.settlementAmount);
      } else {
        // Fallback: convertir (base + IVA) USD → MXN con la tasa vigente.
        const grossUsd = Number(p.grossAmount) || 0;
        const taxUsd = Number(p.taxAmount) || 0;
        if (!Number.isFinite(rMxn) || rMxn <= 0) {
          throw new HttpsError("failed-precondition", "No hay tasa de cambio disponible para facturar esta compra.");
        }
        totalMxn = round2((grossUsd + taxUsd) * rMxn);
      }
      if (!(totalMxn > 0)) throw new HttpsError("failed-precondition", "Monto inválido para facturar.");

      // El total ya incluye IVA; la base (precio del concepto) = total / 1.16.
      const baseMxn = round2(totalMxn / (1 + IVA_RATE));
      const prod = productForType(String(p.type ?? ""));
      items.push({
        quantity: 1,
        product: {
          description: prod.description,
          product_key: prod.productKey,
          unit_key: prod.unitKey,
          price: baseMxn, // sin IVA; Facturapi calcula el 16% encima
          tax_included: false,
          taxes: [{ type: "IVA", rate: IVA_RATE, factor: "Tasa" }],
        },
      });
      usedPurchaseIds.push(pid);
    }

    // 4) Timbrar el CFDI en la org de Vibra (secret key).
    const invoiceBody: Record<string, unknown> = {
      customer: customerId,
      items,
      use: usoCfdi,
      payment_form: "04", // Tarjeta de crédito 🔁 FISCALISTA
      payment_method: "PUE", // Pago en una sola exhibición
      currency: "MXN",
    };
    const res = await facturapiFetch<FacturapiInvoice>("/invoices", { method: "POST", body: invoiceBody, auth: "secret" });
    if (!res.ok) {
      throw new HttpsError("failed-precondition", `No se pudo generar la factura: ${facturapiErrorMessage(res.error)}`);
    }
    const inv = res.data;

    // 5) Enviar la factura por correo al comprador (PDF + XML) si capturó correo.
    // Si el envío falla, NO tiramos: la factura ya está timbrada; solo lo registramos.
    const email = String(prof.email ?? "").trim();
    let emailSentTo: string | null = null;
    if (email) {
      const mailRes = await facturapiFetch(`/invoices/${inv.id}/email`, {
        method: "POST",
        body: { email: [email] },
        auth: "secret",
      });
      if (mailRes.ok) emailSentTo = email;
      else logger.warn("generateBuyerInvoice email_failed", { invoiceId: inv.id, error: String(mailRes.error).slice(0, 200) });
    }

    // 6) Guardar el CFDI y marcar las compras como facturadas.
    const now = admin.firestore.FieldValue.serverTimestamp();
    await db.collection("users").doc(uid).collection("invoices").doc(inv.id).set({
      buyerId: uid,
      facturapiInvoiceId: inv.id,
      uuid: inv.uuid ?? null,
      total: typeof inv.total === "number" ? inv.total : null,
      currency: "MXN",
      status: "valid",
      purchaseIds: usedPurchaseIds,
      billingProfileId,
      verificationUrl: inv.verification_url ?? null,
      sentTo: emailSentTo,
      createdAt: now,
    });

    const batch = db.batch();
    for (const pid of usedPurchaseIds) {
      batch.set(
        db.doc(`users/${uid}/purchases/${pid}`),
        { invoiced: true, invoiceId: inv.id, invoiceUuid: inv.uuid ?? null },
        { merge: true }
      );
    }
    await batch.commit();

    return { ok: true, invoiceId: inv.id, uuid: inv.uuid ?? null, total: typeof inv.total === "number" ? inv.total : null, email: emailSentTo };
  }
);

// Descarga el PDF de una factura del comprador (base64) para bajarla desde el panel.
export const downloadBuyerInvoice = onCall(
  { region: REGION, cors: true, secrets: [facturapiTestKey] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
    const invoiceId = String((request.data as { invoiceId?: unknown })?.invoiceId ?? "").trim();
    if (!invoiceId) throw new HttpsError("invalid-argument", "Falta la factura a descargar.");

    // El dueño solo baja SUS facturas.
    const snap = await db.doc(`users/${uid}/invoices/${invoiceId}`).get();
    if (!snap.exists) throw new HttpsError("not-found", "Factura no encontrada.");
    const facturapiId = String(snap.data()?.facturapiInvoiceId ?? invoiceId);
    const uuid = String(snap.data()?.uuid ?? invoiceId);

    const res = await facturapiDownload(`/invoices/${facturapiId}/pdf`, { auth: "secret" });
    if (!res.ok) throw new HttpsError("failed-precondition", `No se pudo descargar la factura: ${facturapiErrorMessage(res.error)}`);

    return { ok: true, pdfBase64: res.data, filename: `factura-${uuid}.pdf` };
  }
);
