// Diagnóstico: ¿podemos obtener la API key de una ORGANIZACIÓN de creador?
//
// Para el self-billing (Bloque 4) hay que EMITIR dentro de la org del creador, y
// eso requiere la secret key de ESA org. El intento previo dio 401 (probablemente
// por ruta equivocada). Aquí probamos la ruta CORRECTA de Facturapi:
//     GET /v2/organizations/{id}/apikeys/test
// y devolvemos status + cuerpo exactos para saber si jala o si es tema de plan.
//
// Gate: solo moderador de plataforma (igual que facturapiHealthcheck).

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { facturapiFetch, facturapiUserKey, FACTURAPI_API_BASE } from "./facturapiClient";

const REGION = "us-central1";

type OrgList = { data?: Array<{ id?: string }> };

export const facturapiOrgKeyProbe = onCall(
  { region: REGION, secrets: [facturapiUserKey] },
  async (request) => {
    if (request.auth?.token?.role !== "moderator") {
      throw new HttpsError("permission-denied", "Solo un moderador puede ejecutar esto.");
    }

    let orgId = String((request.data as { orgId?: unknown })?.orgId ?? "").trim();

    // 1) Sin orgId → tomar la primera organización existente.
    if (!orgId) {
      const list = await facturapiFetch<OrgList>("/organizations?limit=1", { auth: "user" });
      if (!list.ok) throw new HttpsError("internal", `No pude listar organizaciones (${list.status}): ${list.error.slice(0, 150)}`);
      orgId = String(list.data.data?.[0]?.id ?? "");
      if (!orgId) throw new HttpsError("failed-precondition", "No hay ninguna organización creada (ningún creador con CSD todavía).");
    }

    // 2) Ruta CORRECTA de la llave de prueba de la org. Raw fetch para ver el cuerpo
    //    tal cual (la respuesta puede ser un string, no JSON).
    const key = facturapiUserKey.value().trim();
    const auth = "Basic " + Buffer.from(`${key}:`).toString("base64");
    const path = `/organizations/${orgId}/apikeys/test`;

    let status = 0;
    let body = "";
    try {
      const res = await fetch(`${FACTURAPI_API_BASE}${path}`, { method: "GET", headers: { Authorization: auth } });
      status = res.status;
      body = (await res.text().catch(() => "")).slice(0, 300);
    } catch (e) {
      throw new HttpsError("internal", `La llamada falló: ${e instanceof Error ? e.message : String(e)}`);
    }

    // No exponemos la llave completa: solo un preview enmascarado.
    const trimmed = body.replace(/^"|"$/g, "").trim();
    const looksLikeKey = /^sk_(test|live)_/.test(trimmed);
    const preview = looksLikeKey ? `${trimmed.slice(0, 12)}…(${trimmed.length} chars)` : body;

    logger.info("facturapiOrgKeyProbe", { orgId, status, looksLikeKey });
    return { orgId, endpoint: `GET ${path}`, status, looksLikeKey, preview };
  }
);
