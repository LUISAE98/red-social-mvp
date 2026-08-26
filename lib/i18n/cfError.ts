"use client";

import { useTranslations } from "next-intl";

import { mensajeSeguro } from "@/lib/errors/mensajeSeguro";

// Maps normalized (lowercased, trimmed) Spanish backend messages to cf namespace keys.
// Backend functions stay unchanged; this utility provides progressive translation on the client.
//
// Las llaves con prefijo `common:` viven en el grupo compartido y no en `cf`:
// son textos que ya decía otra pantalla y que ahora tienen una sola redacción.
const MSG_TO_KEY: Record<string, string> = {
  // authentication
  "debes iniciar sesión.": "common:mustBeSignedIn",
  "debes iniciar sesión": "common:mustBeSignedIn",
  "debes iniciar sesión para reaccionar.": "common:mustBeSignedIn",
  "debes iniciar sesión para subir video.": "common:mustBeSignedIn",
  "debes iniciar sesión para guardar publicaciones.": "common:mustBeSignedIn",
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
  "la solicitud de tiempo contigo no existe.": "requestNotFound",
  "solicitud no existe.": "requestNotFound",
  "la publicación no existe.": "postNotFound",
  "la sesión no existe.": "sessionNotFound",
  "el live no existe.": "postNotFound",

  // pagos: en vivo, comunidad, suscripción e invitación
  "en vivo no encontrado.": "liveNotFound",
  "falta el id del en vivo.": "liveNotFound",
  "esta publicación no es un en vivo.": "postIsNotLive",
  "este en vivo no requiere ticket.": "liveNoTicketNeeded",
  "ya tienes acceso a este en vivo.": "alreadyHasLiveAccess",
  "ya tienes acceso a esta transmisión con tu ticket.": "alreadyHasLiveAccess",
  "estás silenciado o bloqueado en este en vivo.": "mutedInLive",
  "estás silenciado o baneado en esta comunidad.": "mutedInCommunity",
  "esta comunidad ya no está disponible.": "communityUnavailable",
  "esta comunidad está inactiva.": "communityUnavailable",
  "esta comunidad no tiene suscripción activa.": "communityHasNoSubscription",
  "no tienes una suscripción a esta comunidad.": "noSubscriptionToCommunity",
  "ya tienes una suscripción activa a esta comunidad.": "alreadySubscribed",
  "no puedes suscribirte a tu propia comunidad.": "cannotSubscribeOwnCommunity",
  "no se pudo cancelar la suscripción. intenta de nuevo.": "subscriptionCancelFailed",
  "no se pudo crear la suscripción. intenta de nuevo.": "subscriptionCreateFailed",
  "no se pudo reactivar la suscripción. intenta de nuevo.": "subscriptionReactivateFailed",
  "esta suscripción no se puede cancelar por esta vía.": "subscriptionCancelWrongWay",
  "la invitación no es válida o expiró.": "inviteInvalid",
  "esta invitación ya no tiene cupos disponibles.": "inviteNoSeats",
  "necesitas una invitación válida para suscribirte a esta comunidad.": "inviteRequired",
  "falta la comunidad.": "communityNotFound",
  "publicación no encontrada.": "postNotFound",
  "falta el id de la publicación.": "postNotFound",
  "solicitud no encontrada.": "requestNotFound",
  "falta el id de la solicitud.": "requestNotFound",
  "necesitas iniciar sesión.": "common:mustBeSignedIn",
  "comunidad sin creador.": "internalError",
  "publicación sin autor.": "internalError",
  "en vivo sin autor.": "internalError",
  "falta el creador.": "internalError",
  // pagos: cobro, montos, precios y supercomentario
  "el pago no existe.": "paymentNotFound",
  "el pago ya está en proceso.": "paymentInProgress",
  "este pago ya no se puede modificar.": "paymentNotEditable",
  "falta el método de pago.": "missingPaymentMethod",
  "tarjeta guardada no encontrada.": "savedCardNotFound",
  "no se pudo cobrar tu tarjeta guardada. intenta con otra.": "savedCardDeclined",
  "falta la referencia del pago.": "invalidReference",
  "referencia inválida.": "invalidReference",
  "el monto es demasiado alto.": "amountTooHigh",
  "el monto de la donación es demasiado alto.": "amountTooHigh",
  "el precio del supercomentario es demasiado alto.": "amountTooHigh",
  "monto de la donación inválido.": "invalidAmount",
  "monto inválido para facturar.": "invalidAmount",
  "precio inválido.": "invalidPrice",
  "precio inválido para esta publicación.": "invalidPrice",
  "precio de ticket inválido.": "invalidPrice",
  "la publicación no es premium.": "postNotPremium",
  "ya tienes acceso a esta publicación.": "alreadyHasPostAccess",
  "no puedes contribuirte a ti mismo.": "cannotPayYourself",
  "no puedes donarte a ti mismo.": "cannotPayYourself",
  "no puedes enviarte un supercomentario a ti mismo.": "cannotPayYourself",
  "es tu propia publicación.": "cannotPayYourself",
  "es tu propio en vivo.": "cannotPayYourself",
  "el supercomentario no puede ir vacío.": "superCommentEmpty",
  "falta el nivel del supercomentario.": "superCommentInvalidTier",
  "nivel de supercomentario inválido.": "superCommentInvalidTier",
  "esta solicitud ya está pagada.": "requestAlreadyPaid",
  "tipo de servicio no soportado.": "unsupportedServiceType",
  "este pago no es tuyo.": "noPermission",
  "ese método de pago no es tuyo.": "noPermission",
  "no es tu suscripción.": "noPermission",
  "no eres el comprador de esta solicitud.": "onlyBuyerCanAct",
  "el pago no tiene un monto base válido.": "internalError",
  "no se pudo preparar el producto de suscripción.": "internalError",
  // pagos: facturación y datos fiscales
  "factura no encontrada.": "invoiceNotFound",
  "falta la factura a descargar.": "invoiceNotFound",
  "perfil de facturación no encontrado.": "billingProfileNotFound",
  "falta el perfil de facturación.": "billingProfileNotFound",
  "rfc inválido.": "invalidTaxId",
  "código postal fiscal inválido.": "invalidTaxPostalCode",
  "falta el nombre o razón social.": "missingTaxName",
  "falta el nombre o razón social fiscal.": "missingTaxName",
  "falta el régimen fiscal.": "missingTaxRegime",
  "falta el uso de cfdi.": "missingCfdiUse",
  "solo puedes facturar compras pagadas.": "onlyPaidPurchasesInvoiceable",
  "una de las compras ya fue facturada.": "alreadyInvoiced",
  "no hay tasa de cambio disponible para facturar esta compra.": "invoiceFxUnavailable",
  "selecciona al menos un movimiento.": "selectAtLeastOneMovement",
  "el perfil de facturación no tiene cliente de facturapi.": "internalError",
  // pagos: sello digital del creador
  "no se pudo acceder a la factura del creador.": "creatorInvoiceUnavailable",
  "no se pudo emitir ninguna factura. los creadores de estas compras aún no tienen su sello digital al día.": "creatorsMissingTaxSeal",
  "una de las compras no tiene creador asociado.": "internalError",
  // cobertura por país
  "el cobro no está disponible en tu país por ahora.": "countryNotAvailable",
  "el cobro no está disponible en tu país por ahora": "countryNotAvailable",
  "no podemos cobrar con una tarjeta de ese país por ahora.": "cardCountryNotAvailable",
  "no podemos cobrar con una tarjeta de ese país por ahora": "cardCountryNotAvailable",

  // permissions
  "no tienes permisos para realizar esta acción.": "noPermission",
  "solo el creador o un moderador pueden realizar esta acción.": "noPermission",
  "solo el creador o un moderador pueden gestionar solicitudes.": "noPermission",
  "solo el creador puede hacer esta acción.": "onlyCreatorCanAct",
  "solo el creador puede configurar este live.": "onlyCreatorCanAct",
  "solo el comprador puede hacer esta acción.": "onlyBuyerCanAct",
  "solo el creador de la comunidad puede realizar esta acción.": "onlyOwnerCanAct",
  "solo el creador puede generar links.": "onlyOwnerCanAct",
  "solo el creador de la comunidad puede fijar o desfijar publicaciones.": "onlyOwnerCanAct",
  "solo puedes fijar o desfijar publicaciones en tu propio perfil.": "onlyOwnerCanAct",
  "solo puedes subir video a tu propio perfil.": "onlyOwnerCanAct",

  // membership / community
  "ya formas parte de esta comunidad.": "alreadyMember",
  "te uniste correctamente a la comunidad.": "joinedSuccessfully",
  "tu solicitud de acceso fue enviada.": "requestSent",
  "debes tener una membresía válida para solicitar esta sesión exclusiva.": "needsValidMembership",
  "debes tener una membresía válida para solicitar esta tiempo contigo.": "needsValidMembership",
  "tu membresía no permite solicitar esta sesión exclusiva.": "needsValidMembership",
  "tu membresía no permite solicitar esta tiempo contigo.": "needsValidMembership",
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
  "no se pudo crear la subida de video.": "common:videoUploadError",
  "no se pudo crear la subida de video en mux.": "common:videoUploadError",

  // service availability
  "este perfil no tiene activo el servicio de sesión exclusiva.": "serviceNotEnabled",
  "este grupo no tiene activo el servicio de sesión exclusiva.": "serviceNotEnabled",
  "este perfil no tiene activo el servicio de tiempo contigo.": "serviceNotEnabled",
  "este grupo no tiene activo el servicio de tiempo contigo.": "serviceNotEnabled",

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
  const tCommon = useTranslations("common");

  return function cfError(err: unknown): string {
    const raw = (err as { message?: string } | null)?.message ?? "";
    const key = resolveKey(raw);
    if (key) {
      if (key.startsWith("common:")) {
        return tCommon(key.slice("common:".length) as Parameters<typeof tCommon>[0]);
      }
      return t(key as Parameters<typeof t>[0]);
    }
    /* Sin traducción conocida se devolvía el mensaje crudo, y por ahí se colaba
       el volcado interno del SDK de Firestore hasta la pantalla. */
    return mensajeSeguro(raw, t("internalError"));
  };
}
