import {
  getDownloadURL,
  ref,
  uploadBytes,
} from "firebase/storage";

import { auth, storage } from "@/lib/firebase";
import type { PostMedia } from "./types";

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

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
  return rawExtension.replace(/[^a-z0-9]/g, "") || "image";
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

function validateImageFile(file: File) {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error("Solo puedes subir imágenes JPG, PNG, WEBP o GIF.");
  }

  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    throw new Error("La imagen no puede pesar más de 5 MB.");
  }
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

  validateImageFile(params.file);

  const dimensions = await getImageDimensions(params.file);
  const path = buildImageStoragePath({
    uid,
    groupId: params.groupId,
    file: params.file,
  });

  const imageRef = ref(storage, path);

  await uploadBytes(imageRef, params.file, {
    contentType: params.file.type,
    customMetadata: {
      groupId: params.groupId,
      uploadedBy: uid,
      usage: "post_image",
    },
  });

  const url = await getDownloadURL(imageRef);

  return {
    type: "image",
    url,
    path,
    width: dimensions.width,
    height: dimensions.height,
    size: params.file.size,
    mimeType: params.file.type,
    thumbnailUrl: null,
    altText: null,
  };
}