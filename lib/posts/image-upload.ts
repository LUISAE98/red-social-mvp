import { getDownloadURL, ref, uploadBytes } from "firebase/storage";

import { auth, storage } from "@/lib/firebase";
import {
  createImageThumbnailFile,
  normalizeImageFile,
} from "@/lib/uploads/image-normalizer";
import type { CommentImage, PostMedia } from "./types";
import { MAX_POST_IMAGES } from "./types";

const MAX_IMAGE_SIZE_BYTES = 150 * 1024 * 1024;

function getSafeFileExtension(file: File): string {
  const byType =
    file.type === "image/jpeg"
      ? "jpg"
      : file.type === "image/png"
        ? "png"
        : file.type === "image/webp"
          ? "webp"
          : file.type === "image/gif"
            ? "gif"
            : "";

  if (byType) return byType;

  const rawExtension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return rawExtension.replace(/[^a-z0-9]/g, "") || "jpg";
}

function buildImageStoragePath(params: {
  uid: string;
  groupId: string;
  file: File;
  variant?: "original" | "thumbnail";
}): string {
  const extension = getSafeFileExtension(params.file);
  const timestamp = Date.now();
  const randomId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);

  const variantPath = params.variant === "thumbnail" ? "thumbnails" : "images";

  return `posts/${params.groupId}/${params.uid}/${variantPath}/${timestamp}-${randomId}.${extension}`;
}

function getImageDimensions(file: File): Promise<{
  width?: number;
  height?: number;
}> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") {
      resolve({});
      return;
    }

    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      const width = image.naturalWidth || undefined;
      const height = image.naturalHeight || undefined;
      URL.revokeObjectURL(objectUrl);
      resolve({ width, height });
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({});
    };

    image.src = objectUrl;
  });
}

export async function uploadPostImage(params: {
  groupId: string;
  file: File;
}): Promise<PostMedia> {
  const uid = auth.currentUser?.uid;

  if (!uid) {
    throw new Error("Debes iniciar sesión para subir imágenes.");
  }

  if (!params.groupId.trim()) {
    throw new Error("Falta groupId para subir la imagen.");
  }

  const normalized = await normalizeImageFile(params.file, {
    maxSizeBytes: MAX_IMAGE_SIZE_BYTES,
  });

  const fileToUpload = normalized.file;
  const thumbnail = await createImageThumbnailFile(fileToUpload);
  const thumbnailFile = thumbnail.file;

  const dimensions = await getImageDimensions(fileToUpload);

  const path = buildImageStoragePath({
    uid,
    groupId: params.groupId,
    file: fileToUpload,
    variant: "original",
  });

  const thumbnailPath = buildImageStoragePath({
    uid,
    groupId: params.groupId,
    file: thumbnailFile,
    variant: "thumbnail",
  });

  const imageRef = ref(storage, path);
  const thumbnailRef = ref(storage, thumbnailPath);

  await uploadBytes(imageRef, fileToUpload, {
    contentType: fileToUpload.type,
    customMetadata: {
      groupId: params.groupId,
      uploadedBy: uid,
      usage: "post_image",
      originalName: normalized.originalName,
      originalType: normalized.originalType,
      wasConverted: String(normalized.wasConverted),
    },
  });

  await uploadBytes(thumbnailRef, thumbnailFile, {
    contentType: thumbnailFile.type,
    customMetadata: {
      groupId: params.groupId,
      uploadedBy: uid,
      usage: "post_image_thumbnail",
      originalName: normalized.originalName,
      originalType: normalized.originalType,
      wasConverted: String(normalized.wasConverted),
      originalImagePath: path,
    },
  });

  const [url, thumbnailUrl] = await Promise.all([
    getDownloadURL(imageRef),
    getDownloadURL(thumbnailRef),
  ]);

  return {
    type: "image",
    url,
    path,
    width: dimensions.width,
    height: dimensions.height,
    size: fileToUpload.size,
    mimeType: fileToUpload.type,
    thumbnailUrl,
    thumbnailPath,
    altText: null,
  };
}

function buildCommentImageStoragePath(params: {
  uid: string;
  postId: string;
  file: File;
  variant?: "original" | "thumbnail";
}): string {
  const extension = getSafeFileExtension(params.file);
  const timestamp = Date.now();
  const randomId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);

  const variantPath = params.variant === "thumbnail" ? "thumbnails" : "images";

  return `commentImages/${params.postId}/${params.uid}/${variantPath}/${timestamp}-${randomId}.${extension}`;
}

/**
 * Sube UNA imagen adjunta a un comentario/respuesta. Reutiliza la misma
 * normalización/compresión que las imágenes de post, pero la deja en un path
 * dedicado `commentImages/{postId}/{uid}/...` para poder gobernarla aparte
 * (moderación/limpieza) más adelante. Devuelve el shape {@link CommentImage}.
 */
export async function uploadCommentImage(params: {
  postId: string;
  file: File;
}): Promise<CommentImage> {
  const uid = auth.currentUser?.uid;

  if (!uid) {
    throw new Error("Debes iniciar sesión para subir imágenes.");
  }

  if (!params.postId.trim()) {
    throw new Error("Falta postId para subir la imagen.");
  }

  const normalized = await normalizeImageFile(params.file, {
    maxSizeBytes: MAX_IMAGE_SIZE_BYTES,
  });

  const fileToUpload = normalized.file;
  const thumbnail = await createImageThumbnailFile(fileToUpload);
  const thumbnailFile = thumbnail.file;

  const dimensions = await getImageDimensions(fileToUpload);

  const path = buildCommentImageStoragePath({
    uid,
    postId: params.postId,
    file: fileToUpload,
    variant: "original",
  });

  const thumbnailPath = buildCommentImageStoragePath({
    uid,
    postId: params.postId,
    file: thumbnailFile,
    variant: "thumbnail",
  });

  const imageRef = ref(storage, path);
  const thumbnailRef = ref(storage, thumbnailPath);

  await uploadBytes(imageRef, fileToUpload, {
    contentType: fileToUpload.type,
    customMetadata: {
      postId: params.postId,
      uploadedBy: uid,
      usage: "comment_image",
      originalName: normalized.originalName,
      originalType: normalized.originalType,
      wasConverted: String(normalized.wasConverted),
    },
  });

  await uploadBytes(thumbnailRef, thumbnailFile, {
    contentType: thumbnailFile.type,
    customMetadata: {
      postId: params.postId,
      uploadedBy: uid,
      usage: "comment_image_thumbnail",
      originalName: normalized.originalName,
      originalType: normalized.originalType,
      wasConverted: String(normalized.wasConverted),
      originalImagePath: path,
    },
  });

  const [url, thumbnailUrl] = await Promise.all([
    getDownloadURL(imageRef),
    getDownloadURL(thumbnailRef),
  ]);

  return {
    url,
    thumbnailUrl,
    path,
    thumbnailPath,
    width: dimensions.width,
    height: dimensions.height,
  };
}

export async function uploadPostImages(params: {
  groupId: string;
  files: File[];
}): Promise<PostMedia[]> {
  if (params.files.length > MAX_POST_IMAGES) {
    throw new Error(
      `Solo puedes subir hasta ${MAX_POST_IMAGES} imágenes por publicación.`
    );
  }

  const uploadedImages: PostMedia[] = [];

  for (const file of params.files) {
    const uploadedImage = await uploadPostImage({
      groupId: params.groupId,
      file,
    });

    uploadedImages.push(uploadedImage);
  }

  return uploadedImages;
}