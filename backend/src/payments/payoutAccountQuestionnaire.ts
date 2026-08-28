// Declaración de la cuenta de cobro del creador, con un cuestionario de Didit.
//
// Es el paso 2 del alta, y tiene dos versiones según por dónde cobre:
//
//   · Ruta STRIPE  → declara la cuenta que va a dar de alta en Stripe. Sirve para dos cosas:
//     dejar constancia de que él afirma ser el titular, y poder comparar contra lo que Stripe
//     acabe reportando.
//   · Ruta WALLBIT → declara los datos de su cuenta de Wallbit. Ahí no hay alta de Stripe que
//     hacer, así que este cuestionario ES su registro de cobro.
//
// ── Por qué una sesión aparte y no un paso del KYC ──────────────────────────────────────
//
// Porque el creador de Wallbit **todavía no tiene cuenta de Wallbit** cuando hace el KYC.
// Pedírsela ahí sería pedirle algo que no tiene: se saldría a abrirla y la sesión ya habría
// pasado. Con una sesión propia la abre cuando quiere, y si mañana cambia de cuenta repite solo
// este paso en vez de rehacer su verificación de identidad entera.
//
// ── Qué se guarda y qué no ──────────────────────────────────────────────────────────────
//
// 🚨 **La cuenta completa NO se guarda en Firestore.** Vive en Didit, igual que el sello del
// SAT vive en Facturapi. Aquí solo quedan los **últimos 4 dígitos** —lo justo para comparar—,
// el nombre declarado y la fecha. Un IBAN o una CLABE completos en la base son un problema de
// protección de datos que no hace falta tener.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { defineSecret } from "firebase-functions/params";

/**
 * La misma clave de Didit que usa el KYC.
 *
 * ⚠️ Se declara aquí en vez de importarla de `kyc.ts` PARA ROMPER UN CICLO: `kyc.ts` importa
 * de este módulo para desviar los webhooks de cuestionario, así que importar de vuelta dejaba
 * los dos módulos a medio cargar y el analizador de Firebase fallaba con un error que no
 * señalaba a ninguna línea.
 *
 * `defineSecret` va por NOMBRE, así que declararlo dos veces apunta al mismo secreto.
 */
const diditApiKey = defineSecret("DIDIT_API_KEY");
import { payoutTermsOf, resolvePayoutCountry } from "../wallet/payoutTiers";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();
const REGION = "us-central1";
const DIDIT_API_BASE = "https://verification.didit.me";

/**
 * Los workflows que solo llevan el cuestionario.
 *
 * No son secretos —son identificadores de configuración, como el id de un precio de Stripe— así
 * que van en el código y no en Secret Manager. Se crearon el 2026-08-28 en la aplicación de
 * producción de Didit y llevan un único paso, sin OCR ni biometría: el creador ya está
 * identificado por su KYC y repetirlo costaría dinero por nada.
 */
const WORKFLOW_STRIPE = "e44a6d40-2915-48c7-8fdc-9056601382cb";
const WORKFLOW_WALLBIT = "46336699-9172-4bb0-b0d3-e8252b7ae6ba";

/** Para que el webhook sepa que una sesión es de esto y no un KYC. */
export const WORKFLOWS_CUENTA_DE_COBRO = [WORKFLOW_STRIPE, WORKFLOW_WALLBIT];

/** ¿Esta sesión de Didit es una declaración de cuenta y no una verificación de identidad? */
export function esSesionDeCuentaDeCobro(workflowId: unknown): boolean {
  return typeof workflowId === "string" && WORKFLOWS_CUENTA_DE_COBRO.includes(workflowId);
}

/**
 * A dónde vuelve el creador al terminar.
 *
 * 🚨 Lista blanca, no lo que mande el cliente: aceptar una URL cualquiera sería una
 * redirección abierta. Misma regla que en el alta de Stripe.
 */
function buildCallback(origin: unknown, locale: unknown): string {
  const safeLocale =
    typeof locale === "string" && /^[a-zA-Z-]{2,5}$/.test(locale) ? locale : "es";
  let base = "https://vibraon.com";
  if (typeof origin === "string") {
    try {
      const u = new URL(origin);
      const host = u.hostname;
      const isLocal = host === "localhost" || host === "127.0.0.1";
      const isBrand = host === "vibraon.com" || host.endsWith(".vibraon.com");
      if (isLocal || (u.protocol === "https:" && isBrand)) base = u.origin;
    } catch {
      // origin inválido → se queda el dominio oficial
    }
  }
  return `${base}/${safeLocale}/wallet/finanzas?cuenta=ok`;
}

/**
 * Abre el cuestionario que le toca al creador según su ruta de pago.
 *
 * El país sale de su cuenta de cobro si ya la tiene, y si no del documento de su KYC — el mismo
 * orden que en el alta de Stripe, porque el dato duro de a dónde va el dinero manda sobre el de
 * dónde es la persona.
 */
export const createPayoutAccountQuestionnaire = onCall(
  { region: REGION, cors: true, secrets: [diditApiKey] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");

    const perfil = (await db.collection("creatorTaxProfiles").doc(uid).get()).data() ?? {};
    const kyc = (await db.collection("kyc").doc(uid).get()).data() ?? {};

    // Sin identidad verificada no tiene sentido recoger datos de cobro: no sabríamos de quién
    // son. Y además es de ahí de donde sale su país.
    if (kyc.kycApproved !== true) {
      throw new HttpsError("failed-precondition", "Primero verifica tu identidad.");
    }

    const pais = resolvePayoutCountry(
      (typeof perfil.payoutAccountCountry === "string" ? perfil.payoutAccountCountry : null) ??
        (typeof kyc.documentCountry === "string" ? kyc.documentCountry : null)
    );
    const condiciones = payoutTermsOf(pais);
    if (!condiciones) {
      throw new HttpsError(
        "failed-precondition",
        "Todavía no podemos enviar dinero a tu país. Te avisamos en cuanto se pueda."
      );
    }

    const workflow = condiciones.route === "wallbit" ? WORKFLOW_WALLBIT : WORKFLOW_STRIPE;
    const { locale, origin } = (request.data ?? {}) as { locale?: unknown; origin?: unknown };
    // Didit espera ISO 639-1: "pt-BR" → "pt".
    const language = typeof locale === "string" ? locale.slice(0, 2).toLowerCase() : "es";

    let session: { session_id?: string; url?: string };
    try {
      const res = await fetch(`${DIDIT_API_BASE}/v3/session/`, {
        method: "POST",
        headers: {
          "x-api-key": diditApiKey.value().trim(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workflow_id: workflow,
          vendor_data: uid,
          callback: buildCallback(origin, locale),
          language,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        logger.error("cuenta_cobro_didit_error", { uid, status: res.status, text: text.slice(0, 300) });
        throw new HttpsError("internal", "No se pudo abrir el formulario. Inténtalo de nuevo.");
      }
      session = (await res.json()) as { session_id?: string; url?: string };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      logger.error("cuenta_cobro_fetch_falló", {
        uid,
        err: err instanceof Error ? err.message : String(err),
      });
      throw new HttpsError("internal", "No se pudo abrir el formulario. Inténtalo de nuevo.");
    }

    if (!session.session_id || !session.url) {
      logger.error("cuenta_cobro_respuesta_inválida", { uid, session });
      throw new HttpsError("internal", "No se pudo abrir el formulario. Inténtalo de nuevo.");
    }

    await db.collection("creatorTaxProfiles").doc(uid).set(
      {
        creatorId: uid,
        payoutAccountSessionId: session.session_id,
        payoutAccountRoute: condiciones.route,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    logger.info("cuenta_cobro_sesion_creada", { uid, ruta: condiciones.route, pais });
    return { url: session.url, route: condiciones.route };
  }
);

/** Una respuesta del cuestionario, tal como la devuelve Didit. */
type Respuesta = { value?: unknown; element_type?: string; title?: unknown };

/**
 * Saca de las respuestas lo poco que se guarda.
 *
 * Se identifica cada campo por su POSICIÓN en el cuestionario, no por su texto: el texto está
 * traducido a seis idiomas y cambiaría con cada retoque de copy. Los dos cuestionarios acaban
 * igual —titular, cuenta y consentimiento— aunque el de Wallbit tenga un campo más en medio.
 */
export function extraerDatosDeclarados(respuestas: unknown): {
  holderName: string | null;
  accountLast4: string | null;
} {
  const lista = Array.isArray(respuestas) ? (respuestas as Respuesta[]) : [];
  const textos = lista
    .filter((r) => r?.element_type === "SHORT_TEXT")
    .map((r) => (typeof r.value === "string" ? r.value.trim() : ""));

  // El primer texto es siempre el nombre del titular; el de la cuenta es el último, que en el
  // de Stripe es el tercero y en el de Wallbit el cuarto.
  const holderName = textos[0] || null;
  const cuenta = (textos[textos.length - 1] || "").replace(/\D/g, "");
  const accountLast4 = cuenta.length >= 4 ? cuenta.slice(-4) : null;

  return { holderName, accountLast4 };
}

/**
 * Guarda la declaración del creador y la compara con lo que Stripe reporta.
 *
 * ⚠️ La comparación es una SEÑAL, no una prueba. Detecta que metió en Stripe una cuenta distinta
 * a la que declaró —o que se equivocó al teclear—, pero no que la cuenta sea suya: quien declare
 * la misma cuenta ajena en los dos sitios pasa el control sin problema.
 *
 * Lo que sí queda es una **declaración formal de titularidad** hecha por una persona con
 * identidad verificada. Eso no previene el fraude, lo hace atribuible.
 *
 * 🔁 La verificación de verdad es Financial Connections, donde el creador entra a su banca en
 * línea y Stripe lee la cuenta. Está en vista previa (`financial_connections_payouts_preview`).
 */
export async function guardarCuentaDeclarada(
  uid: string,
  respuestas: unknown
): Promise<void> {
  const { holderName, accountLast4 } = extraerDatosDeclarados(respuestas);

  const ref = db.collection("creatorTaxProfiles").doc(uid);
  const perfil = (await ref.get()).data() ?? {};
  const stripeLast4 =
    typeof perfil.stripeAccountLast4 === "string" ? perfil.stripeAccountLast4 : null;

  // Solo se compara cuando hay las dos mitades; que falte una no es una discrepancia.
  const coincide =
    accountLast4 && stripeLast4 ? accountLast4 === stripeLast4 : null;

  await ref.set(
    {
      creatorId: uid,
      // 🚨 Solo los últimos 4. La cuenta completa se queda en Didit.
      declaredAccountLast4: accountLast4,
      declaredHolderName: holderName,
      declaredAccountAt: admin.firestore.FieldValue.serverTimestamp(),
      payoutAccountDeclared: true,
      ...(coincide === null ? {} : { declaredAccountMatchesStripe: coincide }),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  if (coincide === false) {
    // Se registra fuerte a propósito: es el caso que alguien tiene que mirar.
    logger.error("cuenta_declarada_no_coincide", { uid, declarado: accountLast4, stripe: stripeLast4 });
  } else {
    logger.info("cuenta_declarada_guardada", { uid, coincide });
  }
}
