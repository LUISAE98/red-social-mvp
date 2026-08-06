// Blindaje del contenido de PAGO: las coordenadas reproducibles de un post de
// pago (playbackId de Mux, URL HLS, URL del VOD) NO pueden vivir en el documento
// del post, porque ese documento es legible por gente que todavía no ha pagado
// —justamente el caso de un premium con `accessMode: "public"` dentro de una
// comunidad privada, que cualquiera puede leer para poder comprarlo—.
//
// Con los assets de Mux en `playback_policy: "public"`, tener el playbackId
// equivale a tener el video: basta con abrir `stream.mux.com/{id}.m3u8`. Es
// decir, el candado del feed era solo visual.
//
// Este trigger mantiene una invariante simple:
//
//   post de pago  →  sus campos reproducibles viven SOLO en
//                    posts/{postId}/protectedPlayback/current
//
// Ese subdocumento está cerrado por reglas a: autor, moderación de plataforma,
// dueño/moderador de la comunidad, comprador con `postAccess` activo y —cuando
// el premium es `freeFor: members_and_subscribers`— miembros de la comunidad.
// El cliente lo lee y lo re-inyecta en el post antes de reproducir.
//
// Si el post deja de ser de pago, la operación se revierte (se devuelven los
// campos al post y se borra el subdocumento).
//
// ALCANCE: se redactan el video del post (media/videoData/playback) y el VOD de
// un live YA TERMINADO. Una transmisión EN CURSO no se toca: su URL la consumen
// el panel del creador y el overlay de OBS, y el gate del boleto es otro camino.

import { onDocumentWritten } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { muxTokenId, muxTokenSecret } from "./mux";
import { ensureSignedPlaybackId } from "./muxSignedAssets";
import {
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

/** Doc único donde viven las coordenadas reproducibles de un post de pago. */
export const PROTECTED_PLAYBACK_DOC = "current";

type AnyRecord = Record<string, unknown>;

function asRecord(value: unknown): AnyRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as AnyRecord)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** Campos de un objeto (playback/videoData/media item) que permiten reproducir. */
const PLAYABLE_KEYS = ["url", "hlsUrl", "playbackId", "assetId", "mp4Url", "vodUrl"] as const;

function pickPlayable(source: AnyRecord | null): AnyRecord | null {
  if (!source) return null;
  const picked: AnyRecord = {};
  for (const key of PLAYABLE_KEYS) {
    const value = nonEmptyString(source[key]);
    if (value) picked[key] = value;
  }
  return Object.keys(picked).length > 0 ? picked : null;
}

function redactPlayable(source: AnyRecord): AnyRecord {
  const next: AnyRecord = { ...source };
  for (const key of PLAYABLE_KEYS) {
    if (nonEmptyString(next[key])) next[key] = null;
  }
  return next;
}

function isPaidPost(post: AnyRecord): boolean {
  const premium = asRecord(post.premium);
  return post.requiresPayment === true || premium?.enabled === true;
}

/**
 * El VOD de un live solo se blinda cuando la transmisión TERMINÓ. En vivo o
 * programado se deja intacto: esa URL la usan el panel del creador y el overlay.
 */
function shouldProtectLiveData(post: AnyRecord): boolean {
  const live = asRecord(post.liveData);
  if (!live) return false;
  return live.status === "ended";
}

type Extraction = {
  /** Lo que hay que guardar en el subdocumento protegido. */
  secret: AnyRecord;
  /** Parche que deja el post sin coordenadas reproducibles. */
  postPatch: AnyRecord;
};

function extractFromPaidPost(post: AnyRecord): Extraction | null {
  const secret: AnyRecord = {};
  const postPatch: AnyRecord = {};

  const playback = asRecord(post.playback);
  const playbackSecret = pickPlayable(playback);
  if (playback && playbackSecret) {
    secret.playback = playbackSecret;
    postPatch.playback = redactPlayable(playback);
  }

  const videoData = asRecord(post.videoData);
  const videoSecret = pickPlayable(videoData);
  if (videoData && videoSecret) {
    secret.videoData = videoSecret;
    postPatch.videoData = redactPlayable(videoData);
  }

  if (Array.isArray(post.media)) {
    const mediaSecrets: AnyRecord = {};
    let mediaTouched = false;

    const nextMedia = post.media.map((raw, index) => {
      const item = asRecord(raw);
      if (!item || item.type !== "video") return raw;

      const itemSecret = pickPlayable(item);
      if (!itemSecret) return raw;

      mediaTouched = true;
      // Clave estable: id del media si existe, si no la posición.
      mediaSecrets[nonEmptyString(item.id) ?? `index_${index}`] = itemSecret;
      return redactPlayable(item);
    });

    if (mediaTouched) {
      secret.media = mediaSecrets;
      postPatch.media = nextMedia;
    }
  }

  if (shouldProtectLiveData(post)) {
    const live = asRecord(post.liveData);
    const liveSecret = pickPlayable(live);
    if (live && liveSecret) {
      secret.liveData = liveSecret;
      postPatch.liveData = redactPlayable(live);
    }
  }

  if (Object.keys(secret).length === 0) return null;
  return { secret, postPatch };
}

/** Devuelve al post los campos guardados en el subdocumento protegido. */
function buildRestorePatch(post: AnyRecord, secret: AnyRecord): AnyRecord | null {
  const patch: AnyRecord = {};

  const playbackSecret = asRecord(secret.playback);
  if (playbackSecret) {
    patch.playback = { ...(asRecord(post.playback) ?? {}), ...playbackSecret };
  }

  const videoSecret = asRecord(secret.videoData);
  if (videoSecret) {
    patch.videoData = { ...(asRecord(post.videoData) ?? {}), ...videoSecret };
  }

  const liveSecret = asRecord(secret.liveData);
  if (liveSecret) {
    patch.liveData = { ...(asRecord(post.liveData) ?? {}), ...liveSecret };
  }

  const mediaSecrets = asRecord(secret.media);
  if (mediaSecrets && Array.isArray(post.media)) {
    patch.media = post.media.map((raw, index) => {
      const item = asRecord(raw);
      if (!item) return raw;
      const key = nonEmptyString(item.id) ?? `index_${index}`;
      const itemSecret = asRecord(mediaSecrets[key]);
      return itemSecret ? { ...item, ...itemSecret } : raw;
    });
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * Segunda capa: pasa los assets de Mux del post a reproducción FIRMADA.
 *
 * Esconder el playbackId (capa 1) evita que un desconocido lo saque del feed,
 * pero quien SÍ tiene acceso recibe una URL pública que puede reenviar y que no
 * caduca nunca. Con playback firmado esa URL deja de servir sola: hay que pedir
 * un token con caducidad (ver `getMuxPlaybackToken`).
 *
 * Es idempotente y se salta entera si aún no hay llave de firma configurada.
 */
async function upgradeToSignedPlayback(params: {
  postId: string;
  postRef: FirebaseFirestore.DocumentReference;
  secretRef: FirebaseFirestore.DocumentReference;
  secret: AnyRecord;
}): Promise<void> {
  const { postId, postRef, secretRef, secret } = params;

  if (secret.playbackPolicy === "signed") return;
  if (!isMuxSigningConfigured()) {
    logger.warn("protectedPlayback: sin llave de firma, el asset sigue público", { postId });
    return;
  }

  // Pares (assetId → playbackId) que hay que convertir. `liveData` queda fuera:
  // los lives de Cloudflare no son assets de Mux.
  const sources = [asRecord(secret.videoData), asRecord(secret.playback)].filter(
    Boolean
  ) as AnyRecord[];

  const mediaSecrets = asRecord(secret.media);
  if (mediaSecrets) {
    for (const value of Object.values(mediaSecrets)) {
      const item = asRecord(value);
      if (item) sources.push(item);
    }
  }

  const assetIds = new Set<string>();
  for (const source of sources) {
    const assetId = nonEmptyString(source.assetId);
    if (assetId) assetIds.add(assetId);
  }

  if (assetIds.size === 0) return;

  // assetId → nuevo playbackId firmado.
  const signedByAsset = new Map<string, string>();
  for (const assetId of assetIds) {
    try {
      const signedId = await ensureSignedPlaybackId(assetId);
      if (signedId) signedByAsset.set(assetId, signedId);
    } catch (error) {
      logger.error("protectedPlayback: fallo al firmar el asset", {
        postId,
        assetId,
        error: error instanceof Error ? error.message : String(error),
      });
      return; // sin conversión completa no se toca nada: mejor reintentar luego.
    }
  }

  if (signedByAsset.size === 0) return;

  /** Reescribe un bloque con el playbackId firmado y sin URL directa. */
  function withSignedId(source: AnyRecord | null): AnyRecord | null {
    if (!source) return null;
    const assetId = nonEmptyString(source.assetId);
    const signedId = assetId ? signedByAsset.get(assetId) : null;
    if (!signedId) return source;
    return {
      ...source,
      playbackId: signedId,
      // La URL sin token ya no sirve: el cliente la compone al pedir el permiso.
      url: null,
      hlsUrl: null,
      mp4Url: null,
    };
  }

  const secretPatch: AnyRecord = { playbackPolicy: "signed" };

  const nextVideoData = withSignedId(asRecord(secret.videoData));
  if (nextVideoData) secretPatch.videoData = nextVideoData;

  const nextPlayback = withSignedId(asRecord(secret.playback));
  if (nextPlayback) secretPatch.playback = nextPlayback;

  if (mediaSecrets) {
    const nextMedia: AnyRecord = {};
    for (const [key, value] of Object.entries(mediaSecrets)) {
      nextMedia[key] = withSignedId(asRecord(value)) ?? value;
    }
    secretPatch.media = nextMedia;
  }

  await secretRef.set(secretPatch, { merge: true });

  // La MINIATURA sí la ve quien no ha pagado (es la portada del paywall). Al
  // retirar el playbackId público, TODA URL de image.mux.com que lo usara queda
  // rota, así que se reescriben con la miniatura firmada de vida larga. Un token
  // de miniatura (`aud: "t"`) no abre el video.
  try {
    const thumbnailByOldId = new Map<string, string>();
    for (const source of sources) {
      const oldId = nonEmptyString(source.playbackId);
      const assetId = nonEmptyString(source.assetId);
      const signedId = assetId ? signedByAsset.get(assetId) : null;
      if (oldId && signedId) {
        thumbnailByOldId.set(oldId, buildSignedThumbnailUrl(signedId));
      }
    }

    if (thumbnailByOldId.size > 0) {
      /** Sustituye cualquier miniatura de Mux que apunte a un id ya retirado. */
      const rewriteThumb = (value: unknown): string | null => {
        const url = nonEmptyString(value);
        if (!url || !url.includes("image.mux.com")) return null;
        for (const [oldId, signedUrl] of thumbnailByOldId) {
          if (url.includes(oldId)) return signedUrl;
        }
        return null;
      };

      const freshSnap = await postRef.get();
      const freshPost = (freshSnap.data() ?? {}) as AnyRecord;
      const patch: AnyRecord = {};

      for (const field of ["videoData", "playback"] as const) {
        const block = asRecord(freshPost[field]);
        if (!block) continue;
        const nextThumb = rewriteThumb(block.muxThumbnailUrl);
        const nextMain = rewriteThumb(block.thumbnailUrl);
        if (nextThumb || nextMain) {
          patch[field] = {
            ...block,
            ...(nextThumb ? { muxThumbnailUrl: nextThumb } : {}),
            ...(nextMain ? { thumbnailUrl: nextMain } : {}),
          };
        }
      }

      if (Array.isArray(freshPost.media)) {
        let mediaTouched = false;
        const nextMedia = freshPost.media.map((raw) => {
          const item = asRecord(raw);
          if (!item) return raw;
          const nextThumb = rewriteThumb(item.muxThumbnailUrl);
          const nextMain = rewriteThumb(item.thumbnailUrl);
          if (!nextThumb && !nextMain) return raw;
          mediaTouched = true;
          return {
            ...item,
            ...(nextThumb ? { muxThumbnailUrl: nextThumb } : {}),
            ...(nextMain ? { thumbnailUrl: nextMain } : {}),
          };
        });
        if (mediaTouched) patch.media = nextMedia;
      }

      const nextShareImage = rewriteThumb(freshPost.shareImageUrl);
      if (nextShareImage) patch.shareImageUrl = nextShareImage;

      if (Object.keys(patch).length > 0) {
        await postRef.set(patch, { merge: true });
      }
    }
  } catch (error) {
    logger.warn("protectedPlayback: no se pudieron reescribir las miniaturas", {
      postId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  logger.info("protectedPlayback: assets convertidos a playback firmado", {
    postId,
    assets: [...signedByAsset.keys()],
  });
}

export async function syncProtectedPlayback(postId: string, post: AnyRecord): Promise<void> {
  const postRef = db.collection("posts").doc(postId);
  const secretRef = postRef.collection("protectedPlayback").doc(PROTECTED_PLAYBACK_DOC);

  if (isPaidPost(post)) {
    const extraction = extractFromPaidPost(post);

    // Nada nuevo que blindar (o ya estaba redactado): aun así hay que revisar que
    // el asset esté firmado, porque la conversión pudo fallar en una pasada previa.
    if (!extraction) {
      const currentSecret = await secretRef.get();
      if (currentSecret.exists) {
        await upgradeToSignedPlayback({
          postId,
          postRef,
          secretRef,
          secret: currentSecret.data() ?? {},
        });
      }
      return;
    }

    await secretRef.set(
      {
        ...extraction.secret,
        postId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    await postRef.set(extraction.postPatch, { merge: true });

    logger.info("protectedPlayback: post de pago blindado", {
      postId,
      keys: Object.keys(extraction.secret),
    });

    const secretSnap = await secretRef.get();
    await upgradeToSignedPlayback({
      postId,
      postRef,
      secretRef,
      secret: secretSnap.data() ?? {},
    });
    return;
  }

  // Ya no es de pago → devolver lo guardado y limpiar.
  const secretSnap = await secretRef.get();
  if (!secretSnap.exists) return;

  const restore = buildRestorePatch(post, secretSnap.data() ?? {});
  if (restore) await postRef.set(restore, { merge: true });
  await secretRef.delete();

  logger.info("protectedPlayback: post ya no es de pago, playback restaurado", { postId });
}

export const onPostPlaybackProtection = onDocumentWritten(
  {
    document: "posts/{postId}",
    region: REGION,
    secrets: [muxTokenId, muxTokenSecret, muxSigningKeyId, muxSigningPrivateKey],
  },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return;

    const post = (after.data() ?? {}) as AnyRecord;

    try {
      await syncProtectedPlayback(event.params.postId, post);
    } catch (error) {
      logger.error("protectedPlayback: fallo al sincronizar", {
        postId: event.params.postId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
