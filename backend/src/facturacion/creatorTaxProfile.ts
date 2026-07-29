// Perfil fiscal del CREADOR-proveedor (Bloque 1a).
//
// Modelo vendedor directo: el creador factura a Vibra su ~77% (self-billing). Para
// eso Vibra necesita sus DATOS fiscales (RFC, régimen, CP) y su CONSENTIMIENTO para
// que Vibra emita sus CFDIs por él. El CSD (que habilita el timbrado real) se sube
// aparte en el Bloque 1b — aquí solo se capturan datos + consentimiento.
//
// Documento: `creatorTaxProfiles/{uid}` (escritura SOLO backend; lectura del dueño).
// El RFC nunca lo escribe el cliente directo: pasa por esta callable (validada).
//
// Nada de CSD ni archivos sensibles se guardan en Firestore: el CSD vive en la
// organización del creador en Facturapi (Bloque 1b). Aquí solo van datos + estado.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();
const REGION = "us-central1";

// RFC: persona física (13) o moral (12). Validación básica de forma (no valida ante SAT).
const RFC_RE = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;
const ZIP_RE = /^\d{5}$/;

/** Versión vigente del aviso de auto-facturación (self-billing). Súbela si cambia el texto. */
export const SELF_BILLING_CONSENT_VERSION = "2026-07-28";

export const saveCreatorTaxProfile = onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");

    const data = (request.data ?? {}) as Record<string, unknown>;
    const taxId = String(data.taxId ?? "").trim().toUpperCase();
    const legalName = String(data.legalName ?? "").trim();
    const taxSystem = String(data.taxSystem ?? "").trim(); // clave de régimen SAT (ej. "626")
    const zip = String(data.zip ?? "").trim();

    if (!RFC_RE.test(taxId)) {
      throw new HttpsError("invalid-argument", "RFC inválido.");
    }
    if (!legalName) {
      throw new HttpsError("invalid-argument", "Falta el nombre o razón social fiscal.");
    }
    if (!taxSystem) {
      throw new HttpsError("invalid-argument", "Falta el régimen fiscal.");
    }
    if (!ZIP_RE.test(zip)) {
      throw new HttpsError("invalid-argument", "Código postal fiscal inválido.");
    }
    // El consentimiento de self-billing NO se pide aquí: aplica solo a la ruta
    // AUTOMÁTICA y se captura al subir el CSD (uploadCreatorCsd). Estos datos los
    // usa también la ruta manual (el creador emite su propio CFDI a Vibra).

    const ref = db.collection("creatorTaxProfiles").doc(uid);
    const now = admin.firestore.FieldValue.serverTimestamp();
    const snap = await ref.get();
    const prev = snap.exists ? snap.data() ?? {} : {};

    await ref.set(
      {
        creatorId: uid,
        country: "MX", // creador mexicano (persona física/moral). Extranjeros: flujo aparte (Título V).
        taxId,
        legalName,
        taxSystem,
        zip,
        // Estado del alta: datos completos, pero aún SIN CSD (eso lo habilita el cobro real).
        // `facturapiOrgId`/`csdStatus` los pone el Bloque 1b al subir el CSD.
        facturapiOrgId: prev.facturapiOrgId ?? null,
        csdStatus: prev.csdStatus ?? "none",
        status: prev.csdStatus === "valid" ? "ready" : "data_complete",
        updatedAt: now,
        ...(snap.exists ? {} : { createdAt: now }),
      },
      { merge: true }
    );

    return { ok: true, status: prev.csdStatus === "valid" ? "ready" : "data_complete" };
  }
);
