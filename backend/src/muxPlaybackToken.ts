// getMuxPlaybackToken — entrega un permiso TEMPORAL para reproducir contenido de pago.
//
// Los assets de pago están en playback firmado (ver `muxSignedAssets.ts`): su URL
// no sirve sola. Este callable comprueba que quien pide tenga derecho y devuelve
// una URL con token que caduca en horas. Si un comprador reenvía el enlace, deja
// de funcionar solo.
//
// El derecho se resuelve EN SERVIDOR con las mismas condiciones que las reglas
// del subdocumento `protectedPlayback`:
//   · autor del post
//   · dueño o moderador de la comunidad
//   · comprador con `postAccess` activo
//   · miembro, cuando el premium es `freeFor: members_and_subscribers`

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { muxTokenId, muxTokenSecret } from "./mux";
import {
  PLAYBACK_TOKEN_TTL_SECONDS,
  buildSignedHlsUrl,
  buildSignedThumbnailUrl,
  isMuxSigningConfigured,
  muxSigningKeyId,
  muxSigningPrivateKey,
} from "./muxSigning";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();
const REGION = "us-central1";

type AnyRecord = Record<string, unknown>;

function asRecord(value: unknown): AnyRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as AnyRecord)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Estados de membresía que cuentan como "miembro con acceso al contenido". */
const MEMBER_OK = new Set(["active", "subscribed"]);

async function viewerHasAccess(params: {
  uid: string;
  postId: string;
  post: AnyRecord;
}): Promise<boolean> {
  const { uid, postId, post } = params;

  if (post.authorId === uid) return true;

  // Compra única confirmada.
  const accessSnap = await db.collection("postAccess").doc(`${uid}_${postId}`).get();
  if (accessSnap.exists && accessSnap.data()?.status === "active") return true;

  const groupId = nonEmptyString(post.groupId);
  if (!groupId) return false;

  const groupSnap = await db.collection("groups").doc(groupId).get();
  if (groupSnap.exists && groupSnap.data()?.ownerId === uid) return true;

  const memberSnap = await db
    .collection("groups")
    .doc(groupId)
    .collection("members")
    .doc(uid)
    .get();

  if (!memberSnap.exists) return false;
  const member = memberSnap.data() ?? {};

  if (member.role === "moderator" && MEMBER_OK.has(String(member.status))) return true;

  // Premium con "los miembros lo ven gratis".
  const premium = asRecord(post.premium);
  if (premium?.freeFor === "members_and_subscribers" && MEMBER_OK.has(String(member.status))) {
    return true;
  }

  // Live/VOD de pago con "los miembros no pagan".
  const liveData = asRecord(post.liveData);
  if (
    liveData?.paidAccessMode === "members_free_non_members_pay" &&
    MEMBER_OK.has(String(member.status))
  ) {
    return true;
  }

  return false;
}

export const getMuxPlaybackToken = onCall(
  {
    region: REGION,
    cors: true,
    secrets: [muxTokenId, muxTokenSecret, muxSigningKeyId, muxSigningPrivateKey],
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");

    const postId = String((request.data ?? {}).postId ?? "").trim();
    if (!postId) throw new HttpsError("invalid-argument", "Falta el id de la publicación.");

    const postSnap = await db.collection("posts").doc(postId).get();
    if (!postSnap.exists) throw new HttpsError("not-found", "Publicación no encontrada.");

    const post = (postSnap.data() ?? {}) as AnyRecord;
    if (post.isDeleted === true) {
      throw new HttpsError("not-found", "Publicación no encontrada.");
    }

    const allowed = await viewerHasAccess({ uid, postId, post });
    if (!allowed) {
      throw new HttpsError("permission-denied", "No tienes acceso a este contenido.");
    }

    const secretSnap = await db
      .collection("posts")
      .doc(postId)
      .collection("protectedPlayback")
      .doc("current")
      .get();

    if (!secretSnap.exists) {
      throw new HttpsError("failed-precondition", "Esta publicación no tiene video protegido.");
    }

    const secret = (secretSnap.data() ?? {}) as AnyRecord;

    if (!isMuxSigningConfigured()) {
      throw new HttpsError("failed-precondition", "La firma de reproducción no está configurada.");
    }

    // Se firma CADA playbackId del post (puede traer varios videos).
    const entries: Array<{ key: string; playbackId: string }> = [];

    const pushEntry = (key: string, source: AnyRecord | null) => {
      const playbackId = source ? nonEmptyString(source.playbackId) : null;
      if (playbackId) entries.push({ key, playbackId });
    };

    pushEntry("playback", asRecord(secret.playback));
    pushEntry("videoData", asRecord(secret.videoData));

    const mediaSecrets = asRecord(secret.media);
    if (mediaSecrets) {
      for (const [key, value] of Object.entries(mediaSecrets)) {
        pushEntry(`media:${key}`, asRecord(value));
      }
    }

    if (entries.length === 0) {
      throw new HttpsError("failed-precondition", "No hay video que reproducir.");
    }

    const signed: Record<string, { playbackId: string; hlsUrl: string; thumbnailUrl: string }> = {};
    for (const entry of entries) {
      signed[entry.key] = {
        playbackId: entry.playbackId,
        hlsUrl: buildSignedHlsUrl(entry.playbackId),
        thumbnailUrl: buildSignedThumbnailUrl(entry.playbackId, PLAYBACK_TOKEN_TTL_SECONDS),
      };
    }

    return {
      postId,
      expiresInSeconds: PLAYBACK_TOKEN_TTL_SECONDS,
      signed,
    };
  }
);
