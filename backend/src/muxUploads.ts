import { getApps, initializeApp } from "firebase-admin/app";
import {
  FieldValue,
  getFirestore,
} from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import {
  createMuxClient,
  muxTokenId,
  muxTokenSecret,
} from "./mux";

if (!getApps().length) {
  initializeApp();
}

const db = getFirestore();

const MUX_UPLOAD_STALE_MS = 1000 * 60 * 60; // 1 hora
const MUX_UPLOAD_CLEANUP_LIMIT = 25;

type CreateMuxDirectUploadRequest = {
  contextType?: "group" | "profile";
  groupId?: string | null;
  profileId?: string | null;
  postId?: string;
  mediaIndex?: number;
  customThumbnailUrl?: string | null;
  thumbnailUrl?: string | null;
};

function normalizeRequiredString(value: unknown, fieldName: string) {
  const normalized = typeof value === "string" ? value.trim() : "";

  if (!normalized) {
    throw new HttpsError("invalid-argument", `${fieldName} es requerido.`);
  }

  return normalized;
}

function normalizeOptionalUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const cleanValue = value.trim();

  if (!cleanValue) return null;

  if (
    cleanValue.startsWith("https://") ||
    cleanValue.startsWith("http://") ||
    cleanValue.startsWith("blob:") ||
    cleanValue.startsWith("data:image/")
  ) {
    return cleanValue;
  }

  return null;
}

function isReadableMemberStatus(status: unknown) {
  return status === "active" || status === "subscribed" || status === "muted";
}

function isPostingAllowedMemberStatus(status: unknown) {
  return status === "active" || status === "subscribed";
}

async function expireStaleMuxUploads(params: {
  uid: string;
  contextType: "group" | "profile";
  groupId: string | null;
  profileId: string | null;
}) {
  const cutoff = Date.now() - MUX_UPLOAD_STALE_MS;

  let staleQuery = db
    .collection("muxUploads")
    .where("authorId", "==", params.uid)
    .where("contextType", "==", params.contextType)
    .where("status", "==", "waiting_for_upload")
    .limit(MUX_UPLOAD_CLEANUP_LIMIT);

  if (params.contextType === "group") {
    staleQuery = staleQuery.where("groupId", "==", params.groupId);
  } else {
    staleQuery = staleQuery.where("profileId", "==", params.profileId);
  }

  const staleCandidatesSnap = await staleQuery.get();

  if (staleCandidatesSnap.empty) return;

  const batch = db.batch();
  let hasUpdates = false;

  staleCandidatesSnap.docs.forEach((uploadDoc) => {
    const data = uploadDoc.data();
    const createdAtMillis =
      typeof data.createdAt?.toMillis === "function"
        ? data.createdAt.toMillis()
        : null;

    if (createdAtMillis !== null && createdAtMillis < cutoff) {
      batch.update(uploadDoc.ref, {
        status: "expired",
        statusReason: "upload_not_completed_before_expiration",
        updatedAt: FieldValue.serverTimestamp(),
      });

      hasUpdates = true;
    }
  });

  if (hasUpdates) {
    await batch.commit();
  }
}

async function assertCanCreateMuxUpload(uid: string, groupId: string) {
  const groupRef = db.collection("groups").doc(groupId);
  const memberRef = groupRef.collection("members").doc(uid);

  const [groupSnap, memberSnap] = await Promise.all([
    groupRef.get(),
    memberRef.get(),
  ]);

  if (!groupSnap.exists) {
    throw new HttpsError("not-found", "La comunidad no existe.");
  }

  const group = groupSnap.data() || {};

  if (group.isActive === false) {
    throw new HttpsError(
      "failed-precondition",
      "La comunidad no está activa."
    );
  }

  if (group.ownerId === uid) {
    return;
  }

  if (!memberSnap.exists) {
    throw new HttpsError(
      "permission-denied",
      "No perteneces a esta comunidad."
    );
  }

  const member = memberSnap.data() || {};
  const status =
    typeof member.status === "string" ? member.status : "active";

  if (!isReadableMemberStatus(status)) {
    throw new HttpsError(
      "permission-denied",
      "Tu membresía no permite publicar en esta comunidad."
    );
  }

  if (!isPostingAllowedMemberStatus(status)) {
    throw new HttpsError(
      "permission-denied",
      "Tu estado actual no permite publicar videos."
    );
  }

  const postingMode =
    group.permissions &&
    typeof group.permissions === "object" &&
    group.permissions.postingMode === "owner_only"
      ? "owner_only"
      : "members";

  if (postingMode === "owner_only") {
    throw new HttpsError(
      "permission-denied",
      "Solo el owner puede publicar en esta comunidad."
    );
  }
}
async function assertCanCreateProfileMuxUpload(uid: string, profileId: string) {
  if (profileId !== uid) {
    throw new HttpsError(
      "permission-denied",
      "Solo puedes subir video a tu propio perfil."
    );
  }

  const profileSnap = await db.collection("users").doc(profileId).get();

  if (!profileSnap.exists) {
    throw new HttpsError("not-found", "El perfil no existe.");
  }
}

export const createMuxDonationUpload = onCall<{ profileId: string }>(
  {
    region: "us-central1",
    secrets: [muxTokenId, muxTokenSecret],
  },
  async (request) => {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError("unauthenticated", "Debes iniciar sesión para subir video.");
    }

    const profileId = normalizeRequiredString(request.data?.profileId, "profileId");

    await assertCanCreateProfileMuxUpload(uid, profileId);

    const originHeader = request.rawRequest.headers.origin;
    const corsOrigin =
      typeof originHeader === "string" && originHeader.trim()
        ? originHeader.trim()
        : "*";

    const mux = createMuxClient();

    let upload: Awaited<ReturnType<typeof mux.video.uploads.create>>;

    try {
      upload = await mux.video.uploads.create({
        cors_origin: corsOrigin,
        new_asset_settings: {
          playback_policy: ["public"],
          video_quality: "plus",
          mp4_support: "standard",
          passthrough: JSON.stringify({
            authorId: uid,
            profileId,
            source: "vibra-donation-video",
          }),
        },
      });
    } catch (error) {
      console.error("createMuxDonationUpload Mux upload creation failed", error);
      throw new HttpsError("internal", "No se pudo crear la subida de video en Mux.");
    }

    const now = FieldValue.serverTimestamp();

    await db.collection("muxUploads").doc(upload.id).set({
      provider: "mux",
      uploadId: upload.id,
      authorId: uid,
      profileId,
      source: "donation",
      status: "waiting_for_upload",
      assetId: null,
      playbackId: null,
      createdAt: now,
      updatedAt: now,
    });

    return {
      uploadId: upload.id,
      uploadUrl: upload.url,
    };
  }
);

export const createMuxGroupDonationUpload = onCall<{ groupId: string }>(
  {
    region: "us-central1",
    secrets: [muxTokenId, muxTokenSecret],
  },
  async (request) => {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError("unauthenticated", "Debes iniciar sesión para subir video.");
    }

    const groupId = normalizeRequiredString(request.data?.groupId, "groupId");

    const groupSnap = await db.collection("groups").doc(groupId).get();

    if (!groupSnap.exists) {
      throw new HttpsError("not-found", "La comunidad no existe.");
    }

    const group = groupSnap.data() || {};

    if (group.ownerId !== uid) {
      throw new HttpsError("permission-denied", "Solo el owner puede configurar el video de donación.");
    }

    const originHeader = request.rawRequest.headers.origin;
    const corsOrigin =
      typeof originHeader === "string" && originHeader.trim()
        ? originHeader.trim()
        : "*";

    const mux = createMuxClient();

    let upload: Awaited<ReturnType<typeof mux.video.uploads.create>>;

    try {
      upload = await mux.video.uploads.create({
        cors_origin: corsOrigin,
        new_asset_settings: {
          playback_policy: ["public"],
          video_quality: "plus",
          mp4_support: "standard",
          passthrough: JSON.stringify({
            authorId: uid,
            groupId,
            source: "vibra-group-donation-video",
          }),
        },
      });
    } catch (error) {
      console.error("createMuxGroupDonationUpload Mux upload creation failed", error);
      throw new HttpsError("internal", "No se pudo crear la subida de video en Mux.");
    }

    const now = FieldValue.serverTimestamp();

    await db.collection("muxUploads").doc(upload.id).set({
      provider: "mux",
      uploadId: upload.id,
      authorId: uid,
      groupId,
      source: "group-donation",
      status: "waiting_for_upload",
      assetId: null,
      playbackId: null,
      createdAt: now,
      updatedAt: now,
    });

    return {
      uploadId: upload.id,
      uploadUrl: upload.url,
    };
  }
);

export const createMuxDirectUpload = onCall<CreateMuxDirectUploadRequest>(
  {
    region: "us-central1",
    secrets: [muxTokenId, muxTokenSecret],
  },
  async (request) => {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError(
        "unauthenticated",
        "Debes iniciar sesión para subir video."
      );
    }

    const contextType =
      request.data?.contextType === "profile" ? "profile" : "group";

    const groupId =
      contextType === "group"
        ? normalizeRequiredString(request.data?.groupId, "groupId")
        : null;

    const profileId =
      contextType === "profile"
        ? normalizeRequiredString(request.data?.profileId, "profileId")
        : null;

    if (contextType === "group") {
      await assertCanCreateMuxUpload(uid, groupId as string);
    } else {
      await assertCanCreateProfileMuxUpload(uid, profileId as string);
    }

    await expireStaleMuxUploads({
      uid,
      contextType,
      groupId,
      profileId,
    });

    const requestedPostId =
      typeof request.data?.postId === "string"
        ? request.data.postId.trim()
        : "";

    const postId = requestedPostId || db.collection("posts").doc().id;

    const mediaIndex =
      typeof request.data?.mediaIndex === "number" &&
      Number.isInteger(request.data.mediaIndex) &&
      request.data.mediaIndex >= 0
        ? request.data.mediaIndex
        : 0;

    const customThumbnailUrl =
      normalizeOptionalUrl(request.data?.customThumbnailUrl) ||
      normalizeOptionalUrl(request.data?.thumbnailUrl);

    const mediaId = db.collection("posts").doc(postId).collection("media").doc().id;

    const originHeader = request.rawRequest.headers.origin;
    const corsOrigin =
      typeof originHeader === "string" && originHeader.trim()
        ? originHeader.trim()
        : "*";

    const mux = createMuxClient();

    let upload: Awaited<ReturnType<typeof mux.video.uploads.create>>;

    try {
      upload = await mux.video.uploads.create({
        cors_origin: corsOrigin,
        new_asset_settings: {
          playback_policy: ["public"],
          video_quality: "basic",
          passthrough: JSON.stringify({
            postId,
            authorId: uid,
            contextType,
            groupId,
            profileId,
            mediaId,
            mediaIndex,
            source: "vibra-post-video",
          }),
        },
      });
    } catch (error) {
      console.error("createMuxDirectUpload Mux upload creation failed", error);
      throw new HttpsError(
        "internal",
        "No se pudo crear la subida de video en Mux."
      );
    }

    const now = FieldValue.serverTimestamp();

    await db.collection("muxUploads").doc(upload.id).set({
      provider: "mux",
      uploadId: upload.id,
      uploadUrlCreated: true,
      postId,
      authorId: uid,
      contextType,
      groupId,
      profileId,
      mediaId,
      mediaIndex,
      customThumbnailUrl,
      thumbnailUrl: customThumbnailUrl,
      hasCustomThumbnail: Boolean(customThumbnailUrl),
      status: "waiting_for_upload",
      assetId: null,
      playbackId: null,
      createdAt: now,
      updatedAt: now,
    });

    return {
      provider: "mux",
      uploadId: upload.id,
      uploadUrl: upload.url,
      postId,
      mediaId,
      mediaIndex,
      customThumbnailUrl,
      thumbnailUrl: customThumbnailUrl,
      hasCustomThumbnail: Boolean(customThumbnailUrl),
      status: "waiting_for_upload",
    };
  }
);