// payMeetGreet — cobra un "Tiempo contigo" (meet & greet) con Mercado Pago.
//
// Pagar-luego-crear: la solicitud aún NO existe; la compra vive en el
// paymentIntent creado por createMeetGreetRequest. Al aprobar el pago, se
// materializa la solicitud (reconcile). Función propia por servicio; reusa el
// helper de cobro común para no duplicar la lógica de dinero.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { mpAccessToken } from "./mpClient";
import { chargeServiceIntent } from "./serviceCharge";

const REGION = "us-central1";

export const payMeetGreet = onCall(
  { region: REGION, secrets: [mpAccessToken], cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");

    const data = (request.data ?? {}) as Record<string, unknown>;
    const requestId = String(data.requestId ?? "").trim();
    if (!requestId) {
      throw new HttpsError("invalid-argument", "Falta el id de la solicitud.");
    }

    return chargeServiceIntent(`meetGreetRequest__${requestId}`, uid, {
      token: String(data.token ?? "").trim(),
      paymentMethodId: String(data.paymentMethodId ?? "").trim(),
      paymentType: String(data.paymentType ?? "credit_card").trim(),
      installments: Number(data.installments),
      payerEmail: String(data.payerEmail ?? request.auth?.token?.email ?? "").trim(),
    });
  }
);
