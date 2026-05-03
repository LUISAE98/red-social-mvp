import { getDownloadURL, ref, uploadBytes } from "firebase/storage";

import { auth, storage } from "@/lib/firebase";
import { normalizeImageFile } from "@/lib/uploads/image-normalizer";
import type { PostMedia } from "./types";
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
}): string {
  const extension = getSafeFileExtension(params.file);
  const timestamp = Date.now();
  const randomId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);

  return `posts/${params.groupId}/${params.uid}/${timestamp}-${randomId}.${extension}`;
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
  const dimensions = await getImageDimensions(fileToUpload);

  const path = buildImageStoragePath({
    uid,
    groupId: params.groupId,
    file: fileToUpload,
  });

  const imageRef = ref(storage, path);

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

  const url = await getDownloadURL(imageRef);

  return {
    type: "image",
    url,
    path,
    width: dimensions.width,
    height: dimensions.height,
    size: fileToUpload.size,
    mimeType: fileToUpload.type,
    thumbnailUrl: null,
    altText: null,
  };
}

export async function uploadPostImages(params: {
  groupId: string;
  files: File[];
}): Promise<PostMedia[]> {
  if (params.files.length > MAX_POST_IMAGES) {
    throw new Error(`Solo puedes subir hasta ${MAX_POST_IMAGES} imágenes por publicación.`);
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