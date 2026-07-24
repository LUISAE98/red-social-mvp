// mpHealthcheck — smoke test del riel de dinero (Bloque 1).
//
// Verifica que las credenciales de Mercado Pago en Secrets sirven de verdad,
// haciendo UNA llamada real a la API (`GET /users/me`). No mueve dinero.
//
// Sirve para de-riesgar las credenciales ANTES de construir el cobro encima:
// confirma que el token es válido y en qué modo (prueba/producción) opera, y
// que la cuenta es de México (site_id MLM → cobros en MXN).
//
// Gate: solo un moderador de plataforma (mismo claim que el panel admin/retiros).

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { mpAccessToken, mpFetch } from "./mpClient";

const REGION = "us-central1";

type MpUserMe = {
  id?: number;
  nickname?: string;
  site_id?: string;
  // MP no expone un flag "test" directo; el modo se infiere del tipo de credencial.
  // Devolvemos lo relevante para verificar país/moneda y que el token responde.
};

export const mpHealthcheck = onCall(
  {
    region: REGION,
    secrets: [mpAccessToken],
  },
  async (request) => {
    // Solo plataforma. El owner necesita este claim también para el panel de
    // retiros (Bloque 5), así que es consistente exigirlo aquí.
    if (request.auth?.token?.role !== "moderator") {
      throw new HttpsError("permission-denied", "Solo un moderador puede ejecutar esto.");
    }

    const res = await mpFetch<MpUserMe>("/users/me");
    if (!res.ok) {
      logger.error("mpHealthcheck failed", { status: res.status });
      throw new HttpsError(
        "internal",
        `Mercado Pago respondió ${res.status}. Revisa MP_ACCESS_TOKEN.`
      );
    }

    const { id, nickname, site_id } = res.data;
    logger.info("mpHealthcheck ok", { id, site_id });

    return {
      ok: true,
      accountId: id ?? null,
      nickname: nickname ?? null,
      siteId: site_id ?? null,
      // MLM = México. Si sale otro, las credenciales no son de la cuenta correcta.
      isMexico: site_id === "MLM",
    };
  }
);
