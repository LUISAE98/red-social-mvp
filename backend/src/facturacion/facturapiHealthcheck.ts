// facturapiHealthcheck — smoke test de Facturapi (Bloque 0).
//
// Verifica que las credenciales de Facturapi en Secrets sirven de verdad, con dos
// llamadas reales que NO emiten ningún CFDI:
//   1. USER key  → GET /organizations  (confirma la cuenta y el multi-tenant que
//      necesitamos para las organizaciones de los creadores).
//   2. SECRET key → GET /customers?limit=1 (confirma la llave de la org de Vibra).
//
// Sirve para de-riesgar las credenciales ANTES de construir el timbrado encima.
//
// Gate: solo un moderador de plataforma (mismo claim que el panel admin/retiros).

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import {
  facturapiFetch,
  facturapiTestKey,
  facturapiUserKey,
  isFacturapiTestMode,
} from "./facturapiClient";

const REGION = "us-central1";

// Los list endpoints de Facturapi devuelven { total_results, data, ... }.
type FacturapiList = { total_results?: number; data?: unknown[] };

export const facturapiHealthcheck = onCall(
  {
    region: REGION,
    secrets: [facturapiTestKey, facturapiUserKey],
  },
  async (request) => {
    if (request.auth?.token?.role !== "moderator") {
      throw new HttpsError("permission-denied", "Solo un moderador puede ejecutar esto.");
    }

    // 1. Multi-tenant: lista de organizaciones (llave de usuario).
    const orgs = await facturapiFetch<FacturapiList>("/organizations", { auth: "user" });
    // 2. Org de Vibra: una lectura simple (secret key de la org).
    const customers = await facturapiFetch<FacturapiList>("/customers?limit=1", { auth: "secret" });

    const userKeyOk = orgs.ok;
    const secretKeyOk = customers.ok;
    const organizationCount = orgs.ok
      ? orgs.data.total_results ?? orgs.data.data?.length ?? 0
      : null;

    logger.info("facturapiHealthcheck", {
      userKeyOk,
      secretKeyOk,
      organizationCount,
      mode: isFacturapiTestMode() ? "test" : "live",
    });

    if (!userKeyOk && !secretKeyOk) {
      throw new HttpsError(
        "internal",
        `Facturapi no respondió. USER=${orgs.status}, SECRET=${customers.status}. Revisa FACTURAPI_USER_KEY / FACTURAPI_TEST_KEY.`
      );
    }

    return {
      ok: userKeyOk && secretKeyOk,
      mode: isFacturapiTestMode() ? "test" : "live",
      userKeyOk,
      secretKeyOk,
      organizationCount,
      // Detalle de error por llave (para diagnosticar cuál falta configurar).
      userKeyError: userKeyOk ? null : orgs.error.slice(0, 200),
      secretKeyError: secretKeyOk ? null : customers.error.slice(0, 200),
    };
  }
);
