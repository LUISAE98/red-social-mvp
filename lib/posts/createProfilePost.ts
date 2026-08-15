"use client";

/**
 * Publicar en el PERFIL (no en una comunidad).
 *
 * Extraído de `ProfileClient.handleCreateProfilePost` para poder publicar desde
 * dos sitios —el perfil y el home— sin duplicar la lógica de subida. La conducta
 * es exactamente la que ya tenía: mismo orden de medios, mismos límites, mismas
 * llamadas.
 *
 * No sabe nada de React ni de i18n: los textos de estado llegan como `labels` y
 * los fallos de validación se DEVUELVEN como clave, para que quien llama los
 * traduzca y los pinte donde corresponda.
 */

import { httpsCallable } from "firebase/functions";

import { functions } from "@/lib/firebase";
import { createMediaPost, createTextPost } from "@/lib/posts/post-service";
import { uploadPostImages } from "@/lib/posts/image-upload";
import {
  VIDEO_MAX_DURATION_SECONDS,
  getVideoDuration,
  uploadVideoFileToMux,
  type CreateMuxDirectUploadResponse,
} from "@/lib/posts/muxDirectUpload";
import type { PostMedia, PostPremium } from "@/lib/posts/types";

/** Máximo de videos por publicación. */
export const MAX_VIDEOS_PER_POST = 3;

export type ProfilePostMediaItem = {
  type: "image" | "video";
  file: File;
  coverFile?: File | null;
};

export type ProfilePostPayload = {
  text: string;
  imageFiles?: File[];
  videoFiles?: File[];
  mediaItems?: ProfilePostMediaItem[];
  premium?: PostPremium | null;
};

/** Textos de progreso. Se inyectan ya traducidos. */
export type ProfilePostLabels = {
  validatingVideos: string;
  uploadingCovers: string;
  preparingUpload: string;
  preparePostError: string;
  creatingPost: string;
  uploadingVideo: (index: number, total: number) => string;
  videosUploaded: string;
};

/**
 * Fallos de VALIDACIÓN, que no son excepciones: el usuario puede corregirlos.
 * Se devuelven como clave para que la interfaz elija el texto y dónde ponerlo.
 * Cualquier otro fallo (red, permisos, Mux) se propaga como excepción.
 */
export type ProfilePostResult =
  | { ok: true }
  | { ok: false; reason: "tooManyVideos" | "videoTooLong" };

export async function createProfilePost(params: {
  profileUid: string;
  payload: ProfilePostPayload;
  labels: ProfilePostLabels;
  onStatus: (status: string | null) => void;
  onProgress: (progress: number | null) => void;
}): Promise<ProfilePostResult> {
  const { profileUid, payload, labels, onStatus, onProgress } = params;

  const cleanText = payload.text.trim();

  // `mediaItems` ya viene ordenado por el compositor; las listas sueltas de
  // imágenes y videos son el camino antiguo y se concatenan respetando su orden.
  const orderedMediaItems: ProfilePostMediaItem[] =
    Array.isArray(payload.mediaItems) && payload.mediaItems.length > 0
      ? payload.mediaItems
      : [
          ...(payload.imageFiles ?? []).map<ProfilePostMediaItem>((file) => ({
            type: "image",
            file,
            coverFile: null,
          })),
          ...(payload.videoFiles ?? []).map<ProfilePostMediaItem>((file) => ({
            type: "video",
            file,
            coverFile: null,
          })),
        ];

  // El `mediaIndex` es la posición REAL dentro de la publicación. Se calcula
  // antes de separar por tipo, porque después de filtrar ya no se recupera.
  const imageItems = orderedMediaItems
    .map((item, mediaIndex) => ({ ...item, mediaIndex }))
    .filter((item) => item.type === "image");

  const videoItems = orderedMediaItems
    .map((item, mediaIndex) => ({ ...item, mediaIndex }))
    .filter((item) => item.type === "video");

  if (videoItems.length > MAX_VIDEOS_PER_POST) {
    return { ok: false, reason: "tooManyVideos" };
  }

  if (videoItems.length > 0) {
    onProgress(0);
    onStatus(labels.validatingVideos);

    for (const videoItem of videoItems) {
      const duration = await getVideoDuration(videoItem.file);

      if (duration > VIDEO_MAX_DURATION_SECONDS) {
        onProgress(null);
        onStatus(null);
        return { ok: false, reason: "videoTooLong" };
      }
    }
  }

  const uploadedImages: PostMedia[] =
    imageItems.length > 0
      ? (
          await uploadPostImages({
            groupId: `profile-${profileUid}`,
            files: imageItems.map((item) => item.file),
          })
        ).map((media, index) => ({
          ...media,
          index: imageItems[index]?.mediaIndex ?? index,
        }))
      : [];

  const videoCoverItems = videoItems.filter(
    (item) => item.coverFile instanceof File
  );

  let uploadedVideoCovers: Array<{
    mediaIndex: number;
    thumbnailUrl: string;
    thumbnailPath: string | null;
  }> = [];

  if (videoCoverItems.length > 0) {
    onStatus(labels.uploadingCovers);

    const covers = await uploadPostImages({
      groupId: `profile-${profileUid}`,
      files: videoCoverItems.map((item) => item.coverFile as File),
    });

    uploadedVideoCovers = covers.map((media, index) => ({
      mediaIndex: videoCoverItems[index]?.mediaIndex ?? index,
      thumbnailUrl: media.thumbnailUrl ?? media.url,
      thumbnailPath: media.thumbnailPath ?? media.path ?? null,
    }));
  }

  const videoCoversByMediaIndex = new Map(
    uploadedVideoCovers.map((cover) => [cover.mediaIndex, cover])
  );

  if (videoItems.length > 0) {
    onStatus(labels.preparingUpload);

    const callable = httpsCallable<
      {
        contextType: "profile";
        profileId: string;
        postId?: string;
        mediaIndex?: number;
      },
      CreateMuxDirectUploadResponse
    >(functions, "createMuxDirectUpload");

    const muxUploads: Array<{
      uploadUrl: string;
      uploadId: string;
      postId: string;
      mediaId: string;
      file: File;
      mediaIndex: number;
      thumbnailUrl: string | null;
      thumbnailPath: string | null;
    }> = [];

    // Todos los videos de una publicación comparten postId: el primero lo crea
    // y los siguientes se cuelgan de él.
    let sharedPostId: string | null = null;

    for (const videoItem of videoItems) {
      const uploadResult = await callable({
        contextType: "profile",
        profileId: profileUid,
        postId: sharedPostId ?? undefined,
        mediaIndex: videoItem.mediaIndex,
      });

      const uploadData = uploadResult.data as CreateMuxDirectUploadResponse;

      if (!sharedPostId) sharedPostId = uploadData.postId;

      const cover = videoCoversByMediaIndex.get(videoItem.mediaIndex) ?? null;

      muxUploads.push({
        uploadUrl: uploadData.uploadUrl,
        uploadId: uploadData.uploadId,
        postId: uploadData.postId,
        mediaId: uploadData.mediaId,
        file: videoItem.file,
        mediaIndex: videoItem.mediaIndex,
        thumbnailUrl: cover?.thumbnailUrl ?? null,
        thumbnailPath: cover?.thumbnailPath ?? null,
      });
    }

    if (!sharedPostId) {
      throw new Error(labels.preparePostError);
    }

    onStatus(labels.creatingPost);

    // El post se crea ANTES de subir los archivos: así el webhook de Mux tiene
    // dónde escribir cuando termine de procesar cada video.
    await createMediaPost({
      contextType: "profile",
      profileId: profileUid,
      postId: sharedPostId,
      text: cleanText,
      imageMedia: uploadedImages,
      videoUploads: muxUploads.map((upload) => ({
        uploadId: upload.uploadId,
        mediaId: upload.mediaId,
        mediaIndex: upload.mediaIndex,
        thumbnailUrl: upload.thumbnailUrl,
        thumbnailPath: upload.thumbnailPath,
      })),
      premium: payload.premium ?? null,
    });

    for (let index = 0; index < muxUploads.length; index += 1) {
      const upload = muxUploads[index];

      onStatus(labels.uploadingVideo(index + 1, muxUploads.length));

      await uploadVideoFileToMux({
        uploadUrl: upload.uploadUrl,
        file: upload.file,
        onProgress,
      });
    }

    onStatus(labels.videosUploaded);
  } else if (uploadedImages.length > 0) {
    await createMediaPost({
      contextType: "profile",
      profileId: profileUid,
      text: cleanText,
      imageMedia: uploadedImages,
      videoUploads: [],
      premium: null,
    });
  } else {
    await createTextPost({
      contextType: "profile",
      profileId: profileUid,
      text: cleanText,
    });
  }

  return { ok: true };
}
