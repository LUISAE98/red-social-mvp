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

type CreateMuxDirectUploadRequest = {
  groupId?: string;
};

function normalizeRequiredString(value: unknown, fieldName: string) {
  const normalized = typeof value === "string" ? value.trim() : "";

  if (!normalized) {
    throw new HttpsError("invalid-argument", `${fieldName} es requerido.`);
  }

  return normalized;
}

function isReadableMemberStatus(status: unknown) {
  return status === "active" || status === "subscribed" || status === "muted";
}

function isPostingAllowedMemberStatus(status: unknown) {
  return status === "active" || status === "subscribed";
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

    const groupId = normalizeRequiredString(
      request.data?.groupId,
      "groupId"
    );

    await assertCanCreateMuxUpload(uid, groupId);

    const postRef = db.collection("posts").doc();
    const postId = postRef.id;

    const originHeader = request.rawRequest.headers.origin;
    const corsOrigin =
      typeof originHeader === "string" && originHeader.trim()
        ? originHeader.trim()
        : "*";

    const mux = createMuxClient();

    const upload = await mux.video.uploads.create({
      cors_origin: corsOrigin,
      new_asset_settings: {
        playback_policy: ["public"],
        video_quality: "basic",
        passthrough: JSON.stringify({
          postId,
          authorId: uid,
          groupId,
          source: "vibra-post-video",
        }),
      },
    });

    const now = FieldValue.serverTimestamp();

    await db.collection("muxUploads").doc(upload.id).set({
      provider: "mux",
      uploadId: upload.id,
      uploadUrlCreated: true,
      postId,
      authorId: uid,
      groupId,
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
      status: "waiting_for_upload",
    };
  }
);