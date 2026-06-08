//index

import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";

import { expireMeetGreetNoShowsHandler } from "./meetGreetRequests";
import { expireExclusiveSessionNoShowsHandler } from "./exclusiveSessionRequests";

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
export { updateProfileDisplayName } from "./profileSettings";

// Post reactions
export { togglePostFlame } from "./postReactions";

// Post comments
export { toggleCommentFlame } from "./postComments";

// Post saves
export {
  togglePostSave,
  onSavedPostsPostDeleted,
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

// Mux uploads
export { createMuxDirectUpload } from "./muxUploads";

// Mux webhooks
export { muxWebhook } from "./muxWebhooks";

// Shared communities
export { getSharedCommunitiesWithProfile } from "./sharedCommunities";

// Group deletion
export { softDeleteGroup } from "./groupDeletion";

// Rate limiting
export { checkRateLimitPost, checkRateLimitComment } from "./rateLimiter";
