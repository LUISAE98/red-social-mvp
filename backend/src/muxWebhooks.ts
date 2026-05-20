import Mux from "@mux/mux-node";
import { getApps, initializeApp } from "firebase-admin/app";
import {
  FieldValue,
  getFirestore,
} from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";

if (!getApps().length) {
  initializeApp();
}

const db = getFirestore();

export const muxWebhookSecret = defineSecret("MUX_WEBHOOK_SECRET");

type MuxPassthrough = {
  postId?: string;
  authorId?: string;
  groupId?: string;
  source?: string;
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

async function markAssetReady(event: MuxWebhookEvent) {
  const assetId = event.data?.id ?? null;
  const uploadId = event.data?.upload_id ?? null;
  const duration =
    typeof event.data?.duration === "number" ? event.data.duration : null;
  const playbackId = getPublicPlaybackId(event);
  const passthrough = parsePassthrough(event.data?.passthrough);

  let postId = passthrough.postId ?? null;
  let authorId = passthrough.authorId ?? null;
  let groupId = passthrough.groupId ?? null;

  const uploadRef = await findMuxUploadDoc({
    uploadId,
    postId,
  });

  if ((!postId || !authorId || !groupId) && uploadRef) {
    const uploadSnap = await uploadRef.get();
    const uploadData = uploadSnap.data() ?? {};

    postId =
      postId ??
      (typeof uploadData.postId === "string" ? uploadData.postId : null);

    authorId =
      authorId ??
      (typeof uploadData.authorId === "string" ? uploadData.authorId : null);

    groupId =
      groupId ??
      (typeof uploadData.groupId === "string" ? uploadData.groupId : null);
  }

  if (!assetId || !postId || !playbackId) {
    logger.warn("muxWebhook asset.ready missing required data", {
      assetId,
      postId,
      playbackId,
      uploadId,
      hasUploadDoc: Boolean(uploadRef),
    });

    return;
  }

  const hlsUrl = `https://stream.mux.com/${playbackId}.m3u8`;
  const thumbnailUrl = `https://image.mux.com/${playbackId}/thumbnail.jpg`;

  const now = FieldValue.serverTimestamp();

  const postRef = db.collection("posts").doc(postId);

  const batch = db.batch();

  batch.set(
    postRef,
    {
      videoData: {
        provider: "mux",
        status: "ready",
        assetId,
        uploadId,
        playbackId,
        duration,
        thumbnailUrl,
        sourceUrl: null,
        sourcePath: null,
      },
      playback: {
        url: hlsUrl,
        hlsUrl,
        thumbnailUrl,
        provider: "mux",
        playbackId,
        duration,
        isReady: true,
      },
      processing: {
        status: "ready",
        provider: "mux",
        errorCode: null,
        errorMessage: null,
        updatedAt: now,
      },
      shareImageUrl: thumbnailUrl,
      updatedAt: now,
    },
    { merge: true }
  );

  if (uploadRef) {
    const uploadUpdate: Record<string, unknown> = {
      status: "ready",
      assetId,
      playbackId,
      duration,
      thumbnailUrl,
      hlsUrl,
      updatedAt: now,
    };

    if (authorId) {
      uploadUpdate.authorId = authorId;
    }

    if (groupId) {
      uploadUpdate.groupId = groupId;
    }

    if (postId) {
      uploadUpdate.postId = postId;
    }

    batch.set(uploadRef, uploadUpdate, { merge: true });
  }

  await batch.commit();
}

async function markAssetError(event: MuxWebhookEvent) {
  const assetId = event.data?.id ?? null;
  const uploadId = event.data?.upload_id ?? null;
  const passthrough = parsePassthrough(event.data?.passthrough);

  const postId = passthrough.postId ?? null;
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

  const batch = db.batch();

  if (postId) {
    batch.set(
      db.collection("posts").doc(postId),
      {
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

  if (uploadRef) {
    batch.set(
      uploadRef,
      {
        status: "error",
        assetId,
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
    errorCode,
  });
}

export const muxWebhook = onRequest(
  {
    region: "us-central1",
    secrets: [muxWebhookSecret],
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

    let event: any;

    try {
      mux.webhooks.verifySignature(
        rawBody,
        req.headers as any,
        muxWebhookSecret.value()
      );

      event = JSON.parse(rawBody);
    } catch (error) {
      logger.warn("muxWebhook invalid signature", {
        error: error instanceof Error ? error.message : String(error),
      });

      res.status(401).json({ error: "Invalid webhook signature" });
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

        default:
          break;
      }

      res.status(200).json({ received: true });
    } catch (error) {
      logger.error("muxWebhook processing failed", {
        type: event.type,
        error: error instanceof Error ? error.message : String(error),
      });

      res.status(500).json({ error: "Webhook processing failed" });
    }
  }
);