import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { defineSecret } from "firebase-functions/params";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();

export const cfAccountId = defineSecret("CF_ACCOUNT_ID");
export const cfApiToken = defineSecret("CF_API_TOKEN");

type CFLiveInputResponse = {
  result: {
    uid: string;
    webRTC: { url: string };
    webRTCPlayback: { url: string };
  };
  success: boolean;
  errors: unknown[];
};

function deriveHlsUrl(webRTCPlaybackUrl: string): string {
  // webRTCPlayback.url: https://customer-xxx.cloudflarestream.com/{uid}/webRTC/play
  // HLS URL:           https://customer-xxx.cloudflarestream.com/{uid}/manifest/video.m3u8
  return webRTCPlaybackUrl.replace("/webRTC/play", "/manifest/video.m3u8");
}

export const createCFLiveInput = onCall(
  {
    region: "us-central1",
    secrets: [cfAccountId, cfApiToken],
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
    if (post.liveData?.liveInputId) {
      // Already configured — return existing data
      const credSnap = await postRef.collection("liveStream").doc("credentials").get();
      const hlsUrl = credSnap.data()?.hlsUrl ?? post.liveData?.hlsUrl ?? null;
      return { liveInputId: post.liveData.liveInputId as string, hlsUrl };
    }

    const accountId = cfAccountId.value();
    const apiToken = cfApiToken.value();

    let resp: Response;
    try {
      resp = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/live_inputs`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            meta: { name: `vibra-live-${postId}` },
            recording: { mode: "automatic", timeoutSeconds: 10 },
          }),
        }
      );
    } catch (err) {
      logger.error("CF live input fetch failed", { postId, err });
      throw new HttpsError("internal", "No se pudo conectar con Cloudflare Stream.");
    }

    if (!resp.ok) {
      const errBody = await resp.text();
      logger.error("CF live input creation failed", { postId, status: resp.status, errBody });
      throw new HttpsError("internal", "No se pudo crear el live input en Cloudflare Stream.");
    }

    const body = (await resp.json()) as CFLiveInputResponse;
    if (!body.success) {
      logger.error("CF live input response not success", { postId, body });
      throw new HttpsError("internal", "Cloudflare Stream devolvió un error.");
    }

    const liveInputId = body.result.uid;
    const whipUrl = body.result.webRTC.url;
    const hlsUrl = deriveHlsUrl(body.result.webRTCPlayback.url);

    const batch = db.batch();

    batch.update(postRef, {
      "liveData.streamProvider": "cloudflare",
      "liveData.liveInputId": liveInputId,
      "liveData.hlsUrl": hlsUrl,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // whipUrl is private — only the WHIP proxy reads it server-side
    const credRef = postRef.collection("liveStream").doc("credentials");
    batch.set(credRef, {
      postId,
      authorId: uid,
      liveInputId,
      whipUrl,
      hlsUrl,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await batch.commit();
    logger.info("CF live input created", { postId, liveInputId, uid });

    return { liveInputId, hlsUrl };
  }
);
