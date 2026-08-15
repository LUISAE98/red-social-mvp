import { getDownloadURL, ref, uploadBytes } from "firebase/storage";

import { doc, getDoc } from "firebase/firestore";
import { auth, db, storage } from "@/lib/firebase";
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

  // En comunidad privada u oculta NO se pide la URL de descarga: esa lleva un
  // token permanente que abre el archivo sin sesión y para siempre. Se guardan
  // solo las rutas y la URL la firma (y la caduca) `getRestrictedMediaUrls`.
  const restricted = await isRestrictedContainer(params.groupId);

  const [url, thumbnailUrl] = restricted
    ? ["", null]
    : await Promise.all([getDownloadURL(imageRef), getDownloadURL(thumbnailRef)]);

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

/**
 * Se cachea por proceso: subir cinco fotos al mismo sitio no debe costar cinco
 * lecturas.
 */
const RESTRICTED_CONTAINER_CACHE = new Map<string, boolean>();

/**
 * Contenedor de un post de PERFIL. No es una comunidad: es el pseudo-id que usa
 * el composer del perfil para armar la ruta de Storage (`posts/{contenedor}/…`).
 */
const PROFILE_CONTAINER_PREFIX = "profile-";

/**
 * ¿Los medios de este contenedor tienen que ir protegidos?
 *
 * Una comunidad privada u oculta sí; una pública no — ahí la URL directa es más
 * barata y no hay nada que proteger. Un perfil marcado como restringido también
 * sí: su contenido solo lo ve su dueño (`canReadProfileContent` en
 * firestore.rules), y las fotos no pueden ser más abiertas que el post al que
 * pertenecen.
 *
 * Protegido significa que NO se pide la URL de descarga —esa lleva un token
 * permanente que abre el archivo sin sesión y para siempre—: se guarda solo la
 * ruta y la URL la firma, y la caduca, `getRestrictedMediaUrls`.
 */
async function isRestrictedContainer(containerId: string): Promise<boolean> {
  // ⚠️ Un perfil NO se consulta como grupo. `groups/profile-{uid}` no existe, y
  // leer un documento inexistente en `groups` no devuelve "vacío": la regla
  // evalúa `resource.data.visibility` sobre null, falla, y el `getDoc` lanza
  // permiso denegado.
  if (containerId.startsWith(PROFILE_CONTAINER_PREFIX)) {
    return isRestrictedProfile(containerId.slice(PROFILE_CONTAINER_PREFIX.length));
  }

  const cached = RESTRICTED_CONTAINER_CACHE.get(containerId);
  if (cached !== undefined) return cached;

  try {
    const snap = await getDoc(doc(db, "groups", containerId));
    const visibility = snap.exists() ? snap.data()?.visibility : null;
    const restricted = visibility === "private" || visibility === "hidden";
    RESTRICTED_CONTAINER_CACHE.set(containerId, restricted);
    return restricted;
  } catch {
    // Ante la duda, protegido: es preferible una imagen que hay que firmar a
    // una filtrada.
    return true;
  }
}

async function isRestrictedProfile(uid: string): Promise<boolean> {
  if (!uid) return true;

  const clave = `${PROFILE_CONTAINER_PREFIX}${uid}`;
  const cached = RESTRICTED_CONTAINER_CACHE.get(clave);
  if (cached !== undefined) return cached;

  try {
    const snap = await getDoc(doc(db, "users", uid));
    const restricted = snap.exists() && snap.data()?.profileRestricted === true;
    RESTRICTED_CONTAINER_CACHE.set(clave, restricted);
    return restricted;
  } catch {
    return true;
  }
}

/** Igual que arriba pero partiendo del post, para las imágenes de comentario. */
async function isRestrictedPost(postId: string): Promise<boolean> {
  try {
    const snap = await getDoc(doc(db, "posts", postId));
    if (!snap.exists()) return true;

    const data = snap.data();
    const groupId = data?.groupId;

    // Sin comunidad es un post de perfil: manda si el perfil está restringido.
    // Antes se devolvía `false` sin más, así que el comentario de un perfil
    // privado se guardaba con URL de token permanente.
    if (typeof groupId !== "string" || !groupId) {
      return data?.profileRestricted === true;
    }

    return isRestrictedContainer(groupId);
  } catch {
    return true;
  }
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

  // Mismo criterio que las imágenes de post: en comunidad privada u oculta se
  // guardan solo rutas, sin URL de token permanente.
  const restricted = await isRestrictedPost(params.postId);

  const [url, thumbnailUrl] = restricted
    ? ["", ""]
    : await Promise.all([getDownloadURL(imageRef), getDownloadURL(thumbnailRef)]);

  return {
    url,
    thumbnailUrl,
    path,
    thumbnailPath,
    width: dimensions.width,
    height: dimensions.height,
  };
}

function buildDirectMessageImageStoragePath(params: {
  uid: string;
  conversationId: string;
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

  return `dmImages/${params.conversationId}/${params.uid}/${variantPath}/${timestamp}-${randomId}.${extension}`;
}

/**
 * Sube UNA imagen adjunta a un mensaje directo.
 *
 * Vive aquí, y no en `lib/chat/`, para reutilizar la misma normalización,
 * compresión y generación de miniatura que las imágenes de post y de
 * comentario, en vez de duplicarlas. El path sí es dedicado
 * (`dmImages/{conversationId}/{uid}/...`) para poder gobernarlas aparte.
 */
export async function uploadDirectMessageImage(params: {
  conversationId: string;
  file: File;
}): Promise<{
  path: string;
  thumbnailPath: string;
  width?: number;
  height?: number;
}> {
  const uid = auth.currentUser?.uid;

  if (!uid) {
    throw new Error("Debes iniciar sesión para subir imágenes.");
  }

  if (!params.conversationId.trim()) {
    throw new Error("Falta la conversación para subir la imagen.");
  }

  const normalized = await normalizeImageFile(params.file, {
    maxSizeBytes: MAX_IMAGE_SIZE_BYTES,
  });

  const fileToUpload = normalized.file;
  const thumbnail = await createImageThumbnailFile(fileToUpload);
  const thumbnailFile = thumbnail.file;

  const dimensions = await getImageDimensions(fileToUpload);

  const path = buildDirectMessageImageStoragePath({
    uid,
    conversationId: params.conversationId,
    file: fileToUpload,
    variant: "original",
  });

  const thumbnailPath = buildDirectMessageImageStoragePath({
    uid,
    conversationId: params.conversationId,
    file: thumbnailFile,
    variant: "thumbnail",
  });

  const imageRef = ref(storage, path);
  const thumbnailRef = ref(storage, thumbnailPath);

  await uploadBytes(imageRef, fileToUpload, {
    contentType: fileToUpload.type,
    customMetadata: {
      conversationId: params.conversationId,
      uploadedBy: uid,
      usage: "dm_image",
      originalName: normalized.originalName,
      originalType: normalized.originalType,
      wasConverted: String(normalized.wasConverted),
    },
  });

  await uploadBytes(thumbnailRef, thumbnailFile, {
    contentType: thumbnailFile.type,
    customMetadata: {
      conversationId: params.conversationId,
      uploadedBy: uid,
      usage: "dm_image_thumbnail",
      originalName: normalized.originalName,
      originalType: normalized.originalType,
      wasConverted: String(normalized.wasConverted),
      originalImagePath: path,
    },
  });

  // A propósito NO se llama a getDownloadURL: esa URL lleva un token permanente
  // y seguiría abriendo la imagen aunque después bloquees o borres el mensaje.
  // Solo se guarda la ruta; la URL la firma (y la caduca) `getDirectMessageImageUrls`.
  return {
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