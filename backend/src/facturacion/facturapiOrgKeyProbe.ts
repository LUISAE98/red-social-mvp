// Diagnóstico: ¿podemos obtener la API key de una ORGANIZACIÓN?
//
// Para el self-billing (Bloque 4) hay que EMITIR dentro de la org del creador, y
// eso requiere la secret key de ESA org. El intento previo dio 401 (probablemente
// por ruta equivocada). Aquí probamos la ruta CORRECTA:
//     GET /v2/organizations/{id}/apikeys/test
//
// No hace falta CSD ni un creador real: creamos un "cajón" temporal (solo nombre),
// intentamos sacar su llave de prueba, y lo BORRAMOS. Devolvemos status + cuerpo.
//
// Gate: solo moderador de plataforma (igual que facturapiHealthcheck).

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { facturapiFetch, facturapiUserKey, FACTURAPI_API_BASE } from "./facturapiClient";

const REGION = "us-central1";

export const facturapiOrgKeyProbe = onCall(
  { region: REGION, secrets: [facturapiUserKey] },
  async (request) => {
    if (request.auth?.token?.role !== "moderator") {
      throw new HttpsError("permission-denied", "Solo un moderador puede ejecutar esto.");
    }

    // 1) Crear un cajón (organización) temporal — solo nombre, sin CSD.
    const created = await facturapiFetch<{ id?: string }>("/organizations", {
      method: "POST",
      body: { name: "VIBRA-PROBE (borrar)" },
      auth: "user",
    });
    if (!created.ok) {
      throw new HttpsError("internal", `No pude crear la organización de prueba (${created.status}): ${created.error.slice(0, 180)}`);
    }
    const orgId = String(created.data.id ?? "");
    if (!orgId) throw new HttpsError("internal", "Facturapi no devolvió el id de la organización de prueba.");

    // 2) Intentar sacar la llave de PRUEBA de esa org (ruta correcta). Raw fetch para
    //    ver el cuerpo tal cual (la respuesta puede ser un string, no JSON).
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
      // Aun si falla, intentamos borrar el cajón temporal antes de salir.
      await facturapiFetch(`/organizations/${orgId}`, { method: "DELETE", auth: "user" }).catch(() => {});
      throw new HttpsError("internal", `La llamada falló: ${e instanceof Error ? e.message : String(e)}`);
    }

    // 3) Borrar el cajón temporal (limpieza).
    const del = await facturapiFetch(`/organizations/${orgId}`, { method: "DELETE", auth: "user" }).catch(() => null);

    // No exponemos la llave completa: solo un preview enmascarado.
    const trimmed = body.replace(/^"|"$/g, "").trim();
    const looksLikeKey = /^sk_(test|live)_/.test(trimmed);
    const preview = looksLikeKey ? `${trimmed.slice(0, 12)}…(${trimmed.length} chars)` : body;

    logger.info("facturapiOrgKeyProbe", { orgId, status, looksLikeKey, deleted: !!del?.ok });
    return {
      endpoint: `GET ${path}`,
      status,
      looksLikeKey,
      preview,
      tempOrgDeleted: !!del?.ok,
    };
  }
);
