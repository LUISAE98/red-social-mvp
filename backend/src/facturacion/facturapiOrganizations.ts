// Administración de ORGANIZACIONES de Facturapi (multi-tenant) — Bloque 1b.
//
// Una organización por CREADOR mexicano: es la entidad que EMITE sus CFDIs de
// proveedor hacia Vibra (self-billing). Se administra con la USER key (nivel cuenta).
//
// Estructura confirmada contra la org real (GET /organizations/{id}):
//   legal: { name, legal_name, tax_id (RFC), tax_system (régimen), address: { zip } }
//   certificate: { has_certificate, expires_at, serial_number }
//
// El CSD (cer/key/password) se sube a Facturapi y vive allá — NUNCA en Firestore.

import { facturapiFetch, facturapiUpload } from "./facturapiClient";

const USER = { auth: "user" as const };

export type FacturapiOrg = {
  id: string;
  legal?: { tax_id?: string; tax_system?: string; legal_name?: string };
  certificate?: { has_certificate?: boolean; expires_at?: string; serial_number?: string };
};

export type OrgLegalInput = {
  /** Nombre comercial/display (Facturapi lo pide en `name`). */
  name: string;
  /** Razón social / nombre fiscal (como en la Constancia). */
  legalName: string;
  /** RFC del creador. */
  taxId: string;
  /** Clave de régimen fiscal SAT (ej. "612", "626"). */
  taxSystem: string;
  /** CP fiscal. */
  zip: string;
};

/** Crea una organización nueva. Devuelve el id. */
export async function createOrganization(displayName: string): Promise<string> {
  const res = await facturapiFetch<FacturapiOrg>("/organizations", {
    method: "POST",
    body: { name: displayName },
    ...USER,
  });
  if (!res.ok) throw new Error(`crear organización falló (${res.status}): ${res.error.slice(0, 200)}`);
  const id = res.data.id;
  if (!id) throw new Error("Facturapi no devolvió el id de la organización.");
  return id;
}

/**
 * Fija los datos legales de la organización (razón social, régimen, CP).
 * OJO: el RFC (tax_id) NO se manda aquí — Facturapi lo toma del CSD al subirlo
 * (verificado contra sandbox: PUT /legal rechaza `tax_id`). Se valida después.
 */
export async function updateOrganizationLegal(orgId: string, legal: OrgLegalInput): Promise<void> {
  const res = await facturapiFetch(`/organizations/${orgId}/legal`, {
    method: "PUT",
    body: {
      name: legal.name,
      legal_name: legal.legalName,
      tax_system: legal.taxSystem,
      address: { zip: legal.zip },
    },
    ...USER,
  });
  if (!res.ok) throw new Error(`datos legales fallaron (${res.status}): ${res.error.slice(0, 200)}`);
}

/** Lee la organización (para verificar el RFC que quedó tras subir el CSD). */
export async function getOrganization(orgId: string): Promise<FacturapiOrg> {
  const res = await facturapiFetch<FacturapiOrg>(`/organizations/${orgId}`, { ...USER });
  if (!res.ok) throw new Error(`leer organización falló (${res.status}): ${res.error.slice(0, 200)}`);
  return res.data;
}

/**
 * Sube el CSD (cer/key/password) a la organización. Multipart. Devuelve la info del
 * certificado (para guardar vigencia). Facturapi valida el CSD contra el RFC de la org.
 */
export async function uploadOrganizationCertificate(
  orgId: string,
  cerBase64: string,
  keyBase64: string,
  password: string
): Promise<{ expiresAt: string | null; serialNumber: string | null }> {
  const form = new FormData();
  form.append("cer", new Blob([Buffer.from(cerBase64, "base64")]), "csd.cer");
  form.append("key", new Blob([Buffer.from(keyBase64, "base64")]), "csd.key");
  form.append("password", password);

  const res = await facturapiUpload<FacturapiOrg>(`/organizations/${orgId}/certificate`, form, {
    method: "PUT",
    ...USER,
  });
  if (!res.ok) throw new Error(`subir CSD falló (${res.status}): ${res.error.slice(0, 300)}`);
  const cert = res.data.certificate ?? {};
  return {
    expiresAt: cert.expires_at ?? null,
    serialNumber: cert.serial_number ?? null,
  };
}

/**
 * Llave de prueba de la organización de un creador, para timbrar **a su nombre**.
 *
 * Es la pieza que hace posible el modelo de intermediación: la factura de venta la emite el
 * creador, así que hay que timbrarla en SU organización, no en la de Vibra. La llave se pide con
 * la credencial de usuario (multi-tenant) y **no se guarda**: se usa y se descarta.
 *
 * 🔁 Al pasar a producción, cambiar a la llave `live`. Facturapi las expone por separado.
 */
export async function getOrganizationTestKey(orgId: string): Promise<string> {
  const res = await facturapiFetch<string | { key?: string }>(
    `/organizations/${orgId}/apikeys/test`,
    { ...USER }
  );
  if (!res.ok) {
    throw new Error(`leer la llave de la organización falló (${res.status}): ${res.error.slice(0, 200)}`);
  }
  // Facturapi devuelve la llave como cadena suelta; se tolera la forma envuelta por si cambia.
  const key = typeof res.data === "string" ? res.data : res.data?.key ?? "";
  if (!key) throw new Error("Facturapi no devolvió la llave de la organización.");
  return key.trim();
}
