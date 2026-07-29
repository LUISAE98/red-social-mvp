// Datos fiscales del COMPRADOR (receptor) — Bloque 1c.
//
// El comprador NO sube CSD (no es emisor). Guardamos sus datos de receptor para
// que VIBRA timbre la factura de venta con SU propio CSD (Bloque 2).
//
// ✅ Validación contra el SAT: al guardar, creamos/actualizamos un "Customer" en
// Facturapi (en la org de Vibra). Facturapi valida los datos fiscales contra el SAT
// y devuelve error si no coinciden (RFC/nombre/CP/régimen — exacto en CFDI 4.0).
// Guardamos el `facturapiCustomerId` para reusarlo al timbrar (Bloque 2).
//
// ⚠️ La validación real contra el SAT SOLO ocurre con la llave LIVE (sk_live). En
// modo prueba (sk_test) Facturapi NO consulta al SAT, así que en sandbox casi todo
// pasa; el rechazo de RFCs inválidos empieza en producción.
//
// Documento: `buyerTaxProfiles/{uid}` (escritura SOLO backend; lectura del dueño).

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { facturapiFetch, facturapiTestKey } from "./facturapiClient";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();
const REGION = "us-central1";

// RFC: persona física (13) o moral (12). Incluye el genérico XAXX010101000.
const RFC_RE = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;
const ZIP_RE = /^\d{5}$/;

type FacturapiCustomer = { id?: string };

/** Extrae un mensaje legible del error crudo de Facturapi. */
function facturapiErrorMessage(raw: string): string {
  try {
    const j = JSON.parse(raw) as { message?: string };
    if (j?.message) return j.message;
  } catch {
    // no-op
  }
  return raw.slice(0, 200);
}

export const saveBuyerTaxProfile = onCall(
  { region: REGION, cors: true, secrets: [facturapiTestKey] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");

    const data = (request.data ?? {}) as Record<string, unknown>;
    const taxId = String(data.taxId ?? "").trim().toUpperCase();
    const legalName = String(data.legalName ?? "").trim();
    const taxSystem = String(data.taxSystem ?? "").trim(); // régimen del RECEPTOR (clave SAT)
    const zip = String(data.zip ?? "").trim();
    const usoCfdi = String(data.usoCfdi ?? "").trim(); // clave c_UsoCFDI (ej. "G03")
    const email = String(data.email ?? request.auth?.token?.email ?? "").trim();

    // 1) Validación de forma (rápida, antes de llamar a Facturapi).
    if (!RFC_RE.test(taxId)) throw new HttpsError("invalid-argument", "RFC inválido.");
    if (!legalName) throw new HttpsError("invalid-argument", "Falta el nombre o razón social.");
    if (!taxSystem) throw new HttpsError("invalid-argument", "Falta el régimen fiscal.");
    if (!ZIP_RE.test(zip)) throw new HttpsError("invalid-argument", "Código postal fiscal inválido.");
    if (!usoCfdi) throw new HttpsError("invalid-argument", "Falta el uso de CFDI.");

    const ref = db.collection("buyerTaxProfiles").doc(uid);
    const snap = await ref.get();
    const existingCustomerId = String(snap.data()?.facturapiCustomerId ?? "").trim();

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
      // Facturapi rechazó: datos no coinciden con el SAT (o dato inválido).
      throw new HttpsError("failed-precondition", `No pudimos validar tus datos con el SAT: ${facturapiErrorMessage(res.error)}`);
    }

    const facturapiCustomerId = res.data.id ?? (existingCustomerId || null);

    // 3) Guardar en Firestore (fuente de verdad) con el id del Customer de Facturapi.
    const now = admin.firestore.FieldValue.serverTimestamp();
    await ref.set(
      {
        buyerId: uid,
        taxId,
        legalName,
        taxSystem,
        zip,
        usoCfdi,
        facturapiCustomerId,
        updatedAt: now,
        ...(snap.exists ? {} : { createdAt: now }),
      },
      { merge: true }
    );

    return { ok: true };
  }
);
