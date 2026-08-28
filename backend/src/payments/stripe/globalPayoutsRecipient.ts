// Alta de cobro del creador en Stripe Global Payouts.
//
// El creador se da de alta como **destinatario**: no tiene cuenta de Stripe propia como en
// Connect, es un destino de pago. Vibra tiene una sola caja —la cuenta financiera— y desde ahí
// envía transferencias.
//
// El flujo son tres pasos:
//
//   1. Se crea la cuenta de destinatario con las capacidades de pago que se le van a pedir.
//   2. Se genera un enlace alojado por Stripe donde ÉL mete sus datos bancarios.
//   3. Al volver, se lee el estado y se guarda su país, que es el que decidirá su comisión.
//
// ⚠️ ES API v2, distinta de la v1 que usan todos los cobros, y está en VISTA PREVIA: la versión
// va fijada abajo y hay que revisarla cuando Stripe la mueva. No hace falta el SDK de preview
// porque `stripeClient` ya acepta una versión por petición.
//
// ⚠️ El enlace CADUCA A LOS 10 MINUTOS y solo sirve una vez. Por eso se genera al vuelo cada
// vez que el creador pulsa el botón, en lugar de guardarlo.
//
// Detalle y decisiones: `docs/stripe-integracion.md` §8-octies.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { stripeFetch, stripeSecretKey } from "./stripeClient";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();
const REGION = "us-central1";

/** Versión de la API v2 de Global Payouts. 🔁 Vista previa: revisar cuando Stripe la mueva. */
const V2_VERSION = "2026-08-26.preview";

/** Dónde vuelve el creador tras el formulario alojado. */
const BASE_URL = "https://vibraon.com";
const RETURN_URL = `${BASE_URL}/wallet/finanzas?alta=ok`;
const REFRESH_URL = `${BASE_URL}/wallet/finanzas?alta=reintentar`;

type V2Account = {
  id: string;
  identity?: { country?: string };
  configuration?: {
    recipient?: {
      capabilities?: {
        bank_accounts?: {
          local?: { status?: string };
          wire?: { status?: string };
        };
      };
    };
  };
  requirements?: { entries?: unknown[] };
};

type V2AccountLink = { url?: string };

/** Estado del alta, tal como lo lee el panel. */
export type EstadoAlta = "none" | "pending" | "verified" | "restricted";

/**
 * ¿Puede ya recibir pagos?
 *
 * Hace falta que **alguna** capacidad de pago esté activa. Con una basta: hay países donde solo
 * existe transferencia local y otros donde solo hay wire, y exigir las dos dejaría fuera a
 * medio mundo.
 */
function estadoDeCuenta(cuenta: V2Account): EstadoAlta {
  const caps = cuenta.configuration?.recipient?.capabilities?.bank_accounts;
  const activa = caps?.local?.status === "active" || caps?.wire?.status === "active";
  if (activa) return "verified";
  // Con requisitos pendientes está a medias; sin capacidades ni requisitos, ni empezó.
  return (cuenta.requirements?.entries?.length ?? 0) > 0 ? "pending" : "none";
}

/** Guarda lo que sabemos del alta en el perfil fiscal del creador. */
async function guardarEstado(
  uid: string,
  cuenta: V2Account,
  extra: Record<string, unknown> = {}
): Promise<EstadoAlta> {
  const estado = estadoDeCuenta(cuenta);
  const pais = cuenta.identity?.country?.toUpperCase() ?? null;

  await db.collection("creatorTaxProfiles").doc(uid).set(
    {
      creatorId: uid,
      stripeRecipientId: cuenta.id,
      stripeAccountStatus: estado,
      // 🚨 Dato FISCAL, no logístico: decide la comisión, el mínimo de retiro y —si el creador
      // es mexicano— si cobrar fuera de México le sube la retención de IVA al 100%.
      ...(pais ? { payoutAccountCountry: pais, payoutAccountCountryAt: admin.firestore.FieldValue.serverTimestamp() } : {}),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      ...extra,
    },
    { merge: true }
  );

  logger.info("global_payouts_estado", { uid, cuenta: cuenta.id, estado, pais });
  return estado;
}

/**
 * Crea la cuenta de destinatario si no existe y devuelve el enlace del formulario.
 *
 * Se llama cada vez que el creador pulsa el botón: el enlace caduca a los 10 minutos y solo
 * sirve una vez, así que guardarlo no tendría sentido. Lo que sí se guarda es la cuenta.
 */
export const createPayoutAccountLink = onCall(
  { region: REGION, cors: true, secrets: [stripeSecretKey] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");

    const perfilRef = db.collection("creatorTaxProfiles").doc(uid);
    const perfil = (await perfilRef.get()).data() ?? {};
    let cuentaId = String(perfil.stripeRecipientId ?? "").trim();

    // 1) La cuenta de destinatario, solo la primera vez.
    if (!cuentaId) {
      const email = String(request.auth?.token?.email ?? "").trim();
      const res = await stripeFetch<V2Account>("/v2/core/accounts", {
        method: "POST",
        apiVersion: V2_VERSION,
        json: {
          ...(email ? { contact_email: email } : {}),
          configuration: {
            recipient: {
              capabilities: {
                // Se piden las dos: el país del creador decide cuál se activa, y pedir solo
                // una dejaría fuera a los países que no la tienen.
                bank_accounts: { local: { requested: true }, wire: { requested: true } },
              },
            },
          },
          include: ["requirements", "configuration.recipient", "identity"],
        },
      });
      if (!res.ok) {
        logger.error("global_payouts_crear_cuenta_falló", { uid, error: String(res.error).slice(0, 300) });
        throw new HttpsError("internal", "No se pudo iniciar tu alta de cobro. Inténtalo de nuevo.");
      }
      if (!res.data?.id) {
        logger.error("global_payouts_crear_cuenta_sin_id", { uid });
        throw new HttpsError("internal", "No se pudo iniciar tu alta de cobro. Inténtalo de nuevo.");
      }
      cuentaId = res.data.id;
      await guardarEstado(uid, res.data);
    }

    // 2) El enlace del formulario alojado.
    const link = await stripeFetch<V2AccountLink>("/v2/core/account_links", {
      method: "POST",
      apiVersion: V2_VERSION,
      json: {
        account: cuentaId,
        use_case: {
          type: "account_onboarding",
          account_onboarding: {
            configurations: ["recipient"],
            return_url: RETURN_URL,
            refresh_url: REFRESH_URL,
          },
        },
      },
    });
    if (!link.ok) {
      logger.error("global_payouts_enlace_falló", { uid, cuentaId, error: String(link.error).slice(0, 300) });
      throw new HttpsError("internal", "No se pudo abrir el formulario. Inténtalo de nuevo.");
    }
    if (!link.data?.url) {
      logger.error("global_payouts_enlace_sin_url", { uid, cuentaId });
      throw new HttpsError("internal", "No se pudo abrir el formulario. Inténtalo de nuevo.");
    }

    return { url: link.data.url, accountId: cuentaId };
  }
);

/**
 * Relee la cuenta en Stripe y actualiza el estado.
 *
 * Se llama al volver del formulario. El webhook de Stripe para esto es un «thin event» y
 * `stripeWebhook` todavía no los entiende, así que por ahora el estado se refresca cuando el
 * creador vuelve — que es el momento en que le importa verlo.
 */
export const refreshPayoutAccountStatus = onCall(
  { region: REGION, cors: true, secrets: [stripeSecretKey] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");

    const perfil = (await db.collection("creatorTaxProfiles").doc(uid).get()).data() ?? {};
    const cuentaId = String(perfil.stripeRecipientId ?? "").trim();
    if (!cuentaId) return { status: "none" as EstadoAlta, country: null };

    const params = new URLSearchParams();
    params.append("include[0]", "identity");
    params.append("include[1]", "configuration.recipient");
    params.append("include[2]", "requirements");

    const res = await stripeFetch<V2Account>(
      `/v2/core/accounts/${cuentaId}?${params.toString()}`,
      { method: "GET", apiVersion: V2_VERSION }
    );
    if (!res.ok) {
      logger.error("global_payouts_leer_cuenta_falló", { uid, cuentaId, error: String(res.error).slice(0, 300) });
      throw new HttpsError("internal", "No se pudo consultar tu alta de cobro.");
    }
    if (!res.data) {
      logger.error("global_payouts_leer_cuenta_vacía", { uid, cuentaId });
      throw new HttpsError("internal", "No se pudo consultar tu alta de cobro.");
    }

    const estado = await guardarEstado(uid, res.data);
    return { status: estado, country: res.data.identity?.country?.toUpperCase() ?? null };
  }
);
