//index

import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";

import { expireMeetGreetNoShowsHandler, autoExpirePendingMeetGreetRequestsHandler } from "./meetGreetRequests";
import { expireExclusiveSessionNoShowsHandler, autoExpirePendingExclusiveSessionRequestsHandler } from "./exclusiveSessionRequests";
import { autoExpirePendingGreetingRequestsHandler } from "./greetingRequests";
import { updateExchangeRatesHandler } from "./exchangeRates";

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
    schedule: "every 24 hours",
    timeZone: "America/Mexico_City",
    region: "us-central1",
  },
  async () => {
    logger.info("autoExpirePendingServiceRequests started");

    await Promise.all([
      autoExpirePendingGreetingRequestsHandler(),
      autoExpirePendingMeetGreetRequestsHandler(),
      autoExpirePendingExclusiveSessionRequestsHandler(),
    ]);

    logger.info("autoExpirePendingServiceRequests finished");
  }
);

// Tasas de cambio: actualiza el doc config/exchangeRates cada 6 horas.
export const updateExchangeRates = onSchedule(
  {
    schedule: "every 6 hours",
    timeZone: "America/Mexico_City",
    region: "us-central1",
  },
  async () => {
    logger.info("updateExchangeRates started");
    await updateExchangeRatesHandler();
    logger.info("updateExchangeRates finished");
  }
);

// Join requests
export { approveJoinRequest, rejectJoinRequest } from "./joinRequests";

// Invite links
export {
  createInviteLink,
  getInviteLinkPreview,
  consumeInviteLink,
} from "./inviteLinks";

// Sidebar groups
export { getMyHiddenJoinedGroups } from "./sidebarGroups";

// Greeting requests
export {
  createGreetingRequest,
  respondGreetingRequest,
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

// Post reactions
export { togglePostFlame } from "./postReactions";

// Post comments
export { toggleCommentFlame } from "./postComments";

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

// Mux uploads
export { createMuxDirectUpload, createMuxDonationUpload, createMuxGroupDonationUpload } from "./muxUploads";

// Mux webhooks
export { muxWebhook } from "./muxWebhooks";

// Shared communities
export { getSharedCommunitiesWithProfile } from "./sharedCommunities";

// Group deletion
export { softDeleteGroup } from "./groupDeletion";

// Rate limiting
export { checkRateLimitPost, checkRateLimitComment } from "./rateLimiter";

// Video overlay download
export { videoOverlayDownload } from "./videoOverlay";

// Live streams (Mux — OBS/RTMP flow)
export { createMuxLiveStream } from "./liveMux";

// Live streams (Cloudflare Stream — live directo desde browser)
export { createCFLiveInput } from "./liveCF";
export { cfWebhook } from "./cfWebhooks";

// Live viewers cleanup
export { cleanupLiveViewersOnEnd } from "./liveViewersCleanup";

// Live heartbeat cleanup — termina lives CF directos huérfanos (browser cerrado sin detener)
export { liveHeartbeatCleanup } from "./liveHeartbeatCleanup";

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

// KYC — verificación de identidad con Didit (habilita retiros del creador)
export { createKycSession, diditWebhook } from "./kyc";

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
