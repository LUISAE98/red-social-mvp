//muxWebhooks.ts

import Mux from "@mux/mux-node";
import { getApps, initializeApp } from "firebase-admin/app";
import {
  FieldValue,
  getFirestore,
  type DocumentReference,
  type DocumentData,
} from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";
import { createMuxClient, muxTokenId, muxTokenSecret } from "./mux";

if (!getApps().length) {
  initializeApp();
}

const db = getFirestore();

export const muxWebhookSecret = defineSecret("MUX_WEBHOOK_SECRET");

type MuxPassthrough = {
  postId?: string;
  authorId?: string;
  contextType?: "group" | "profile" | "greeting";
  groupId?: string | null;
  profileId?: string | null;
  mediaId?: string;
  mediaIndex?: number;
  source?: string;
  greetingRequestId?: string;
  creatorId?: string;
};

type MuxWebhookEvent = {
  type?: string;
  data?: {
    id?: string;
    upload_id?: string;
    duration?: number;
    passthrough?: string | null;
    playback_ids?: Array<{
      id?: string;
      policy?: string;
    }>;
    errors?: {
      type?: string;
      messages?: string[];
    };
    // live stream fields
    stream_key?: string;
    status?: string;
    active_asset_id?: string | null;
  };
};

function parsePassthrough(value: unknown): MuxPassthrough {
  if (typeof value !== "string" || !value.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as MuxPassthrough;

    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    return parsed;
  } catch {
    return {};
  }
}

function getPublicPlaybackId(event: MuxWebhookEvent): string | null {
  const playbackIds = event.data?.playback_ids;

  if (!Array.isArray(playbackIds) || playbackIds.length === 0) {
    return null;
  }

  const publicPlayback = playbackIds.find(
    (playback) => playback.policy === "public" && playback.id
  );

  return publicPlayback?.id ?? playbackIds[0]?.id ?? null;
}

function pickString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function isPostDeleted(postData: Record<string, unknown>): boolean {
  const searchData =
    postData.search && typeof postData.search === "object"
      ? (postData.search as Record<string, unknown>)
      : {};

  return (
    postData.isDeleted === true ||
    searchData.isDeleted === true ||
    Boolean(postData.deletedAt)
  );
}

function resolveCustomThumbnailUrl(value: Record<string, unknown> | null | undefined): string | null {
  if (!value) return null;

  return (
    pickString(value.customThumbnailUrl) ||
    pickString(value.coverUrl) ||
    pickString(value.coverImageUrl) ||
    pickString(value.thumbnailUrl) ||
    null
  );
}

async function findMuxUploadDoc(params: {
  uploadId?: string | null;
  postId?: string | null;
}) {
  if (params.uploadId) {
    const byUploadId = await db
      .collection("muxUploads")
      .doc(params.uploadId)
      .get();

    if (byUploadId.exists) {
      return byUploadId.ref;
    }
  }

  if (params.postId) {
    const byPostId = await db
      .collection("muxUploads")
      .where("postId", "==", params.postId)
      .limit(1)
      .get();

    if (!byPostId.empty) {
      return byPostId.docs[0].ref;
    }
  }

  return null;
}

async function markGreetingAssetReady(params: {
  greetingRequestId: string;
  assetId: string;
  playbackId: string;
  duration: number | null;
  uploadId: string | null;
  uploadRef: DocumentReference<DocumentData> | null;
}) {
  const { greetingRequestId, assetId, playbackId, duration, uploadRef } = params;
  const now = FieldValue.serverTimestamp();
  const hlsUrl = `https://stream.mux.com/${playbackId}.m3u8`;

  const greetingRef = db.collection("greetingRequests").doc(greetingRequestId);

  await db.runTransaction(async (tx) => {
    const greetingSnap = await tx.get(greetingRef);
    if (!greetingSnap.exists) {
      logger.warn("muxWebhook greeting asset.ready: greeting not found", {
        greetingRequestId,
      });
      return;
    }

    tx.update(greetingRef, {
      muxAssetId: assetId,
      muxPlaybackId: playbackId,
      muxHlsUrl: hlsUrl,
      videoDuration: duration,
      videoStatus: "ready",
      status: "delivered",
      deliveredAt: now,
      updatedAt: now,
    });

    if (uploadRef) {
      tx.set(
        uploadRef,
        {
          status: "ready",
          assetId,
          playbackId,
          duration,
          hlsUrl,
          updatedAt: now,
        },
        { merge: true }
      );
    }
  });

  logger.info("muxWebhook greeting asset.ready processed", {
    greetingRequestId,
    assetId,
    playbackId,
  });
}

async function markDonationVideoAssetReady(params: {
  profileId: string;
  assetId: string;
  playbackId: string;
  duration: number | null;
  uploadRef: DocumentReference<DocumentData> | null;
}) {
  const { profileId, assetId, playbackId, duration, uploadRef } = params;
  const now = FieldValue.serverTimestamp();
  const hlsUrl = `https://stream.mux.com/${playbackId}.m3u8`;

  await db.collection("users").doc(profileId).update({
    "donation.playbackId": playbackId,
    "donation.videoUrl": hlsUrl,
    "donation.videoStatus": "ready",
    updatedAt: now,
  });

  if (uploadRef) {
    await uploadRef.set(
      { status: "ready", assetId, playbackId, duration, hlsUrl, updatedAt: now },
      { merge: true }
    );
  }

  logger.info("muxWebhook donation video asset.ready processed", { profileId, assetId, playbackId });
}

async function markGroupDonationVideoAssetReady(params: {
  groupId: string;
  assetId: string;
  playbackId: string;
  duration: number | null;
  uploadRef: DocumentReference<DocumentData> | null;
}) {
  const { groupId, assetId, playbackId, duration, uploadRef } = params;
  const now = FieldValue.serverTimestamp();
  const hlsUrl = `https://stream.mux.com/${playbackId}.m3u8`;

  await db.collection("groups").doc(groupId).update({
    "donation.playbackId": playbackId,
    "donation.videoUrl": hlsUrl,
    "donation.videoStatus": "ready",
    updatedAt: now,
  });

  if (uploadRef) {
    await uploadRef.set(
      { status: "ready", assetId, playbackId, duration, hlsUrl, updatedAt: now },
      { merge: true }
    );
  }

  logger.info("muxWebhook group donation video asset.ready processed", { groupId, assetId, playbackId });
}

async function markAssetReady(event: MuxWebhookEvent) {
  const assetId = event.data?.id ?? null;
  const uploadId = event.data?.upload_id ?? null;
  const duration =
    typeof event.data?.duration === "number" ? event.data.duration : null;
  const playbackId = getPublicPlaybackId(event);
  const passthrough = parsePassthrough(event.data?.passthrough);

  let postId = passthrough.postId ?? null;
  let authorId = passthrough.authorId ?? null;
  let contextType: "group" | "profile" | "greeting" =
    passthrough.contextType === "profile"
      ? "profile"
      : passthrough.contextType === "greeting"
        ? "greeting"
        : "group";
  let groupId = passthrough.groupId ?? null;
  let profileId = passthrough.profileId ?? null;
  let mediaId = passthrough.mediaId ?? null;
  let mediaIndex =
    typeof passthrough.mediaIndex === "number" &&
    Number.isInteger(passthrough.mediaIndex)
      ? passthrough.mediaIndex
      : null;
  let greetingRequestId: string | null = passthrough.greetingRequestId ?? null;
  let uploadCustomThumbnailUrl: string | null = null;

  const uploadRef = await findMuxUploadDoc({
    uploadId,
    postId,
  });

  if (
    (
      !postId ||
      !authorId ||
      !mediaId ||
      mediaIndex === null ||
      !greetingRequestId ||
      (contextType === "group" && !groupId) ||
      (contextType === "profile" && !profileId)
    ) &&
    uploadRef
  ) {
    const uploadSnap = await uploadRef.get();
    const uploadData = uploadSnap.data() ?? {};

    postId =
      postId ??
      (typeof uploadData.postId === "string" ? uploadData.postId : null);

    authorId =
      authorId ??
      (typeof uploadData.authorId === "string" ? uploadData.authorId : null);

    if (uploadData.contextType === "greeting") {
      contextType = "greeting";
    } else if (uploadData.contextType === "profile") {
      contextType = "profile";
    }

    groupId =
      groupId ??
      (typeof uploadData.groupId === "string" ? uploadData.groupId : null);

    profileId =
      profileId ??
      (typeof uploadData.profileId === "string" ? uploadData.profileId : null);

    mediaId =
      mediaId ??
      (typeof uploadData.mediaId === "string" ? uploadData.mediaId : null);

    mediaIndex =
      mediaIndex ??
      (typeof uploadData.mediaIndex === "number" &&
      Number.isInteger(uploadData.mediaIndex)
        ? uploadData.mediaIndex
        : null);

    greetingRequestId =
      greetingRequestId ??
      (typeof uploadData.greetingRequestId === "string"
        ? uploadData.greetingRequestId
        : null);
  }

  // Handle group donation video uploads — update group donation settings, no post document
  const uploadData = uploadRef ? (await uploadRef.get()).data() ?? {} : {};
  const isGroupDonationVideo =
    passthrough.source === "vibra-group-donation-video" ||
    uploadData.source === "group-donation";

  if (isGroupDonationVideo) {
    const resolvedGroupId =
      (typeof passthrough.groupId === "string" && passthrough.groupId) ||
      (typeof uploadData.groupId === "string" && uploadData.groupId) ||
      null;

    if (!resolvedGroupId || !assetId || !playbackId) {
      logger.warn("muxWebhook group donation video asset.ready missing data", {
        groupId: resolvedGroupId,
        assetId,
        playbackId,
        uploadId,
      });
      return;
    }

    await markGroupDonationVideoAssetReady({
      groupId: resolvedGroupId,
      assetId,
      playbackId,
      duration,
      uploadRef,
    });
    return;
  }

  // Handle donation video uploads — update profile donation settings, no post document
  const isDonationVideo =
    passthrough.source === "vibra-donation-video" ||
    uploadData.source === "donation";

  if (isDonationVideo) {
    const resolvedProfileId =
      profileId ??
      (typeof uploadData.profileId === "string" ? uploadData.profileId : null);

    if (!resolvedProfileId || !assetId || !playbackId) {
      logger.warn("muxWebhook donation video asset.ready missing data", {
        profileId: resolvedProfileId,
        assetId,
        playbackId,
        uploadId,
      });
      return;
    }

    await markDonationVideoAssetReady({
      profileId: resolvedProfileId,
      assetId,
      playbackId,
      duration,
      uploadRef,
    });
    return;
  }

  // Handle greeting uploads separately — no post document to update
  if (contextType === "greeting") {
    if (!greetingRequestId || !assetId || !playbackId) {
      logger.warn("muxWebhook greeting asset.ready missing required data", {
        greetingRequestId,
        assetId,
        playbackId,
        uploadId,
      });
      return;
    }

    await markGreetingAssetReady({
      greetingRequestId,
      assetId,
      playbackId,
      duration,
      uploadId,
      uploadRef,
    });
    return;
  }

  if (uploadRef) {
    const uploadSnap = await uploadRef.get();
    uploadCustomThumbnailUrl = resolveCustomThumbnailUrl(uploadSnap.data() ?? {});
  }

  if (!assetId || !postId || !playbackId) {
    logger.warn("muxWebhook asset.ready missing required data", {
      assetId,
      postId,
      playbackId,
      uploadId,
      mediaId,
      mediaIndex,
      hasUploadDoc: Boolean(uploadRef),
    });

    return;
  }

  const hlsUrl = `https://stream.mux.com/${playbackId}.m3u8`;
  const muxThumbnailUrl = `https://image.mux.com/${playbackId}/thumbnail.jpg`;

  const now = FieldValue.serverTimestamp();
  const postRef = db.collection("posts").doc(postId);

  // Flag set inside the transaction if this is a live stream recording
  let isLiveRecording = false;

  await db.runTransaction(async (transaction) => {
    const postSnap = await transaction.get(postRef);

    if (!postSnap.exists) {
      logger.warn("muxWebhook asset.ready post not found", {
        postId,
        uploadId,
        mediaId,
        mediaIndex,
      });

      return;
    }

    const postData = postSnap.data() ?? {};
        if (isPostDeleted(postData)) {
      logger.info("muxWebhook asset.ready ignored for deleted post", {
        postId,
        uploadId,
        mediaId,
        mediaIndex,
      });

      return;
    }

    // Detect live stream recording: live post with no mediaId in passthrough
    if (postData.postType === "live" && !passthrough.mediaId) {
      isLiveRecording = true;
    }

    const currentMedia = Array.isArray(postData.media) ? postData.media : [];

    let matchedMedia = false;
    let matchedThumbnailUrl = uploadCustomThumbnailUrl;

    const nextMedia = currentMedia.map((item) => {
      if (!item || typeof item !== "object") {
        return item;
      }

      const mediaItem = item as Record<string, unknown>;

      const matchesByMediaId =
        mediaId &&
        typeof mediaItem.id === "string" &&
        mediaItem.id === mediaId;

      const matchesByUploadId =
        uploadId &&
        typeof mediaItem.uploadId === "string" &&
        mediaItem.uploadId === uploadId;

      const matchesByIndex =
        mediaIndex !== null &&
        typeof mediaItem.index === "number" &&
        mediaItem.index === mediaIndex;

      if (mediaItem.type !== "video" || (!matchesByMediaId && !matchesByUploadId && !matchesByIndex)) {
        return item;
      }

      matchedMedia = true;

      const existingThumbnailUrl = resolveCustomThumbnailUrl(mediaItem);
      const thumbnailUrl = existingThumbnailUrl || uploadCustomThumbnailUrl || muxThumbnailUrl;
      matchedThumbnailUrl = thumbnailUrl;

      return {
        ...mediaItem,
        type: "video",
        id: typeof mediaItem.id === "string" ? mediaItem.id : mediaId ?? undefined,
        index: typeof mediaItem.index === "number" ? mediaItem.index : mediaIndex ?? undefined,
        url: hlsUrl,
        thumbnailUrl,
        customThumbnailUrl: existingThumbnailUrl || uploadCustomThumbnailUrl || null,
        muxThumbnailUrl,
        provider: "mux",
        status: "ready",
        uploadId,
        assetId,
        playbackId,
        hlsUrl,
        duration,
      };
    });

    const videoItems = nextMedia.filter((item) => {
      return item && typeof item === "object" && (item as Record<string, unknown>).type === "video";
    });

    const allVideosReady =
      videoItems.length > 0 &&
      videoItems.every((item) => {
        const mediaItem = item as Record<string, unknown>;
        return mediaItem.status === "ready";
      });

    const firstVideo = videoItems[0] as Record<string, unknown> | undefined;

    const shouldUpdateRootVideo =
      !firstVideo ||
      firstVideo.uploadId === uploadId ||
      firstVideo.id === mediaId ||
      postData.videoData == null ||
      typeof (postData.videoData as Record<string, unknown>)?.playbackId !== "string";

    const currentVideoData =
      postData.videoData && typeof postData.videoData === "object"
        ? (postData.videoData as Record<string, unknown>)
        : null;

    const currentPlayback =
      postData.playback && typeof postData.playback === "object"
        ? (postData.playback as Record<string, unknown>)
        : null;

    const rootThumbnailUrl =
      matchedThumbnailUrl ||
      resolveCustomThumbnailUrl(currentVideoData) ||
      resolveCustomThumbnailUrl(currentPlayback) ||
      muxThumbnailUrl;

    const postUpdate: Record<string, unknown> = {
      updatedAt: now,
      processing: {
        status: allVideosReady ? "ready" : "uploading",
        provider: "mux",
        errorCode: null,
        errorMessage: null,
        updatedAt: now,
      },
    };

    if (matchedMedia) {
      postUpdate.media = nextMedia;
    }

    if (!postData.shareImageUrl) {
      postUpdate.shareImageUrl = rootThumbnailUrl;
    }

    if (shouldUpdateRootVideo) {
      postUpdate.videoData = {
        ...(currentVideoData ?? {}),
        provider: "mux",
        status: "ready",
        assetId,
        uploadId,
        playbackId,
        duration,
        thumbnailUrl: rootThumbnailUrl,
        customThumbnailUrl:
          resolveCustomThumbnailUrl(currentVideoData) || uploadCustomThumbnailUrl || null,
        muxThumbnailUrl,
        sourceUrl: null,
        sourcePath: null,
      };

      postUpdate.playback = {
        ...(currentPlayback ?? {}),
        url: hlsUrl,
        hlsUrl,
        thumbnailUrl: rootThumbnailUrl,
        customThumbnailUrl:
          resolveCustomThumbnailUrl(currentPlayback) || uploadCustomThumbnailUrl || null,
        muxThumbnailUrl,
        provider: "mux",
        playbackId,
        duration,
        isReady: true,
      };
    }

    transaction.set(postRef, postUpdate, { merge: true });

    if (uploadRef) {
      const uploadUpdate: Record<string, unknown> = {
        status: "ready",
        assetId,
        playbackId,
        duration,
        thumbnailUrl: rootThumbnailUrl,
        customThumbnailUrl: uploadCustomThumbnailUrl,
        muxThumbnailUrl,
        hlsUrl,
        updatedAt: now,
      };

      if (authorId) uploadUpdate.authorId = authorId;
      uploadUpdate.contextType = contextType;
      uploadUpdate.groupId = groupId ?? null;
      uploadUpdate.profileId = profileId ?? null;
      if (postId) uploadUpdate.postId = postId;
      if (mediaId) uploadUpdate.mediaId = mediaId;
      if (mediaIndex !== null) uploadUpdate.mediaIndex = mediaIndex;

      transaction.set(uploadRef, uploadUpdate, { merge: true });
    }
  });

  // After transaction: for live recordings mark the VOD as ready inside liveData
  if (isLiveRecording && playbackId) {
    try {
      await postRef.update({
        "liveData.vodStatus": "ready",
        createdAt: now,
        updatedAt: now,
      });
      logger.info("muxWebhook live recording ready → vodStatus=ready", { postId, assetId, playbackId });
    } catch (err) {
      logger.warn("muxWebhook vodStatus update failed", { postId, err });
    }
  }
}

async function markAssetError(event: MuxWebhookEvent) {
  const assetId = event.data?.id ?? null;
  const uploadId = event.data?.upload_id ?? null;
  const passthrough = parsePassthrough(event.data?.passthrough);

  let postId = passthrough.postId ?? null;
  let contextType =
    passthrough.contextType === "profile" ? "profile" : "group";
  let groupId = passthrough.groupId ?? null;
  let profileId = passthrough.profileId ?? null;
  let mediaId = passthrough.mediaId ?? null;
  let mediaIndex =
    typeof passthrough.mediaIndex === "number" &&
    Number.isInteger(passthrough.mediaIndex)
      ? passthrough.mediaIndex
      : null;

  const errorCode = event.data?.errors?.type ?? "mux_processing_error";
  const errorMessage =
    Array.isArray(event.data?.errors?.messages) &&
    event.data.errors.messages.length > 0
      ? event.data.errors.messages.join(" | ")
      : "Mux no pudo procesar el video.";

  if (!postId && !uploadId) {
    logger.warn("muxWebhook asset.error missing postId/uploadId", {
      assetId,
      uploadId,
    });

    return;
  }

  const now = FieldValue.serverTimestamp();

  const uploadRef = await findMuxUploadDoc({
    uploadId,
    postId,
  });

  if ((!postId || !mediaId || mediaIndex === null) && uploadRef) {
    const uploadSnap = await uploadRef.get();
    const uploadData = uploadSnap.data() ?? {};

    postId =
      postId ??
      (typeof uploadData.postId === "string" ? uploadData.postId : null);

    contextType =
      uploadData.contextType === "profile" ? "profile" : contextType;

    groupId =
      groupId ??
      (typeof uploadData.groupId === "string" ? uploadData.groupId : null);

    profileId =
      profileId ??
      (typeof uploadData.profileId === "string" ? uploadData.profileId : null);

    mediaId =
      mediaId ??
      (typeof uploadData.mediaId === "string" ? uploadData.mediaId : null);

    mediaIndex =
      mediaIndex ??
      (typeof uploadData.mediaIndex === "number" &&
      Number.isInteger(uploadData.mediaIndex)
        ? uploadData.mediaIndex
        : null);
  }

  const batch = db.batch();

  if (postId) {
    const postRef = db.collection("posts").doc(postId);
    const postSnap = await postRef.get();

    if (postSnap.exists) {
      const postData = postSnap.data() ?? {};
            if (isPostDeleted(postData)) {
        logger.info("muxWebhook asset.error ignored for deleted post", {
          postId,
          uploadId,
          mediaId,
          mediaIndex,
        });

        return;
      }
      const currentMedia = Array.isArray(postData.media) ? postData.media : [];

      const nextMedia = currentMedia.map((item) => {
        if (!item || typeof item !== "object") {
          return item;
        }

        const mediaItem = item as Record<string, unknown>;

        const matchesByMediaId =
          mediaId &&
          typeof mediaItem.id === "string" &&
          mediaItem.id === mediaId;

        const matchesByUploadId =
          uploadId &&
          typeof mediaItem.uploadId === "string" &&
          mediaItem.uploadId === uploadId;

        const matchesByIndex =
          mediaIndex !== null &&
          typeof mediaItem.index === "number" &&
          mediaItem.index === mediaIndex;

        if (mediaItem.type !== "video" || (!matchesByMediaId && !matchesByUploadId && !matchesByIndex)) {
          return item;
        }

        return {
          ...mediaItem,
          status: "error",
          assetId,
          uploadId,
        };
      });

      batch.set(
        postRef,
        {
          media: nextMedia,
          videoData: {
            status: "error",
            assetId,
            uploadId,
          },
          processing: {
            status: "error",
            provider: "mux",
            errorCode,
            errorMessage,
            updatedAt: now,
          },
          updatedAt: now,
        },
        { merge: true }
      );
    }
  }

  if (uploadRef) {
    batch.set(
      uploadRef,
      {
        status: "error",
        assetId,
        contextType,
        groupId: groupId ?? null,
        profileId: profileId ?? null,
        errorCode,
        errorMessage,
        updatedAt: now,
      },
      { merge: true }
    );
  }

  await batch.commit();

  logger.warn("muxWebhook asset.error processed", {
    assetId,
    uploadId,
    postId,
    mediaId,
    mediaIndex,
    errorCode,
  });
}

async function resolvePostRefByLiveStreamId(
  event: MuxWebhookEvent
): Promise<{ ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> } | null> {
  const liveStreamId = event.data?.id;
  if (!liveStreamId) return null;

  const passthrough = parsePassthrough(event.data?.passthrough);
  const postId = passthrough.postId;

  if (postId) {
    const ref = db.collection("posts").doc(postId);
    const snap = await ref.get();
    if (!snap.exists) return null;
    return { ref, data: snap.data() ?? {} };
  }

  const q = await db
    .collection("posts")
    .where("liveData.liveStreamId", "==", liveStreamId)
    .limit(1)
    .get();
  if (q.empty) return null;
  return { ref: q.docs[0].ref, data: q.docs[0].data() };
}

async function handleLiveStreamActive(event: MuxWebhookEvent) {
  const result = await resolvePostRefByLiveStreamId(event);
  if (!result) {
    logger.warn("muxWebhook live_stream.active: post not found", { liveStreamId: event.data?.id });
    return;
  }

  const now = FieldValue.serverTimestamp();
  const postId = result.ref.id;
  const authorId = typeof result.data.authorId === "string" ? result.data.authorId : null;
  const groupId = typeof result.data.groupId === "string" ? result.data.groupId : null;

  const updates: Array<Promise<unknown>> = [
    result.ref.update({
      "liveData.status": "live",
      "liveData.startedAt": now,
      createdAt: now,
      updatedAt: now,
    }),
  ];

  const broadcastGroupIds: string[] = Array.isArray(
    (result.data.liveData as Record<string, unknown> | undefined)?.broadcastGroupIds
  )
    ? ((result.data.liveData as Record<string, unknown>).broadcastGroupIds as string[]).filter(
        (id) => typeof id === "string" && id && id !== groupId
      )
    : [];

  if (authorId) {
    updates.push(
      db.collection("users").doc(authorId).update({ activeLivePostId: postId })
    );
  }
  if (groupId) {
    updates.push(
      db.collection("groups").doc(groupId).update({ activeLivePostId: postId })
    );
  }
  for (const gid of broadcastGroupIds) {
    updates.push(db.collection("groups").doc(gid).update({ activeLivePostId: postId }));
  }

  await Promise.all(updates);

  // Ensure reconnect_window is 0 on every live activation so existing streams
  // (created before this setting was added) also behave correctly.
  const liveStreamId = event.data?.id as string | undefined;
  if (liveStreamId) {
    try {
      const mux = createMuxClient();
      await mux.video.liveStreams.update(liveStreamId, { reconnect_window: 0 });
      logger.info("muxWebhook live_stream.active: reconnect_window set to 0", { liveStreamId });
    } catch (err) {
      logger.warn("muxWebhook live_stream.active: failed to update reconnect_window", { liveStreamId, err });
    }
  }

  logger.info("muxWebhook live_stream.active processed", { liveStreamId: event.data?.id, postId });
}

async function handleLiveStreamIdle(event: MuxWebhookEvent) {
  // Wait for viewers' HLS buffers to drain before marking the stream as ended.
  // With reconnect_window=0, Mux closes the HLS stream immediately when OBS
  // disconnects, but viewers typically have 4-12 seconds of buffered content.
  // Without this delay, the "ended" overlay flashes briefly while the buffer
  // is still playing, then the live resumes until the buffer is exhausted.
  await new Promise((resolve) => setTimeout(resolve, 15000));

  const result = await resolvePostRefByLiveStreamId(event);
  if (!result) {
    logger.warn("muxWebhook live_stream.idle: post not found", { liveStreamId: event.data?.id });
    return;
  }

  const currentStatus = (result.data.liveData as Record<string, unknown> | undefined)?.status;
  if (currentStatus !== "live") return;

  const now = FieldValue.serverTimestamp();

  const updateData: Record<string, unknown> = {
    "liveData.status": "ended",
    "liveData.endedAt": now,
    "liveData.vodStatus": "processing",
    updatedAt: now,
  };

  const authorId = typeof result.data.authorId === "string" ? result.data.authorId : null;
  const groupId = typeof result.data.groupId === "string" ? result.data.groupId : null;

  const stopBroadcastGroupIds: string[] = Array.isArray(
    (result.data.liveData as Record<string, unknown> | undefined)?.broadcastGroupIds
  )
    ? ((result.data.liveData as Record<string, unknown>).broadcastGroupIds as string[]).filter(
        (id) => typeof id === "string" && id && id !== groupId
      )
    : [];

  // Pinning is intentionally NOT cleared here — the creator decides via the
  // end-of-stream summary panel in the frontend (LiveEndSummaryPanel).
  const cleanupUpdates: Array<Promise<unknown>> = [result.ref.update(updateData)];

  if (authorId) {
    cleanupUpdates.push(
      db.collection("users").doc(authorId).update({ activeLivePostId: FieldValue.delete() })
    );
  }
  if (groupId) {
    cleanupUpdates.push(
      db.collection("groups").doc(groupId).update({ activeLivePostId: FieldValue.delete() })
    );
  }
  for (const gid of stopBroadcastGroupIds) {
    cleanupUpdates.push(db.collection("groups").doc(gid).update({ activeLivePostId: FieldValue.delete() }));
  }

  await Promise.all(cleanupUpdates);

  logger.info("muxWebhook live_stream.idle → ended", {
    liveStreamId: event.data?.id,
  });
}

export const muxWebhook = onRequest(
  {
    region: "us-central1",
    secrets: [muxWebhookSecret, muxTokenId, muxTokenSecret],
    timeoutSeconds: 120,
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const rawBody = req.rawBody?.toString("utf8");

    if (!rawBody) {
      logger.warn("muxWebhook missing raw body");
      res.status(400).json({ error: "Missing raw body" });
      return;
    }

    const mux = new Mux({
      webhookSecret: muxWebhookSecret.value(),
    });

    let event: MuxWebhookEvent;

    try {
      mux.webhooks.verifySignature(
        rawBody,
        req.headers as Record<string, string | string[] | undefined>,
        muxWebhookSecret.value()
      );

      event = JSON.parse(rawBody) as MuxWebhookEvent;
    } catch (error) {
      logger.warn("muxWebhook invalid signature", {
        error: error instanceof Error ? error.message : String(error),
      });

      res.status(401).json({ error: "Invalid webhook signature" });
      return;
    }

    // For live_stream.idle, respond to Mux immediately (5-second timeout) then
    // apply a delay so the HLS player buffer drains before the UI transitions
    // to "ended". Without this, viewers see a flash: the "ended" overlay
    // appears while the stream's latency buffer is still playing.
    if (event.type === "video.live_stream.idle") {
      res.status(200).json({ received: true });
      await handleLiveStreamIdle(event).catch((err) =>
        logger.error("muxWebhook live_stream.idle deferred error", {
          error: err instanceof Error ? err.message : String(err),
        })
      );
      return;
    }

    try {
      switch (event.type) {
        case "video.asset.ready":
          await markAssetReady(event);
          break;

        case "video.asset.errored":
          await markAssetError(event);
          break;

        case "video.live_stream.active":
          await handleLiveStreamActive(event);
          break;

        default:
          break;
      }

      res.status(200).json({ received: true });
    } catch (error) {
      logger.error("muxWebhook processing failed", {
        type: event.type ?? "unknown",
        error: error instanceof Error ? error.message : String(error),
      });

      res.status(500).json({ error: "Webhook processing failed" });
    }
  }
);
