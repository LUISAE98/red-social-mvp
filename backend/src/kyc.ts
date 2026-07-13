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
import { defineSecret } from "firebase-functions/params";
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { checkAndRecord } from "./rateLimiter";

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

// ────────────────────────────────────────────────────────────────────────────
// diditWebhook — recibe el resultado de la verificación y actualiza kyc/{uid}.
// ────────────────────────────────────────────────────────────────────────────
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

    const uid = event.vendor_data;
    const sessionId = event.session_id;
    const rawStatus = event.status;

    if (!uid || !rawStatus) {
      // Nada que actualizar; respondemos 200 para que Didit no reintente.
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

    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(kycRef);
        const cur = snap.data();

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
            diditSessionId: sessionId ?? cur?.diditSessionId ?? null,
            reason: reasonCode,
            decisionAt: isTerminal
              ? FieldValue.serverTimestamp()
              : cur?.decisionAt ?? null,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      });
    } catch (err) {
      logger.error("diditWebhook update_failed", {
        uid,
        err: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: "Processing failed" });
      return;
    }

    logger.info("diditWebhook processed", { uid, sessionId, rawStatus, mapped });
    res.status(200).json({ received: true });
  }
);
