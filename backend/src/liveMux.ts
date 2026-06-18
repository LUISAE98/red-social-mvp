import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { createMuxClient, muxTokenId, muxTokenSecret } from "./mux";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();

const MUX_RTMP_URL = "rtmps://global-live.mux.com:443/app";

export const createMuxLiveStream = onCall(
  {
    region: "us-central1",
    secrets: [muxTokenId, muxTokenSecret],
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");

    const data = request.data as Record<string, unknown>;
    const postId = data?.postId;
    if (typeof postId !== "string" || !postId) {
      throw new HttpsError("invalid-argument", "postId es requerido.");
    }

    const postRef = db.collection("posts").doc(postId);
    const postSnap = await postRef.get();
    if (!postSnap.exists) {
      throw new HttpsError("not-found", "El live no existe.");
    }

    const post = postSnap.data()!;
    if (post.authorId !== uid) {
      throw new HttpsError("permission-denied", "Solo el creador puede configurar este live.");
    }
    if (post.postType !== "live") {
      throw new HttpsError("invalid-argument", "Este post no es un live.");
    }
    if (post.liveData?.liveStreamId) {
      throw new HttpsError("already-exists", "Este live ya tiene un stream configurado.");
    }

    const mux = createMuxClient();
    let liveStream: Awaited<ReturnType<typeof mux.video.liveStreams.create>>;
    try {
      liveStream = await mux.video.liveStreams.create({
        playback_policy: ["public"],
        new_asset_settings: { playback_policy: ["public"] },
        passthrough: JSON.stringify({ postId }),
        latency_mode: "low",
        reconnect_window: 120,
        max_continuous_duration: 28800,
      });
    } catch (err) {
      logger.error("Error creating Mux live stream", { postId, uid, err });
      throw new HttpsError("internal", "No se pudo crear el live stream en Mux.");
    }

    const liveStreamId = liveStream.id;
    const streamKey = liveStream.stream_key;
    const playbackId = liveStream.playback_ids?.[0]?.id ?? null;

    const batch = db.batch();

    // Non-sensitive Mux data goes to the post document
    batch.update(postRef, {
      "liveData.streamProvider": "mux",
      "liveData.liveStreamId": liveStreamId,
      "liveData.playbackId": playbackId,
      "liveData.ingestUrl": MUX_RTMP_URL,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Stream key (sensitive) goes to a private subcollection, only author can read
    const credRef = postRef.collection("liveStream").doc("credentials");
    batch.set(credRef, {
      postId,
      authorId: uid,
      liveStreamId,
      streamKey,
      playbackId,
      ingestUrl: MUX_RTMP_URL,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await batch.commit();

    logger.info("Mux live stream created", { postId, liveStreamId, uid });

    return { liveStreamId, playbackId };
  }
);
