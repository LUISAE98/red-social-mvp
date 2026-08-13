//index

import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";

import { expireMeetGreetNoShowsHandler, autoExpirePendingMeetGreetRequestsHandler, autoRejectUndeliveredMeetGreetRequestsHandler } from "./meetGreetRequests";
import { expireExclusiveSessionNoShowsHandler, autoExpirePendingExclusiveSessionRequestsHandler, autoRejectUndeliveredExclusiveSessionRequestsHandler } from "./exclusiveSessionRequests";
import { autoExpirePendingGreetingRequestsHandler, autoRejectUndeliveredGreetingRequestsHandler } from "./greetingRequests";
import { updateExchangeRatesHandler } from "./exchangeRates";
import { updateVatRatesHandler } from "./vatRates";
import { sessionRemindersHandler } from "./sessionLifecycle";
import { expireGroupSubscriptionsHandler } from "./payments/groupSubscriptionCore";
import { stripeSecretKey } from "./payments/stripe/stripeClient";
import { cleanupAbandonedCreditReservationsHandler } from "./payments/stripe/creditReservationCleanup";

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

    res.status(200).json({
      status: "ok",
      service: "red-social-mvp-backend",
      timestamp: new Date().toISOString(),
    });
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

// Tasas de cambio (dLocal/FX): una sola llamada DIARIA a la fuente (open.er-api.com,
// base USD) que persiste en config/exchangeRates. TODO el frontend lee ese doc
// cacheado vía un listener compartido — nunca se llama la API por carga de página.
// El margen FX (buffer ~1.5%) se aplica al mostrar/cobrar, no aquí.
export const updateExchangeRates = onSchedule(
  {
    schedule: "every 24 hours",
    timeZone: "America/Mexico_City",
    region: "us-central1",
  },
  async () => {
    logger.info("updateExchangeRates started");
    await updateExchangeRatesHandler();
    logger.info("updateExchangeRates finished");
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
export { enrichSessionLocation } from "./sessions";

// Post reactions
export { togglePostFlame } from "./postReactions";

// Post comments
export { toggleCommentFlame } from "./postComments";
export {
  onCommentDeletedCleanupImage,
  onCommentReplyDeletedCleanupImage,
} from "./commentImageCleanup";

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
export { checkRateLimitPost, checkRateLimitComment } from "./rateLimiter";

// Video overlay download
export { videoOverlayDownload } from "./videoOverlay";

// Descarga animada de saludos/consejos (Web Egress "hornea" intro + esquina + outro)
export { greetingAnimatedDownload } from "./greetingRender";

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

// Backfill de búsqueda de historias (corrida única, protegida por secret)
export { backfillStoriesSearch } from "./storiesBackfill";

// Backfill de liveId en el ledger (corrida única, idempotente)
export { backfillWalletLives } from "./walletLivesBackfill";

// Backfill de postId para tickets (premium_post / vod_ticket), corrida única
export { backfillTicketPostIds } from "./backfillTicketPostIds";

// Backfill de groupCategory en posts (descubrimiento Fase 2), corrida única
export { backfillPostGroupCategory } from "./backfillPostGroupCategory";

// Historias: contador de vistas (trigger) + backfill de categorías/vistas
export { onStoryViewed, backfillStoryDiscovery } from "./storyDiscovery";

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
