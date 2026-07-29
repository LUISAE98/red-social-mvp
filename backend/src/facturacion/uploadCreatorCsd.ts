// uploadCreatorCsd — sube el CSD del creador y crea/actualiza su organización en
// Facturapi (Bloque 1b). Habilita la ruta AUTOMÁTICA (self-billing): a partir de
// aquí las facturas del creador → Vibra se pueden timbrar solas en cada retiro.
//
// El CSD (cer/key/password) va a Facturapi y vive allá; NUNCA se guarda en Firestore.
// En Firestore solo queda: facturapiOrgId + csdStatus + vigencia del certificado.
//
// Requiere que el creador ya tenga sus DATOS fiscales (Bloque 1a): RFC/régimen/CP.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import {
  createOrganization,
  updateOrganizationLegal,
  uploadOrganizationCertificate,
  getOrganization,
} from "./facturapiOrganizations";
import { facturapiTestKey, facturapiUserKey } from "./facturapiClient";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();
const REGION = "us-central1";

export const uploadCreatorCsd = onCall(
  { region: REGION, cors: true, secrets: [facturapiUserKey, facturapiTestKey] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");

    const data = (request.data ?? {}) as Record<string, unknown>;
    const cerBase64 = String(data.cerBase64 ?? "").trim();
    const keyBase64 = String(data.keyBase64 ?? "").trim();
    const password = String(data.password ?? "");
    if (!cerBase64 || !keyBase64 || !password) {
      throw new HttpsError("invalid-argument", "Faltan los archivos del CSD o la contraseña.");
    }

    const ref = db.collection("creatorTaxProfiles").doc(uid);
    const snap = await ref.get();
    const profile = snap.exists ? snap.data() ?? {} : {};
    // El CSD requiere los datos fiscales ya capturados (Bloque 1a).
    if (!profile.taxId || !profile.taxSystem || !profile.zip || !profile.legalName) {
      throw new HttpsError("failed-precondition", "Primero completa tus datos fiscales (RFC, régimen, CP).");
    }

    try {
      // Reusa la organización si ya existe (re-subir CSD renovado); si no, la crea.
      let orgId = String(profile.facturapiOrgId ?? "").trim();
      if (!orgId) {
        orgId = await createOrganization(String(profile.legalName));
      }

      await updateOrganizationLegal(orgId, {
        name: String(profile.legalName),
        legalName: String(profile.legalName),
        taxId: String(profile.taxId),
        taxSystem: String(profile.taxSystem),
        zip: String(profile.zip),
      });

      const cert = await uploadOrganizationCertificate(orgId, cerBase64, keyBase64, password);

      // El RFC lo fija el CSD; verificamos que el certificado subido SÍ corresponda
      // al RFC que el creador declaró (evita subir el CSD de otra persona).
      const org = await getOrganization(orgId);
      const orgRfc = String(org.legal?.tax_id ?? "").toUpperCase();
      const declaredRfc = String(profile.taxId).toUpperCase();
      if (orgRfc && orgRfc !== declaredRfc) {
        throw new Error(`El CSD es del RFC ${orgRfc}, pero tu RFC declarado es ${declaredRfc}.`);
      }

      const now = admin.firestore.FieldValue.serverTimestamp();
      await ref.set(
        {
          facturapiOrgId: orgId,
          csdStatus: "valid",
          csdExpiresAt: cert.expiresAt,
          csdSerialNumber: cert.serialNumber,
          status: "ready",
          updatedAt: now,
        },
        { merge: true }
      );

      return { ok: true, status: "ready", expiresAt: cert.expiresAt };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // No marcamos "valid": el CSD no quedó bien (contraseña/archivo/RFC no coincide).
      await ref.set(
        { csdStatus: "invalid", csdLastError: msg.slice(0, 300), updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
      throw new HttpsError("failed-precondition", `No se pudo validar el CSD: ${msg.slice(0, 200)}`);
    }
  }
);
