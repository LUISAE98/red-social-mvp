// Perfiles de facturación del COMPRADOR (varios, tipo "tarjetas guardadas").
//
// A diferencia de `buyerTaxProfiles/{uid}` (un solo receptor), aquí el comprador
// puede guardar MÚLTIPLES juegos de datos fiscales y elegir con cuál facturar,
// igual que una pasarela guarda varias tarjetas. Se presentan como contenedores
// seleccionables en el panel de facturación (BuyerInvoicePanel).
//
// ✅ Validación contra el SAT: al guardar creamos/actualizamos un "Customer" en
// Facturapi (org de Vibra). Facturapi valida RFC/nombre/CP/régimen contra el SAT
// (solo real con llave LIVE) y guardamos el `facturapiCustomerId` para el timbrado.
//
// Documento: `users/{uid}/billingProfiles/{profileId}` (escritura SOLO backend;
// lectura del dueño).

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { facturapiFetch, facturapiTestKey } from "./facturapiClient";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();
const REGION = "us-central1";

const RFC_RE = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;
const ZIP_RE = /^\d{5}$/;

type FacturapiCustomer = { id?: string };

function facturapiErrorMessage(raw: string): string {
  try {
    const j = JSON.parse(raw) as { message?: string };
    if (j?.message) return j.message;
  } catch {
    // no-op
  }
  return raw.slice(0, 200);
}

export const saveBuyerBillingProfile = onCall(
  { region: REGION, cors: true, secrets: [facturapiTestKey] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");

    const data = (request.data ?? {}) as Record<string, unknown>;
    const profileId = String(data.profileId ?? "").trim(); // vacío = crear nuevo
    const taxId = String(data.taxId ?? "").trim().toUpperCase();
    const legalName = String(data.legalName ?? "").trim();
    const taxSystem = String(data.taxSystem ?? "").trim();
    const zip = String(data.zip ?? "").trim();
    const usoCfdi = String(data.usoCfdi ?? "").trim();
    const email = String(data.email ?? request.auth?.token?.email ?? "").trim();

    // 1) Validación de forma.
    if (!RFC_RE.test(taxId)) throw new HttpsError("invalid-argument", "RFC inválido.");
    if (!legalName) throw new HttpsError("invalid-argument", "Falta el nombre o razón social.");
    if (!taxSystem) throw new HttpsError("invalid-argument", "Falta el régimen fiscal.");
    if (!ZIP_RE.test(zip)) throw new HttpsError("invalid-argument", "Código postal fiscal inválido.");
    if (!usoCfdi) throw new HttpsError("invalid-argument", "Falta el uso de CFDI.");

    const col = db.collection("users").doc(uid).collection("billingProfiles");
    const ref = profileId ? col.doc(profileId) : col.doc();
    const snap = profileId ? await ref.get() : null;
    if (profileId && !snap?.exists) throw new HttpsError("not-found", "Ese perfil de facturación no existe.");
    const existingCustomerId = String(snap?.data()?.facturapiCustomerId ?? "").trim();

    // 2) Validación contra el SAT vía Facturapi (crear o actualizar Customer).
    const customerBody: Record<string, unknown> = {
      legal_name: legalName,
      tax_id: taxId,
      tax_system: taxSystem,
      address: { zip },
      ...(email ? { email } : {}),
    };

    const res = existingCustomerId
      ? await facturapiFetch<FacturapiCustomer>(`/customers/${existingCustomerId}`, { method: "PUT", body: customerBody, auth: "secret" })
      : await facturapiFetch<FacturapiCustomer>("/customers", { method: "POST", body: customerBody, auth: "secret" });

    if (!res.ok) {
      throw new HttpsError("failed-precondition", `No pudimos validar tus datos con el SAT: ${facturapiErrorMessage(res.error)}`);
    }

    const facturapiCustomerId = res.data.id ?? (existingCustomerId || null);

    // 3) Guardar en Firestore.
    const now = admin.firestore.FieldValue.serverTimestamp();
    await ref.set(
      {
        buyerId: uid,
        taxId,
        legalName,
        taxSystem,
        zip,
        usoCfdi,
        email: email || null,
        facturapiCustomerId,
        updatedAt: now,
        ...(snap?.exists ? {} : { createdAt: now }),
      },
      { merge: true }
    );

    return { ok: true, id: ref.id };
  }
);

export const deleteBuyerBillingProfile = onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
    const profileId = String((request.data as { profileId?: unknown })?.profileId ?? "").trim();
    if (!profileId) throw new HttpsError("invalid-argument", "Falta el perfil a eliminar.");
    await db.collection("users").doc(uid).collection("billingProfiles").doc(profileId).delete();
    return { ok: true };
  }
);
