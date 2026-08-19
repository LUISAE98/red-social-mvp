//index

import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";

import { expireMeetGreetNoShowsHandler, autoExpirePendingMeetGreetRequestsHandler, autoRejectUndeliveredMeetGreetRequestsHandler } from "./meetGreetRequests";
import { expireExclusiveSessionNoShowsHandler, autoExpirePendingExclusiveSessionRequestsHandler, autoRejectUndeliveredExclusiveSessionRequestsHandler } from "./exclusiveSessionRequests";
import { autoExpirePendingGreetingRequestsHandler, autoRejectUndeliveredGreetingRequestsHandler } from "./greetingRequests";
import { updateExchangeRatesHandler } from "./exchangeRates";
import { refreshFrozenRatesHandler } from "./tax/frozenRates";
import { updateVatRatesHandler } from "./vatRates";
import { sessionRemindersHandler } from "./sessionLifecycle";
import { expireGroupSubscriptionsHandler } from "./payments/groupSubscriptionCore";
import { stripeSecretKey } from "./payments/stripe/stripeClient";
import { cleanupAbandonedCreditReservationsHandler } from "./payments/stripe/creditReservationCleanup";
import { sweepGroupVisibilityDriftHandler } from "./groupVisibilityDriftSweep";

// Healthcheck público
export const healthcheck = onRequest(
  {
    cors: true,
    region: "us-central1",
  },
  (req, res) => {
    logger.info("healthcheck ping", {
      method: req.method,
      path: req.path,
    });

    // Sin nombre de servicio ni reloj del servidor: un healthcheck solo tiene
    // que decir que está vivo, y esos dos datos solo sirven para perfilar la
    // infraestructura desde fuera.
    res.status(200).json({ status: "ok" });
  }
);

export const expireScheduledServiceNoShows = onSchedule(
  {
    schedule: "every 5 minutes",
    timeZone: "America/Mexico_City",
    region: "us-central1",
  },
  async () => {
    logger.info("expireScheduledServiceNoShows started");

    await Promise.all([
      expireMeetGreetNoShowsHandler(),
      expireExclusiveSessionNoShowsHandler(),
    ]);

    logger.info("expireScheduledServiceNoShows finished");
  }
);

export const autoExpirePendingServiceRequests = onSchedule(
  {
    // Cada 6 h: (a) CAPTURA el auth-hold al 6º día como respaldo (antes de que expire el
    // hold de tarjeta ~7 días), y (b) marca RECHAZADA la experiencia YA COBRADA que el
    // creador no entregó en 60 días → el comprador puede pedir devolución → crédito.
    schedule: "every 6 hours",
    timeZone: "America/Mexico_City",
    region: "us-central1",
    secrets: [stripeSecretKey],
  },
  async () => {
    logger.info("autoExpirePendingServiceRequests started");

    await Promise.all([
      // Respaldo de captura del hold (día 6).
      autoExpirePendingGreetingRequestsHandler(),
      autoExpirePendingMeetGreetRequestsHandler(),
      autoExpirePendingExclusiveSessionRequestsHandler(),
      // Auto-rechazo por no entregar en 60 días (ya cobradas).
      autoRejectUndeliveredGreetingRequestsHandler(),
      autoRejectUndeliveredMeetGreetRequestsHandler(),
      autoRejectUndeliveredExclusiveSessionRequestsHandler(),
    ]);

    logger.info("autoExpirePendingServiceRequests finished");
  }
);

// Saldo a favor: libera las RESERVAS de crédito de checkouts de tarjeta-nueva abandonados.
export const cleanupAbandonedCreditReservations = onSchedule(
  {
    schedule: "every 6 hours",
    timeZone: "America/Mexico_City",
    region: "us-central1",
    // ⚠️ Sin declarar el secreto, `stripeFetch` responde "Falta el secreto
    // STRIPE_SECRET_KEY", `cancelIntentIfCancelable` devuelve false y la guarda
    // del C01 del Bloque 6 corta la devolución: el saldo del comprador quedaba
    // reservado para siempre y el cron no hacía nada, en silencio. Es el mismo
    // fallo que tuvo `softDeleteGroup` (Bloque 7).
    secrets: [stripeSecretKey],
  },
  async () => {
    logger.info("cleanupAbandonedCreditReservations started");
    await cleanupAbandonedCreditReservationsHandler();
    logger.info("cleanupAbandonedCreditReservations finished");
  }
);

// Recordatorio pre-sesión (sesiones 1-a-1): avisa a ambas partes ~15 min antes.
export const sessionPreSessionReminders = onSchedule(
  {
    schedule: "every 5 minutes",
    timeZone: "America/Mexico_City",
    region: "us-central1",
  },
  async () => {
    logger.info("sessionPreSessionReminders started");
    await sessionRemindersHandler();
    logger.info("sessionPreSessionReminders finished");
  }
);

// Tasas de cambio: CONGELAMIENTO DIARIO. Persiste en `config/exchangeRates`, que TODO el
// frontend lee con un listener compartido — nunca se llama una API por carga de página.
//
// La tasa buena la da STRIPE (la misma con la que cobra), y open.er-api.com queda solo como
// respaldo por si Stripe no responde: antes una tabla vieja bastaba, ahora la tabla ES el
// precio del día y no puede quedarse en blanco.
export const updateExchangeRates = onSchedule(
  {
    schedule: "every 24 hours",
    timeZone: "America/Mexico_City",
    region: "us-central1",
    // ⚠️ Necesario desde que este cron pide la tasa a Stripe. Sin declararlo, `stripeFetch`
    // responde "Falta el secreto" y el congelamiento diario no haría nada, en silencio —
    // el mismo fallo que tuvieron `softDeleteGroup` y `cleanupAbandonedCreditReservations`.
    secrets: [stripeSecretKey],
  },
  async () => {
    logger.info("updateExchangeRates started");
    // Respaldo: mantiene viva la tabla si Stripe no responde. El refresco bueno lo hace
    // el congelamiento de abajo con la tasa de Stripe, que es la que de verdad cobra.
    await updateExchangeRatesHandler();
    // Congelamiento diario: reescribe TODAS las monedas con la tasa de Stripe. A partir de
    // aquí el precio mostrado no se mueve hasta mañana, salvo que alguna moneda se salga
    // de su banda y la agarre el cron de vigilancia.
    await refreshFrozenRatesHandler(true);
    logger.info("updateExchangeRates finished");
  }
);

/**
 * Vigilancia del tipo de cambio: refresco FUERA DE HORARIO por moneda.
 *
 * Compara la tasa congelada contra la de Stripe y solo reescribe las que se salieron de su
 * banda (0.5% estándar; más ancha en ARS, TRY, NGN, EGP y VND, que se mueven demasiado).
 * Las estables no se tocan en todo el día.
 *
 * Consultar la tasa a Stripe con `lock_duration: none` es GRATIS, así que correr cada 15
 * minutos no cuesta nada más que la invocación.
 */
export const watchFxDrift = onSchedule(
  {
    schedule: "every 15 minutes",
    timeZone: "America/Mexico_City",
    region: "us-central1",
    secrets: [stripeSecretKey],
  },
  async () => {
    const r = await refreshFrozenRatesHandler(false);
    if (r.refrescadas.length > 0) logger.info("watchFxDrift refrescó monedas", r);
  }
);

// Tasas de IVA de la UE: vigilante diario contra VATcomply/TEDB (la base oficial de la
// Comisión Europea). NO cambia lo que se cobra — escribe a `config/vatRates` y registra en
// el log si alguna tasa se desalineó de COUNTRY_TAX_CONFIG, para revisión humana.
// Ver backend/src/vatRates.ts e impuestos.md §5.
export const updateVatRates = onSchedule(
  {
    schedule: "every 24 hours",
    timeZone: "America/Mexico_City",
    region: "us-central1",
  },
  async () => {
    logger.info("updateVatRates started");
    await updateVatRatesHandler();
    logger.info("updateVatRates finished");
  }
);

// Suscripciones a comunidades: da de baja el acceso cuando el periodo pagado (o la
// gracia) venció. Corre a diario.
export const expireGroupSubscriptions = onSchedule(
  {
    schedule: "every 24 hours",
    timeZone: "America/Mexico_City",
    region: "us-central1",
  },
  async () => {
    logger.info("expireGroupSubscriptions started");
    await expireGroupSubscriptionsHandler();
    logger.info("expireGroupSubscriptions finished");
  }
);

// Red de seguridad de la visibilidad: busca comunidades privadas u ocultas cuyos
// posts sigan declarándose públicos y las resincroniza. El trigger de cambio de
// visibilidad ya reintenta, pero no puede arreglar la deriva anterior a él ni la
// de reintentos agotados — y esa deriva es contenido de una comunidad cerrada
// abierto a cualquiera, porque las reglas de listado deciden con la copia.
export const sweepGroupVisibilityDrift = onSchedule(
  {
    schedule: "every 24 hours",
    timeZone: "America/Mexico_City",
    region: "us-central1",
  },
  async () => {
    logger.info("sweepGroupVisibilityDrift started");
    const result = await sweepGroupVisibilityDriftHandler();
    logger.info("sweepGroupVisibilityDrift finished", result);
  }
);

// Join requests
export { approveJoinRequest, rejectJoinRequest } from "./joinRequests";

// Invitaciones a moderar (permite nombrar moderador a alguien que no es miembro).
export {
  inviteGroupModerator,
  respondGroupModeratorInvite,
} from "./moderatorInvites";

// Invite links
export {
  createInviteLink,
  getInviteLinkPreview,
  consumeInviteLink,
  revokeInviteLink,
  listInviteLinks,
} from "./inviteLinks";

// Sidebar groups
export { getMyHiddenJoinedGroups } from "./sidebarGroups";

// Greeting requests
export {
  createGreetingRequest,
  respondGreetingRequest,
  requestGreetingRefund,
  createGreetingMuxUpload,
} from "./greetingRequests";

// Meet & greet requests
export {
  createMeetGreetRequest,
  acceptMeetGreetRequest,
  rejectMeetGreetRequest,
  proposeMeetGreetSchedule,
  requestMeetGreetReschedule,
  declineMeetGreetReschedule,
  requestMeetGreetRefund,
  setMeetGreetPreparing,
} from "./meetGreetRequests";

// Exclusive session requests
export {
  createExclusiveSessionRequest,
  acceptExclusiveSessionRequest,
  rejectExclusiveSessionRequest,
  proposeExclusiveSessionSchedule,
  requestExclusiveSessionReschedule,
  declineExclusiveSessionReschedule,
  requestExclusiveSessionRefund,
  setExclusiveSessionPreparing,
} from "./exclusiveSessionRequests";

// Group moderation
export {
  promoteGroupMemberToAdmin,
  demoteGroupAdminToMember,
  muteGroupMember,
  unmuteGroupMember,
  banGroupMember,
  unbanGroupMember,
  removeGroupMember,
  cleanupExpiredGroupMutes,
} from "./groupModeration";

// Subscription transitions
export {
  applyGroupSubscriptionTransition,
  removeLegacyFreeMembersAfterSubscriptionTransition,
  dismissHiddenGroupTransition,
} from "./subscriptionTransitions";

// Profile settings
export { updateProfileDisplayName, updateProfileInterests } from "./profileSettings";

// Sesiones activas — geo-IP para etiquetar la ubicación de cada dispositivo
export { enrichSessionLocation, revokeAllSessions } from "./sessions";

// Migración de corrida única: saca correo/fecha de nacimiento/sexo del documento
// público del perfil. onCall con gate de admin, nunca onRequest abierto.
export { migratePrivateProfile } from "./migratePrivateProfile";

// Post reactions
export { togglePostFlame } from "./postReactions";

// Post comments
export { toggleCommentFlame } from "./postComments";
export {
  onCommentDeletedCleanupImage,
  onCommentReplyDeletedCleanupImage,
} from "./commentImageCleanup";

// Medios de una publicación borrada (M06): imágenes, miniaturas, portadas de
// video y las imágenes de sus comentarios.
export {
  onPostSoftDeletedCleanupMedia,
  onPostDeletedCleanupMedia,
} from "./postMediaCleanup";

// B8-C01 — editar una publicación pasa por el servidor. Las reglas no saben
// validar los elementos de una lista, y `media` es exactamente eso: una lista de
// objetos con rutas de Storage.
export { updatePost } from "./updatePost";

// B8-C03/H02 — cerrar el perfil tiene que alcanzar al contenido ya publicado:
// la copia `profileRestricted` de las publicaciones y el `searchable` de las
// historias, del que depende entera la regla de lectura de historias.
export {
  onProfileRestrictionChanged,
  onStoryCreatedEnforceSearchable,
} from "./profileRestrictionSync";

// Medios de comunidades privadas/ocultas (URL firmada que caduca)
export { getRestrictedMediaUrls } from "./restrictedMedia";
export { backfillRestrictedMedia } from "./restrictedMediaBackfill";

// Post saves
export {
  togglePostSave,
  onSavedPostsPostDeleted,
  backfillSavedPosts,
} from "./postSaves";

// Post pins
export { toggleGroupPostPin, toggleProfilePostPin } from "./postPins";

// Home Feed materializado
export {
  onHomeFeedPostCreated,
  onHomeFeedPostUpdated,
  onHomeFeedMembershipCreated,
  onHomeFeedMembershipDeleted,
  onHomeFeedMemberStatusChanged,
  onHomeFeedFollowingDeleted,
  onHomeFeedBlockedUserCreated,
} from "./home-feed";

// Profile Feed materializado
export {
  onProfileFeedPostCreated,
  onProfileFeedPostUpdated,
  onProfileFeedPostDeleted,
  onProfileFeedGroupUpdated,
} from "./profile-feed";

// Group memberships sync
export { onGroupMembershipMetaUpdated } from "./groupMembershipsSync";

// Al cambiar la visibilidad de la comunidad, resincroniza la copia denormalizada
// (`groupVisibility` / `isShareable` / `search`) en TODOS sus posts: es la copia
// que consultan las reglas para decidir quién puede leerlos.
export { onGroupVisibilityPostsSync } from "./groupPostsVisibilitySync";

// Mux uploads
export { createMuxDirectUpload, createMuxDonationUpload, createMuxGroupDonationUpload } from "./muxUploads";

// Mux webhooks
export { muxWebhook } from "./muxWebhooks";

// Blindaje del playback de contenido de pago (el playbackId no puede vivir en el
// doc del post, que es legible por quien todavía no paga) + permiso temporal de
// reproducción para quien sí tiene acceso (playback firmado de Mux).
export { onPostPlaybackProtection } from "./protectedPlayback";
export { getMuxPlaybackToken } from "./muxPlaybackToken";

// Shared communities
export { getSharedCommunitiesWithProfile } from "./sharedCommunities";

// Group deletion
export { softDeleteGroup } from "./groupDeletion";

// Rate limiting
export { checkRateLimitPost } from "./rateLimiter";

// Creación de publicaciones (server-authoritative: `posts` es create: if false)
export { createPost } from "./createPost";

// Video overlay download
export { videoOverlayDownload } from "./videoOverlay";

// Descarga animada de saludos/consejos (Web Egress "hornea" intro + esquina + outro)
export { greetingAnimatedDownload } from "./greetingRender";

// Muestras de saludo/consejo: contenido del creador para su vitrina. Viven
// aparte de greetingRequests a propósito — no mueven dinero.
export {
  createGreetingSampleUpload,
  updateGreetingSampleContext,
  deleteGreetingSample,
} from "./greetingSamples";

// Live streams (Mux — OBS/RTMP flow)
export { createMuxLiveStream } from "./liveMux";

// Live streams (Cloudflare Stream — live directo desde browser)
export { createCFLiveInput } from "./liveCF";
export { cfWebhook } from "./cfWebhooks";

// Live viewers cleanup
export { cleanupLiveViewersOnEnd } from "./liveViewersCleanup";

// Live heartbeat cleanup — termina lives CF directos huérfanos (browser cerrado sin detener)
export { liveHeartbeatCleanup } from "./liveHeartbeatCleanup";
export { liveViewerSampler } from "./liveViewerSampler";

// Wallet — triggers que alimentan el libro mayor de ganancias (Fase 2)
export {
  onSuperCommentLedger,
  onLiveAccessLedger,
  onPostAccessLedger,
  onGroupSubscriptionLedger,
  onGroupSubscriptionChurn,
  onProfileDonationLedger,
  onGreetingLedger,
  onExclusiveSessionLedger,
  onMeetGreetLedger,
} from "./wallet/ledgerTriggers";

// Wallet — espejo de compras del comprador (users/{buyerId}/purchases)
export { mirrorLedgerToBuyerPurchase } from "./wallet/buyerPurchases";

// Wallet — devolución en efectivo del saldo a favor (B7): comprador solicita, superadmin resuelve
export { requestCashout, resolveCashout, dismissCashoutNotice, devCaptureAndCredit } from "./wallet/cashout";

// LiveKit — tokens de videollamada para sesiones exclusivas y meet & greet
export { getLivekitToken } from "./livekitTokens";

// LiveKit — ciclo de vida de sesiones (join, end)
export { joinSession, endSession, forceCompleteSession, signalSessionClosing, finalizeMeetGreetRecording, finalizeExclusiveSessionRecording } from "./sessionLifecycle";

// LiveKit — webhooks de sala y grabación
export { livekitWebhook } from "./livekitWebhook";

// LiveKit — URL pre-firmada para descarga de grabaciones
export { getRecordingDownloadUrl } from "./recordingDownload";

// Moderación de plataforma
export { submitReport, claimReport, resolveReport } from "./moderation";

// Mensajes directos — resumen del hilo, no leídos y notificación
export { onDirectMessageCreated } from "./directMessages";
export { onDirectMessageChangedUpdatePreview } from "./directMessagePreview";
export { onDirectMessageDeletedCleanupImage } from "./directMessageImageCleanup";

// Mensajes directos — URLs firmadas y caducas para las imágenes adjuntas
export { getDirectMessageImageUrls } from "./dmImages";

// KYC — pendiente de reemplazo. Didit se eliminó por completo el 2026-08-13; la
// verificación de identidad pasará a hacerse en el alta de cuenta Stripe del creador.

// Pagos (Stripe — Vibra migró 100% a Stripe; Mercado Pago retirado). S1: smoke test.
export { stripeHealthcheck } from "./payments/stripe/stripeHealthcheck";

// Diagnóstico TEMPORAL de la FX Quotes API, solo con sesión iniciada (el claim de
// administrador no está entrando). Se borra cuando el healthcheck vuelva a ser usable.
export { fxQuoteDiagnostic } from "./tax/fxQuoteDiagnostic";
// S3a: PaymentIntent para la pasarela embebida (Elements) + guardar tarjeta.
export { createStripePaymentIntent } from "./payments/stripe/createPaymentIntent";
// Fase 2 del país fiscal: recotiza el intent con el país EMISOR de la tarjeta antes de
// confirmar (la fase 1 solo tenía la IP). Ver impuestos.md §3.4.
export { repriceStripeIntentForCard } from "./payments/stripe/repriceForCard";
// S4: webhook de Stripe (pago aprobado, reembolso…). Reemplaza a mpWebhook.
export { stripeWebhook } from "./payments/stripe/stripeWebhook";
// Primer servicio real cableado a Stripe: saludo/consejo.
export { createGreetingStripeIntent } from "./payments/stripe/greetingStripeIntent";
// Callable genérico Stripe (sesión exclusiva, tiempo contigo, …).
export { createServiceStripeIntent } from "./payments/stripe/serviceStripeIntent";
// Donación a perfil con Stripe (monto dinámico + $3 + IVA).
export { createDonationStripeIntent } from "./payments/stripe/donationStripeIntent";
// Ticket de en vivo con Stripe (acceso pagado a la transmisión; base + $3 + IVA).
export { createLiveAccessStripeIntent } from "./payments/stripe/liveAccessStripeIntent";
// Desbloqueo de post premium / VOD premium con Stripe (mismo camino postAccess; base + $3 + IVA).
export { createPremiumPostStripeIntent } from "./payments/stripe/premiumPostStripeIntent";
// Donación en un en vivo con Stripe (monto dinámico + $3 + IVA; materializa super-comentario).
export { createLiveDonationStripeIntent } from "./payments/stripe/liveDonationStripeIntent";
// Súper comentario en un en vivo con Stripe (precio fijo del tier + $3 + IVA; con texto).
export { createSuperCommentStripeIntent } from "./payments/stripe/superCommentStripeIntent";
// Suscripción MENSUAL a comunidad con Stripe (Subscriptions nativas; (base + $3) × IVA/mes).
export { createGroupSubscription, cancelGroupSubscriptionStripe } from "./payments/stripe/groupSubscriptionStripe";

// Facturación (Facturapi — CFDI, modelo vendedor directo). Bloque 0: smoke test de
// credenciales (org de Vibra + multi-tenant). No emite CFDI ni toca el ledger.
export { facturapiHealthcheck } from "./facturacion/facturapiHealthcheck";

// Facturación — Bloque 1a: captura de datos fiscales del creador-proveedor
// (RFC/régimen/CP) + consentimiento de auto-facturación (self-billing).
export { saveCreatorTaxProfile } from "./facturacion/creatorTaxProfile";

// Facturación — Bloque 1b: subida del CSD → crea/actualiza la organización del
// creador en Facturapi (habilita el self-billing automático). El CSD vive en
// Facturapi, no en Firestore.
export { uploadCreatorCsd } from "./facturacion/uploadCreatorCsd";

// Facturación — Bloque 1c: datos fiscales del COMPRADOR (receptor). No sube CSD;
// solo guardamos sus datos para que Vibra timbre su factura de venta (Bloque 2).
export { saveBuyerTaxProfile } from "./facturacion/buyerTaxProfile";

// Facturación — perfiles de facturación del comprador (varios, tipo tarjetas).
export { saveBuyerBillingProfile, deleteBuyerBillingProfile } from "./facturacion/buyerBillingProfiles";

// Facturación — Bloque 2: emisión del CFDI Vibra → comprador (org de Vibra).
export { generateBuyerInvoice, downloadBuyerInvoice } from "./facturacion/generateBuyerInvoice";

// TODOS los servicios (saludo/consejo, sesión/tiempo contigo, donación perfil/live,
// ticket/premium/VOD, súper comentario, suscripción a comunidad) cobran por STRIPE.
// Mercado Pago se retiró por completo (mpWebhook/payProfileDonation/payGroupSubscription
// y el cliente MP eliminados).

// Los backfills de corrida única (búsqueda de historias, liveId del ledger,
// postId de tickets, groupCategory de posts y categorías/vistas de historias) se
// retiraron el 2026-08-13: eran `onRequest` SIN autenticación que recorrían
// colecciones enteras con privilegios Admin, o sea una factura de Firestore a un
// curl de distancia. Ya se habían ejecutado. Si hiciera falta correr otro, el
// patrón correcto es el de `backfillSavedPosts`/`backfillRestrictedMedia`:
// `onCall` con gate por email de admin, nunca `onRequest` abierto.
// El código vive en el historial de git (commit anterior a este).

// Historias: contador de vistas (trigger), rescate del video cuando la historia
// se publicó antes de que Mux terminara, y backfill de los campos del reel.
export {
  onStoryViewed,
  onStoryCreatedPlaybackBackfill,
  backfillStoriesReelFields,
} from "./storyDiscovery";

// Limpieza de referencias a videos borrados en Mux (historias, VOD y videos de
// publicaciones). Borrar un asset en Mux no avisa a Firestore.
export { cleanupDeletedMuxVideos } from "./muxOrphanCleanup";

// Contadores de comentarios y respuestas: los lleva el SERVIDOR, no el cliente
export {
  onCommentCountCreated,
  onCommentCountDeleted,
  onReplyCountCreated,
  onReplyCountDeleted,
} from "./commentCounters";

// Publicaciones y miembros: contadores guardados en el documento del perfil o de
// la comunidad. Existen para que el card de la portada se vea tambien desde
// fuera —perfil restringido, comunidad privada, invitacion sin aceptar—, donde
// las reglas niegan contar los documentos reales. Ver entityCounters.ts.
export {
  onPostsCountCreated,
  onPostsCountUpdated,
  onPostsCountDeleted,
  onMembersCountCreated,
  onMembersCountDeleted,
} from "./entityCounters";

// Posts: contador de vistas únicas por usuario (videos y VODs)
export { onPostViewed } from "./postViews";

// Posts: contador de desbloqueos (compras únicas) de premium / VOD
export { onPremiumUnlockCount } from "./premiumUnlockCount";
// Contador de tickets de en vivo (espejo del de premium).
export { onLiveTicketCount } from "./liveTicketCount";

// Notificaciones sociales — triggers que alimentan la campanita (agregadas)
export {
  onPostReactionCreated,
  onPostCommentCreated,
  onPostCommentReplyCreated,
  onCommentReactionCreated,
  onFollowerCreated,
  onJoinRequestCreated,
  onJoinRequestRemoved,
  onGroupMemberCreated,
  onPostCreated,
  fanoutNewPostTask,
  onInviteLinkUpdated,
  expireInviteLinks,
  onDonationNotify,
} from "./notifications";

// Push del sistema (FCM) para todas las notificaciones in-app
export { onNotificationWritten } from "./push";
