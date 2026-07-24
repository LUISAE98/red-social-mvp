// payExclusiveSession — cobra una sesión exclusiva con Mercado Pago.
//
// Pagar-luego-crear: la sesión aún NO existe; la compra vive en el paymentIntent
// creado por createExclusiveSessionRequest. Al aprobar el pago, se materializa
// la sesión (reconcile). Función propia por servicio (no genérica); reusa el
// helper de cobro común para no duplicar la lógica de dinero.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { mpAccessToken } from "./mpClient";
import { chargeServiceIntent } from "./serviceCharge";

const REGION = "us-central1";

export const payExclusiveSession = onCall(
  { region: REGION, secrets: [mpAccessToken], cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");

    const data = (request.data ?? {}) as Record<string, unknown>;
    const requestId = String(data.requestId ?? "").trim();
    if (!requestId) {
      throw new HttpsError("invalid-argument", "Falta el id de la solicitud.");
    }

    return chargeServiceIntent(`exclusiveSessionRequest__${requestId}`, uid, {
      token: String(data.token ?? "").trim(),
      paymentMethodId: String(data.paymentMethodId ?? "").trim(),
      paymentType: String(data.paymentType ?? "credit_card").trim(),
      installments: Number(data.installments),
      payerEmail: String(data.payerEmail ?? request.auth?.token?.email ?? "").trim(),
      saveToken: data.saveToken ? String(data.saveToken).trim() : undefined,
      savedCardId: data.savedCardId ? String(data.savedCardId).trim() : undefined,
    });
  }
);
