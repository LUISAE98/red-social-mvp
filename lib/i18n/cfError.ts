"use client";

import { useTranslations } from "next-intl";

// Maps normalized (lowercased, trimmed) Spanish backend messages to cf namespace keys.
// Backend functions stay unchanged; this utility provides progressive translation on the client.
const MSG_TO_KEY: Record<string, string> = {
  // authentication
  "debes iniciar sesión.": "mustBeSignedIn",
  "debes iniciar sesión": "mustBeSignedIn",
  "debes iniciar sesión para reaccionar.": "mustBeSignedIn",
  "debes iniciar sesión para subir video.": "mustBeSignedIn",
  "debes iniciar sesión para guardar publicaciones.": "mustBeSignedIn",
  "debes estar autenticado.": "mustBeAuthenticated",
  "debes estar autenticado": "mustBeAuthenticated",

  // not found
  "la comunidad no existe.": "communityNotFound",
  "comunidad no existe.": "communityNotFound",
  "el grupo no existe.": "communityNotFound",
  "comunidad no encontrada.": "communityNotFound",
  "el perfil no existe.": "profileNotFound",
  "perfil no encontrado.": "profileNotFound",
  "la solicitud de sesión exclusiva no existe.": "requestNotFound",
  "la solicitud de sesión en vivo no existe.": "requestNotFound",
  "solicitud no existe.": "requestNotFound",
  "la publicación no existe.": "postNotFound",
  "la sesión no existe.": "sessionNotFound",
  "el live no existe.": "postNotFound",

  // permissions
  "no tienes permisos para realizar esta acción.": "noPermission",
  "solo el owner o un moderador pueden realizar esta acción.": "noPermission",
  "solo el owner o un moderador pueden gestionar solicitudes.": "noPermission",
  "solo el creador puede hacer esta acción.": "onlyCreatorCanAct",
  "solo el creador puede configurar este live.": "onlyCreatorCanAct",
  "solo el comprador puede hacer esta acción.": "onlyBuyerCanAct",
  "solo el owner de la comunidad puede realizar esta acción.": "onlyOwnerCanAct",
  "solo el owner puede generar links.": "onlyOwnerCanAct",
  "solo el dueño del grupo puede fijar o desfijar publicaciones.": "onlyOwnerCanAct",
  "solo puedes fijar o desfijar publicaciones en tu propio perfil.": "onlyOwnerCanAct",
  "solo puedes subir video a tu propio perfil.": "onlyOwnerCanAct",

  // membership / community
  "ya formas parte de esta comunidad.": "alreadyMember",
  "te uniste correctamente a la comunidad.": "joinedSuccessfully",
  "tu solicitud de acceso fue enviada.": "requestSent",
  "debes tener una membresía válida para solicitar esta sesión exclusiva.": "needsValidMembership",
  "debes tener una membresía válida para solicitar esta sesión en vivo.": "needsValidMembership",
  "tu membresía no permite solicitar esta sesión exclusiva.": "needsValidMembership",
  "tu membresía no permite solicitar esta sesión en vivo.": "needsValidMembership",
  "tu membresía no permite publicar en esta comunidad.": "needsValidMembership",

  // session lifecycle
  "esta sesión fue cancelada.": "sessionCancelled",
  "esta sesión ya ha finalizado.": "sessionEnded",
  "la sesión no está disponible para videollamada en este momento.": "sessionNotReady",
  "el horario de esta sesión ya expiró. contacta al creador si necesitas reagendar.": "sessionExpiredSchedule",
  "esta solicitud fue rechazada.": "requestNotFound",
  "esta sesión está en proceso de devolución.": "sessionNotReady",
  "esta sesión está en revisión de devolución.": "sessionNotReady",
  "el pago de esta sesión no está confirmado.": "sessionNotReady",

  // invite links
  "este link ya expiró.": "linkExpired",
  "este link fue revocado.": "linkRevoked",
  "este link ya alcanzó su límite de usos.": "linkMaxUses",

  // posts
  "la publicación fue eliminada.": "deletedPost",
  "no puedes reaccionar a una publicación eliminada.": "deletedPost",
  "no puedes guardar una publicación eliminada.": "deletedPost",

  // video upload
  "no se pudo crear la subida de video.": "videoUploadFailed",
  "no se pudo crear la subida de video en mux.": "videoUploadFailed",

  // service availability
  "este perfil no tiene activo el servicio de sesión exclusiva.": "serviceNotEnabled",
  "este grupo no tiene activo el servicio de sesión exclusiva.": "serviceNotEnabled",
  "este perfil no tiene activo el servicio de sesión en vivo.": "serviceNotEnabled",
  "este grupo no tiene activo el servicio de sesión en vivo.": "serviceNotEnabled",

  // scheduling
  "la fecha propuesta debe ser futura.": "futureDateRequired",

  // internal
  "ocurrió un error interno al consumir el link.": "internalError",
};

function normalize(msg: string): string {
  return msg.trim().toLowerCase();
}

function resolveKey(rawMessage: string): string | null {
  const norm = normalize(rawMessage);

  // Exact lookup
  if (norm in MSG_TO_KEY) return MSG_TO_KEY[norm];

  // Dynamic: rate-limit messages include a wait time ("Espera 30s antes de publicar")
  if (norm.startsWith("espera") && norm.includes("publicar")) return "rateLimitPost";
  if (norm.startsWith("espera") && norm.includes("comentar")) return "rateLimitComment";

  // Dynamic: "Aún no es hora. La sala abre X min antes del inicio programado."
  if (norm.startsWith("aún no es hora")) return "sessionNotReady";

  // Dynamic: schedule conflicts contain "ya tienes" and time info
  if (norm.startsWith("ya tienes") && norm.includes("inicia")) return "sessionNotReady";

  return null;
}

/**
 * Hook that returns a function to translate Cloud Function HttpsError messages.
 * The backend stays unchanged (messages are in Spanish); this maps known messages
 * to the active locale. Unknown messages fall back to the raw backend message.
 *
 * Usage:
 *   const cfError = useCfError();
 *   // inside catch block:
 *   setErrorMsg(cfError(err));
 */
export function useCfError() {
  const t = useTranslations("cf");

  return function cfError(err: unknown): string {
    const raw = (err as { message?: string } | null)?.message ?? "";
    const key = resolveKey(raw);
    if (key) {
      return t(key as Parameters<typeof t>[0]);
    }
    return raw || t("internalError");
  };
}
