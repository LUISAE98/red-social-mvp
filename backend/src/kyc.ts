// Cloud Functions: KYC con Didit
//
// Flujo:
//  1. createKycSession (onCall): el creador toca "Verifícate para retirar".
//     Crea una sesión hosted en Didit y devuelve la URL a la que redirigir.
//  2. diditWebhook (onRequest): Didit notifica el resultado. Verificamos la
//     firma HMAC, mapeamos el estado y actualizamos kyc/{uid}.
//
// El KYC se hace UNA sola vez: cuando queda `approved`, la bandera `kycApproved`
// queda permanente y el flujo de retiro (futuro) solo la consulta.
//
// PII: los documentos de identidad los custodia Didit. Aquí NO guardamos PII,
// solo el estado de verificación.

import * as crypto from "crypto";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import {
  esSesionDeCuentaDeCobro,
  guardarCuentaDeclarada,
} from "./payments/payoutAccountQuestionnaire";
import { defineSecret } from "firebase-functions/params";
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { checkAndRecord } from "./rateLimiter";
import { notifyKycStatus } from "./notifications";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const REGION = "us-central1";

// Base URL de la API de verificación de Didit (v3).
const DIDIT_API_BASE = "https://verification.didit.me";

export const diditApiKey = defineSecret("DIDIT_API_KEY");
export const diditWebhookSecret = defineSecret("DIDIT_WEBHOOK_SECRET");
export const diditWorkflowId = defineSecret("DIDIT_WORKFLOW_ID");

// Nuestro modelo de estado (independiente de las cadenas exactas de Didit).
type KycStatus = "not_started" | "pending" | "in_review" | "approved" | "declined";

type DiditWebhookPayload = {
  event_id?: string;
  webhook_type?: string;
  session_id?: string;
  status?: string;
  vendor_data?: string; // nuestro uid
  workflow_id?: string;
  decision?: unknown;
  /** Didit marca así los envíos del botón "Probar Webhook" de su panel. */
  metadata?: { test_webhook?: boolean } | null;
};

// Mapea la cadena de estado de Didit → nuestro modelo.
// Estados Didit: Not Started, In Progress, Approved, Declined, In Review,
// Awaiting User, Resubmitted, Expired, Abandoned, Kyc Expired.
function mapDiditStatus(status: string): { status: KycStatus; approved: boolean } {
  switch (status) {
    case "Approved":
      return { status: "approved", approved: true };
    case "Declined":
      return { status: "declined", approved: false };
    case "In Review":
      return { status: "in_review", approved: false };
    case "In Progress":
    case "Not Started":
    case "Awaiting User":
    case "Resubmitted":
      return { status: "pending", approved: false };
    // Sesión sin completar o caducada → el usuario puede reintentar desde cero.
    case "Expired":
    case "Abandoned":
    case "Kyc Expired":
      return { status: "not_started", approved: false };
    default:
      return { status: "pending", approved: false };
  }
}

// Construye la URL de retorno a la que Didit devuelve al usuario tras verificar.
// Didit le añade ?verificationSessionId={id}&status={status}. El resultado real
// llega por webhook, así que esta URL solo controla a dónde vuelve el navegador.
// Solo aceptamos el origin del cliente si es localhost o *.vibraon.com; si no,
// caemos al dominio oficial para evitar redirects abiertos.
function buildCallback(origin: unknown, locale: unknown): string {
  const safeLocale =
    typeof locale === "string" && /^[a-zA-Z-]{2,5}$/.test(locale) ? locale : "en";
  let base = "https://vibraon.com";
  if (typeof origin === "string") {
    try {
      const u = new URL(origin);
      const host = u.hostname;
      const isLocal = host === "localhost" || host === "127.0.0.1";
      const isBrand = host === "vibraon.com" || host.endsWith(".vibraon.com");
      if (isLocal || (u.protocol === "https:" && isBrand)) {
        base = u.origin;
      }
    } catch {
      // origin inválido → usamos el dominio oficial
    }
  }
  return `${base}/${safeLocale}/wallet/finanzas`;
}

// ────────────────────────────────────────────────────────────────────────────
// createKycSession — inicia la verificación del creador autenticado.
// ────────────────────────────────────────────────────────────────────────────
export const createKycSession = onCall(
  {
    region: REGION,
    secrets: [diditApiKey, diditWorkflowId],
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
    }

    const kycRef = db.collection("kyc").doc(uid);
    const snap = await kycRef.get();
    const existing = snap.data();

    // KYC es una sola vez: si ya está aprobado, no creamos otra sesión.
    if (existing?.status === "approved") {
      return { alreadyApproved: true, url: null };
    }

    // Rate limit: evita creación masiva de sesiones (cada sesión tiene costo).
    await checkAndRecord(uid, "kyc");

    const { locale, origin } = (request.data ?? {}) as {
      locale?: unknown;
      origin?: unknown;
    };
    const callback = buildCallback(origin, locale);
    // Didit espera ISO 639-1 (ej. "es", "en", "pt"). Recortamos "pt-BR" → "pt".
    const language = typeof locale === "string" ? locale.slice(0, 2).toLowerCase() : "en";

    let session: { session_id?: string; url?: string; status?: string };
    try {
      const res = await fetch(`${DIDIT_API_BASE}/v3/session/`, {
        method: "POST",
        headers: {
          "x-api-key": diditApiKey.value().trim(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workflow_id: diditWorkflowId.value().trim(),
          vendor_data: uid,
          callback,
          language,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        logger.error("createKycSession didit_error", { uid, status: res.status, text });
        throw new HttpsError("internal", "No se pudo iniciar la verificación.");
      }

      session = (await res.json()) as { session_id?: string; url?: string; status?: string };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      logger.error("createKycSession fetch_failed", {
        uid,
        err: err instanceof Error ? err.message : String(err),
      });
      throw new HttpsError("internal", "No se pudo iniciar la verificación.");
    }

    if (!session.session_id || !session.url) {
      logger.error("createKycSession invalid_response", { uid, session });
      throw new HttpsError("internal", "Respuesta inválida del proveedor de KYC.");
    }

    await kycRef.set(
      {
        status: "pending" as KycStatus,
        kycApproved: false,
        diditSessionId: session.session_id,
        reason: null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    logger.info("createKycSession created", { uid, sessionId: session.session_id });
    return { alreadyApproved: false, url: session.url };
  }
);

// ────────────────────────────────────────────────────────────────────────────
// Verificación de firma del webhook (X-Signature = HMAC-SHA256 del body crudo).
// ────────────────────────────────────────────────────────────────────────────
function verifyDiditSignature(
  rawBody: string,
  signature: string | undefined,
  timestamp: string | undefined,
  secret: string
): boolean {
  if (!signature || !timestamp) return false;

  const ts = parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) return false;
  // Rechaza eventos con más de 5 minutos (anti-replay).
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > 300) return false;

  const expected = crypto
    .createHmac("sha256", secret.trim())
    .update(rawBody, "utf8")
    .digest("hex");

  try {
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(signature, "utf8");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// Features del objeto decision que traen warnings con el motivo (risk).
const WARNING_FEATURE_KEYS = [
  "id_verifications",
  "liveness_checks",
  "face_matches",
  "aml_screenings",
  "poa_verifications",
  "ip_analyses",
  "phone_verifications",
  "email_verifications",
  "database_validations",
];

// Extrae un código de motivo (risk) de los warnings del payload o la decisión.
// Prefiere un warning "de peso" (log_type != information) como causa del rechazo.
function extractDeclineReason(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const sources: unknown[] = [root];
  if (root.decision) sources.push(root.decision);

  const collected: { risk: string; info: boolean }[] = [];
  for (const src of sources) {
    if (!src || typeof src !== "object") continue;
    const obj = src as Record<string, unknown>;
    for (const key of WARNING_FEATURE_KEYS) {
      const arr = obj[key];
      if (!Array.isArray(arr)) continue;
      for (const item of arr) {
        const warnings = (item as Record<string, unknown> | null)?.warnings;
        if (!Array.isArray(warnings)) continue;
        for (const w of warnings) {
          const ww = w as Record<string, unknown>;
          if (typeof ww.risk === "string" && ww.risk) {
            const logType = typeof ww.log_type === "string" ? ww.log_type : "";
            collected.push({ risk: ww.risk, info: logType === "information" });
          }
        }
      }
    }
    if (typeof obj.last_warning === "string" && obj.last_warning) {
      collected.push({ risk: obj.last_warning, info: false });
    }
  }
  if (!collected.length) return null;
  const severe = collected.find((c) => !c.info);
  return (severe ?? collected[0]).risk;
}

// Si el webhook no trae la decisión, la consultamos por API (fuente autoritativa).
async function fetchDeclineReason(sessionId: string | undefined): Promise<string | null> {
  if (!sessionId) return null;
  try {
    const res = await fetch(`${DIDIT_API_BASE}/v3/session/${sessionId}/decision/`, {
      headers: { "x-api-key": diditApiKey.value().trim() },
    });
    if (!res.ok) return null;
    const decision = (await res.json()) as unknown;
    return extractDeclineReason(decision);
  } catch {
    return null;
  }
}

/**
 * País del DOCUMENTO con el que se verificó.
 *
 * Es el dato que decide si al creador se le piden datos fiscales y sello: quien debe facturar
 * en México es quien tributa ahí, y su documento es la señal más dura que tenemos. Antes se le
 * preguntaba —«¿dónde declaras impuestos?»— y una respuesta se puede equivocar; un pasaporte no.
 *
 * ⚠️ NO ES PII. Se guarda un código de país de dos letras, no el documento ni su número. Los
 * documentos siguen viviendo solo en Didit.
 *
 * Didit publica el país en ISO de tres letras (MEX) y en distintos sitios según la versión del
 * payload, así que se buscan varias rutas y se normaliza a dos letras, que es lo que usa el
 * resto del sistema.
 */
const ISO3_A_ISO2: Record<string, string> = {
  // América
  MEX: "MX", USA: "US", CAN: "CA", ARG: "AR", BRA: "BR", CHL: "CL", COL: "CO",
  PER: "PE", URY: "UY", ECU: "EC", PRY: "PY", BOL: "BO", CRI: "CR", DOM: "DO",
  SLV: "SV", GTM: "GT", HND: "HN", NIC: "NI", PAN: "PA", TTO: "TT", JAM: "JM",
  LCA: "LC", ATG: "AG", PRI: "PR", VIR: "VI", HTI: "HT", BLZ: "BZ", SUR: "SR",
  GUF: "GF", GRD: "GD", CYM: "KY", BMU: "BM", TCA: "TC", VGB: "VG", BES: "BQ",
  VCT: "VC", KNA: "KN", DMA: "DM", AIA: "AI", MSR: "MS", GLP: "GP", MTQ: "MQ",
  SPM: "PM", GRL: "GL",
  // Europa
  ESP: "ES", PRT: "PT", FRA: "FR", DEU: "DE", ITA: "IT", GBR: "GB", IRL: "IE",
  NLD: "NL", BEL: "BE", LUX: "LU", AUT: "AT", CHE: "CH", POL: "PL", CZE: "CZ",
  SVK: "SK", HUN: "HU", ROU: "RO", BGR: "BG", GRC: "GR", HRV: "HR", SVN: "SI",
  EST: "EE", LVA: "LV", LTU: "LT", FIN: "FI", SWE: "SE", DNK: "DK", NOR: "NO",
  ISL: "IS", MLT: "MT", CYP: "CY", MCO: "MC", SMR: "SM", AND: "AD", VAT: "VA",
  GIB: "GI", JEY: "JE", GGY: "GG", FRO: "FO", SJM: "SJ", ALB: "AL", SRB: "RS",
  BIH: "BA", MNE: "ME", MDA: "MD", TUR: "TR",
  // Asia y Medio Oriente
  JPN: "JP", KOR: "KR", TWN: "TW", HKG: "HK", SGP: "SG", MYS: "MY", THA: "TH",
  PHL: "PH", IDN: "ID", VNM: "VN", KHM: "KH", LKA: "LK", BTN: "BT", BRN: "BN",
  MNG: "MN", NPL: "NP", MDV: "MV", AZE: "AZ", ARE: "AE", SAU: "SA", QAT: "QA",
  KWT: "KW", JOR: "JO",
  // África
  MAR: "MA", EGY: "EG", ZAF: "ZA", NGA: "NG", BWA: "BW", CIV: "CI", MYT: "YT",
  REU: "RE",
  // Oceanía
  AUS: "AU", NZL: "NZ", FJI: "FJ", PNG: "PG", NCL: "NC", PYF: "PF", TON: "TO",
  SLB: "SB", VUT: "VU", WSM: "WS", KIR: "KI", NRU: "NR", TUV: "TV", NIU: "NU",
  WLF: "WF", FSM: "FM", MHL: "MH", ASM: "AS", MNP: "MP", GUM: "GU", NFK: "NF",
  CXR: "CX", CCK: "CC", TKL: "TK", PCN: "PN",
};

function normalizarPais(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const v = valor.trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(v)) return v;
  if (/^[A-Z]{3}$/.test(v)) return ISO3_A_ISO2[v] ?? null;
  return null;
}

/**
 * Saca el país del documento de un payload de Didit.
 *
 * ⚠️ **Las claves son PLURALES y son ARRAYS.** La API v3 devuelve `id_verifications: [...]`,
 * no `id_verification: {...}`. Buscar el singular no encontraba nada y el país se quedaba
 * vacío en silencio, con la verificación aprobada — que es peor que fallar, porque el creador
 * veía su identidad en verde y el alta de cobro le pedía «verifica tu identidad».
 *
 * Se prueban varias formas porque el webhook y el endpoint de decisión no traen la misma, y
 * ninguna está documentada como estable.
 */
function extractDocumentCountry(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const candidatos: unknown[] = [root, root.decision];

  // El país que MÁS vale es el del documento; la nacionalidad va después porque un mexicano
  // con documento español tributa donde vive, no donde nació.
  const CAMPOS = ["issuing_state", "issuing_country", "country", "nationality"];
  const CLAVES = [
    "id_verifications", "nfc_verifications", "document_ai_documents",
    "id_verification", "nfc", "document",
  ];

  for (const src of candidatos) {
    if (!src || typeof src !== "object") continue;
    const o = src as Record<string, unknown>;

    for (const clave of CLAVES) {
      const bruto = o[clave];
      if (!bruto) continue;
      // Array o objeto suelto, según la forma que traiga esta versión del payload.
      const entradas = Array.isArray(bruto) ? bruto : [bruto];
      for (const d of entradas) {
        if (!d || typeof d !== "object") continue;
        for (const campo of CAMPOS) {
          const p = normalizarPais((d as Record<string, unknown>)[campo]);
          if (p) return p;
        }
      }
    }

    // Y en la raíz, que es donde lo pone el listado de sesiones.
    for (const campo of [...CAMPOS, "document_country"]) {
      const p = normalizarPais(o[campo]);
      if (p) return p;
    }
  }
  return null;
}

/**
 * Las respuestas de un cuestionario, desde la API.
 *
 * El webhook avisa de que terminó pero no trae lo que contestó, así que hay que ir a por
 * ello. Se devuelve la lista tal cual y quien la usa decide qué mira.
 */
async function fetchRespuestasCuestionario(sessionId: string | undefined): Promise<unknown> {
  if (!sessionId) return null;
  try {
    const res = await fetch(`${DIDIT_API_BASE}/v3/session/${sessionId}/decision/`, {
      headers: { "x-api-key": diditApiKey.value().trim() },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { questionnaire_responses?: unknown };
    const q = j.questionnaire_responses;
    // Didit lo devuelve como lista de sesiones de cuestionario; interesa la primera.
    const primera = Array.isArray(q) ? q[0] : q;
    if (!primera || typeof primera !== "object") return null;
    const o = primera as Record<string, unknown>;
    return o.responses ?? o.answers ?? o.form_responses ?? primera;
  } catch {
    return null;
  }
}

/** Lee el país del documento desde la API, cuando el webhook no lo trae. */
async function fetchDocumentCountry(sessionId: string | undefined): Promise<string | null> {
  if (!sessionId) return null;
  try {
    const res = await fetch(`${DIDIT_API_BASE}/v3/session/${sessionId}/decision/`, {
      headers: { "x-api-key": diditApiKey.value().trim() },
    });
    if (!res.ok) return null;
    return extractDocumentCountry(await res.json());
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// diditWebhook — recibe el resultado de la verificación y actualiza kyc/{uid}.
// ────────────────────────────────────────────────────────────────────────────
/**
 * El país del documento de un creador ya verificado, curándose solo si falta.
 *
 * Lo normal es que lo haya escrito el webhook al aprobar. Pero hay dos casos en los que no
 * está y hay que ir a buscarlo:
 *
 * - Verificaciones **anteriores al 2026-08-28**, cuando el extractor buscaba las claves en
 *   singular (`id_verification`) y la API las devuelve en plural y como array. El país se
 *   quedaba vacío en silencio, con el KYC aprobado.
 * - Aprobaciones por **revisión manual**, donde el evento puede llegar sin los datos del
 *   documento.
 *
 * Se consulta a Didit y se guarda, así que cada creador se repara la primera vez que lo
 * necesita y no hace falta un backfill.
 */
export async function resolverPaisDocumento(uid: string): Promise<string | null> {
  const ref = db.collection("kyc").doc(uid);
  const d = (await ref.get()).data() ?? {};

  const guardado = normalizarPais(d.documentCountry);
  if (guardado) return guardado;

  // Sin KYC aprobado no hay país que buscar, y preguntarlo sería gastar una llamada.
  if (d.kycApproved !== true) return null;

  const sessionId = typeof d.diditSessionId === "string" ? d.diditSessionId : undefined;
  const pais = await fetchDocumentCountry(sessionId);
  if (!pais) {
    logger.warn("kyc_pais_no_resuelto", { uid, sessionId: sessionId ?? null });
    return null;
  }

  await ref.set({ documentCountry: pais, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  logger.info("kyc_pais_recuperado", { uid, pais });
  return pais;
}

export const diditWebhook = onRequest(
  {
    region: REGION,
    secrets: [diditWebhookSecret, diditApiKey],
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const rawBody = req.rawBody?.toString("utf8") ?? "";
    const signature = req.headers["x-signature"] as string | undefined;
    const timestamp = req.headers["x-timestamp"] as string | undefined;

    if (!verifyDiditSignature(rawBody, signature, timestamp, diditWebhookSecret.value())) {
      logger.warn("diditWebhook invalid_signature");
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    let event: DiditWebhookPayload;
    try {
      event = JSON.parse(rawBody) as DiditWebhookPayload;
    } catch {
      res.status(400).json({ error: "Invalid JSON" });
      return;
    }

    /**
     * Los envíos de prueba NO tocan la base de datos.
     *
     * El botón "Probar Webhook" del panel de Didit manda un evento completo y
     * bien firmado, con `vendor_data: "test-vendor-data-123"` y estado
     * "Approved". Sin esta salida, cada pulsación creaba un `kyc/{ese id}`
     * marcado como verificado y disparaba una notificación a un usuario que no
     * existe.
     *
     * Peor: bastaría con poner ahí el uid de una persona real para aprobarle el
     * KYC desde el panel, sin que pasara por ninguna verificación.
     *
     * Se responde 200 para que la prueba salga en verde: el objetivo de ese
     * botón es comprobar la URL y la FIRMA, y las dos ya se comprobaron arriba.
     */
    const esPrueba =
      event.metadata?.test_webhook === true ||
      req.headers["x-didit-test-webhook"] === "true";
    if (esPrueba) {
      logger.info("diditWebhook prueba recibida: firma válida, sin escribir");
      res.status(200).json({ received: true, test: true });
      return;
    }

    const uid = event.vendor_data;
    const sessionId = event.session_id;
    const rawStatus = event.status;

    if (!uid || !rawStatus) {
      // Nada que actualizar; respondemos 200 para que Didit no reintente.
      res.status(200).json({ received: true });
      return;
    }

    /**
     * 🔀 No toda sesión de Didit es un KYC.
     *
     * Desde el 2026-08-28 hay dos workflows más —los cuestionarios donde el creador declara
     * su cuenta de cobro— que llegan por este mismo webhook. Sin este desvío, terminar un
     * cuestionario marcaría su identidad como aprobada o rechazada según el estado de una
     * sesión que no verificó a nadie.
     */
    if (esSesionDeCuentaDeCobro(event.workflow_id)) {
      if (mapDiditStatus(rawStatus).approved) {
        try {
          await guardarCuentaDeclarada(uid, await fetchRespuestasCuestionario(sessionId));
        } catch (err) {
          // Un fallo aquí no puede tumbar el webhook: Didit reintentaría y el creador se
          // quedaría viendo un formulario que ya envió.
          logger.error("cuenta_cobro_guardado_falló", {
            uid,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
      res.status(200).json({ received: true });
      return;
    }

    const { status: mapped, approved } = mapDiditStatus(rawStatus);
    const kycRef = db.collection("kyc").doc(uid);

    // Motivo del rechazo (solo si Declined): del payload o, si no viene, de la API.
    let reasonCode: string | null = null;
    if (mapped === "declined") {
      reasonCode = extractDeclineReason(event) ?? (await fetchDeclineReason(sessionId));
    }

    // País del documento, solo al aprobar: es lo que decide si se le piden datos fiscales y
    // sello. Se intenta del propio evento y, si no viene, se pregunta a la API.
    let documentCountry: string | null = null;
    if (mapped === "approved") {
      documentCountry = extractDocumentCountry(event) ?? (await fetchDocumentCountry(sessionId));
    }

    // Solo se notifica si el estado realmente cambió (evita spam por webhooks
    // repetidos) y si no es "not_started". Se captura dentro de la transacción.
    let notifyStatus:
      | "approved"
      | "declined"
      | "in_review"
      | "pending"
      | null = null;

    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(kycRef);
        const cur = snap.data();
        notifyStatus = null;

        // Idempotencia / orden: ignora eventos de una sesión antigua distinta
        // a la vigente (evita que un "Expired" tardío pise un "pending" nuevo).
        if (
          cur?.diditSessionId &&
          sessionId &&
          cur.diditSessionId !== sessionId
        ) {
          logger.info("diditWebhook stale_session_ignored", {
            uid,
            eventSession: sessionId,
            currentSession: cur.diditSessionId,
          });
          return;
        }

        // Una vez aprobado, no degradamos por un evento tardío.
        if (cur?.status === "approved" && mapped !== "approved") {
          return;
        }

        const isTerminal = mapped === "approved" || mapped === "declined";
        tx.set(
          kycRef,
          {
            status: mapped,
            kycApproved: approved,
            // Solo el código de país, nunca el documento. Si no se pudo resolver se conserva
            // el anterior en vez de borrarlo: un evento tardío no debe perder el dato.
            documentCountry: documentCountry ?? cur?.documentCountry ?? null,
            diditSessionId: sessionId ?? cur?.diditSessionId ?? null,
            reason: reasonCode,
            decisionAt: isTerminal
              ? FieldValue.serverTimestamp()
              : cur?.decisionAt ?? null,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        if (cur?.status !== mapped && mapped !== "not_started") {
          notifyStatus = mapped;
        }
      });
    } catch (err) {
      logger.error("diditWebhook update_failed", {
        uid,
        err: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: "Processing failed" });
      return;
    }

    // Notificación al creador (server-side; no tumba el webhook si falla).
    if (notifyStatus) {
      try {
        await notifyKycStatus(uid, notifyStatus);
      } catch (err) {
        logger.error("diditWebhook notify_failed", {
          uid,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.info("diditWebhook processed", { uid, sessionId, rawStatus, mapped });
    res.status(200).json({ received: true });
  }
);
