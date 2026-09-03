// Cloud Functions de experiencias, video y live.
// Webhooks HTTP y schedules permanecen en indexCompat.ts para conservar identidad.

export {
  createGreetingRequest,
  respondGreetingRequest,
  requestGreetingRefund,
  createGreetingMuxUpload,
} from "./greetingRequests";
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

export {
  createMuxDirectUpload,
  createMuxDonationUpload,
  createMuxGroupDonationUpload,
} from "./muxUploads";
export { onPostPlaybackProtection } from "./protectedPlayback";
export { getMuxPlaybackToken } from "./muxPlaybackToken";
export {
  createGreetingSampleUpload,
  updateGreetingSampleContext,
  deleteGreetingSample,
} from "./greetingSamples";
export { createMuxLiveStream } from "./liveMux";
export { createCFLiveInput } from "./liveCF";
export { cleanupLiveViewersOnEnd } from "./liveViewersCleanup";

export { getLivekitToken } from "./livekitTokens";
export {
  joinSession,
  endSession,
  forceCompleteSession,
  signalSessionClosing,
  finalizeMeetGreetRecording,
  finalizeExclusiveSessionRecording,
} from "./sessionLifecycle";
export { getRecordingDownloadUrl } from "./recordingDownload";

export {
  onStoryViewed,
  recordStoryPlay,
  onStoryCreatedPlaybackBackfill,
  backfillStoriesReelFields,
} from "./storyDiscovery";
export { cleanupDeletedMuxVideos } from "./muxOrphanCleanup";
export { toggleStoryLike } from "./storyLikes";
