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
import { stripeFetch, stripeSecretKey, stripePayoutsSecretKey } from "./stripeClient";
import { payoutTermsOf, resolvePayoutCountry } from "../../wallet/payoutTiers";
import { resolverPaisDocumento, diditApiKey } from "../../kyc";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();
const REGION = "us-central1";

/** Versión de la API v2 de Global Payouts. 🔁 Vista previa: revisar cuando Stripe la mueva. */
const V2_VERSION = "2026-08-26.preview";

/**
 * Dónde puede volver el creador tras el formulario alojado.
 *
 * 🚨 **Lista blanca, no lo que mande el cliente.** El origen viaja en la petición para poder
 * probar desde local, pero se comprueba contra esta lista antes de usarlo. Aceptar una URL
 * arbitraria sería una redirección abierta con la firma de Stripe encima.
 */
const ORIGENES_PERMITIDOS = [
  "https://vibraon.com",
  "https://www.vibraon.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

const ORIGEN_POR_DEFECTO = "https://vibraon.com";

/**
 * Los idiomas de la plataforma. Se valida el que llega porque acaba dentro de una URL.
 *
 * ⚠️ Sin idioma, el enlace caía en `/wallet/finanzas` y el middleware lo mandaba al idioma
 * por defecto —inglés—: un creador mexicano terminaba su alta y volvía a una pantalla en un
 * idioma que no eligió.
 */
const LOCALE_VALIDO = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;

/** Arma las dos URLs de vuelta, quedándose solo con lo que se reconoce. */
function urlsDeVuelta(origen: unknown, locale: unknown): { retorno: string; reintento: string } {
  const o = typeof origen === "string" ? origen.trim().replace(/\/$/, "") : "";
  const base = ORIGENES_PERMITIDOS.includes(o) ? o : ORIGEN_POR_DEFECTO;
  const l = typeof locale === "string" && LOCALE_VALIDO.test(locale.trim()) ? locale.trim() : "es";
  return {
    retorno: `${base}/${l}/wallet/finanzas?alta=ok`,
    reintento: `${base}/${l}/wallet/finanzas?alta=reintentar`,
  };
}

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

type V2PayoutMethod = {
  id?: string;
  bank_account?: { last4?: string; bank_name?: string; country?: string };
};

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
  { region: REGION, cors: true, secrets: [stripeSecretKey, stripePayoutsSecretKey, diditApiKey] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");

    // De dónde salió y en qué idioma, para devolverlo al mismo sitio. Ambos se validan.
    const { retorno, reintento } = urlsDeVuelta(
      (request.data as { origin?: unknown } | undefined)?.origin,
      (request.data as { locale?: unknown } | undefined)?.locale
    );

    const perfilRef = db.collection("creatorTaxProfiles").doc(uid);
    const perfil = (await perfilRef.get()).data() ?? {};
    let cuentaId = String(perfil.stripeRecipientId ?? "").trim();

    /**
     * 🌎 EL PAÍS, que Stripe exige antes que nada.
     *
     * «The field identity.country is required before setting configuration.recipient». Sale
     * del documento del KYC, no se le pregunta: es el dato duro de dónde es la persona, y
     * mandar uno equivocado significa una cuenta que nunca se va a poder verificar.
     *
     * Esto impone el orden del alta —identidad primero, cuenta después— y está bien que así
     * sea: pedirle datos bancarios a alguien de quien no sabemos quién es, no tiene sentido.
     */
    // `resolverPaisDocumento` se cura sola: si el país no está guardado pero el KYC está
    // aprobado, va a preguntárselo a Didit y lo escribe. Así un creador verificado antes de
    // que el extractor funcionara se arregla al pulsar este botón, sin backfill.
    const paisCrudo = (await resolverPaisDocumento(uid)) ?? perfil.payoutAccountCountry;
    const pais = resolvePayoutCountry(typeof paisCrudo === "string" ? paisCrudo : null);

    if (!pais) {
      throw new HttpsError(
        "failed-precondition",
        "Primero verifica tu identidad. De ahí sacamos tu país."
      );
    }

    /**
     * ⚠️ Y que ese país cobre POR STRIPE.
     *
     * Sin esta comprobación, a un creador de ruta Wallbit —o de un país sin ruta— se le
     * crearía una cuenta que Stripe no puede verificar nunca, y se quedaría esperando en una
     * pantalla que no avanza. Mejor decirle la verdad aquí.
     */
    const condiciones = payoutTermsOf(pais);
    if (condiciones?.route !== "stripe") {
      logger.warn("global_payouts_pais_sin_ruta_stripe", { uid, pais, ruta: condiciones?.route ?? null });
      throw new HttpsError(
        "failed-precondition",
        "Tu país no cobra por esta vía. Escríbenos y te decimos cómo pagarte."
      );
    }

    // 1) La cuenta de destinatario, solo la primera vez.
    if (!cuentaId) {
      const email = String(request.auth?.token?.email ?? "").trim();
      const res = await stripeFetch<V2Account>("/v2/core/accounts", {
        method: "POST",
        apiVersion: V2_VERSION,
        usePayoutsKey: true,
        json: {
          // Obligatorio y primero: sin país, Stripe rechaza toda la petición.
          identity: { country: pais, entity_type: "individual" },
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
      usePayoutsKey: true,
      json: {
        account: cuentaId,
        use_case: {
          type: "account_onboarding",
          account_onboarding: {
            configurations: ["recipient"],
            return_url: retorno,
            refresh_url: reintento,
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
  { region: REGION, cors: true, secrets: [stripeSecretKey, stripePayoutsSecretKey] },
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
      { method: "GET", apiVersion: V2_VERSION, usePayoutsKey: true }
    );
    if (!res.ok) {
      logger.error("global_payouts_leer_cuenta_falló", { uid, cuentaId, error: String(res.error).slice(0, 300) });
      throw new HttpsError("internal", "No se pudo consultar tu alta de cobro.");
    }
    if (!res.data) {
      logger.error("global_payouts_leer_cuenta_vacía", { uid, cuentaId });
      throw new HttpsError("internal", "No se pudo consultar tu alta de cobro.");
    }

    /**
     * 🔍 Los últimos 4 dígitos de la cuenta que de verdad metió.
     *
     * Es lo ÚNICO comparable: Stripe no devuelve la cuenta completa ni —fuera del Reino
     * Unido— el nombre del titular. Con esto se puede contrastar contra lo que el creador
     * declaró en el cuestionario de Didit y detectar que metió una cuenta distinta.
     *
     * ⚠️ Detecta un cambio o un error de tecleo, NO que la cuenta sea suya. Para eso hace
     * falta Financial Connections, que sigue en vista previa.
     */
    const metodos = await stripeFetch<{ data?: V2PayoutMethod[] }>(
      "/v2/money_management/payout_methods",
      { method: "GET", apiVersion: V2_VERSION, usePayoutsKey: true, stripeAccount: cuentaId }
    );
    const cuenta = metodos.ok ? metodos.data?.data?.[0]?.bank_account : undefined;

    const estado = await guardarEstado(uid, res.data, {
      ...(cuenta?.last4 ? { stripeAccountLast4: cuenta.last4 } : {}),
      ...(cuenta?.bank_name ? { stripeAccountBank: cuenta.bank_name } : {}),
    });
    return { status: estado, country: res.data.identity?.country?.toUpperCase() ?? null };
  }
);
