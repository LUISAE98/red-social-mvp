// payGreeting — cobra un saludo/consejo con Mercado Pago.
//
// Pagar-luego-crear: el saludo aún NO existe; la compra vive en el paymentIntent
// creado por createGreetingRequest. Al aprobar el pago, se materializa el saludo
// (reconcile). Reusa el helper de cobro común (`chargeServiceIntent`), que
// soporta tarjeta nueva (con guardado opcional) y tarjeta guardada.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { mpAccessToken } from "./mpClient";
import { chargeServiceIntent } from "./serviceCharge";

const REGION = "us-central1";

export const payGreeting = onCall(
  { region: REGION, secrets: [mpAccessToken], cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");

    const data = (request.data ?? {}) as Record<string, unknown>;
    const requestId = String(data.greetingRequestId ?? "").trim();
    if (!requestId) {
      throw new HttpsError("invalid-argument", "Falta el id de la solicitud.");
    }

    return chargeServiceIntent(`greetingRequest__${requestId}`, uid, {
      token: String(data.token ?? "").trim(),
      paymentMethodId: String(data.paymentMethodId ?? "").trim(),
      paymentType: String(data.paymentType ?? "credit_card").trim(),
      installments: Number(data.installments),
      payerEmail: String(data.payerEmail ?? request.auth?.token?.email ?? "").trim(),
      saveToken: data.saveToken ? String(data.saveToken).trim() : undefined,
      savedCardId: data.savedCardId ? String(data.savedCardId).trim() : undefined,
      // 🧾 IVA — país fiscal del comprador (por IP en el cliente); el backend suma el IVA.
      taxCountry: data.taxCountry ? String(data.taxCountry).trim().toUpperCase() : null,
    });
  }
);
