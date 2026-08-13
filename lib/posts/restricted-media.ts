"use client";

import { httpsCallable } from "firebase/functions";

import { functions } from "@/lib/firebase";
import { captureError } from "@/lib/observability/captureError";
import type { Comment, CommentReply, Post } from "./types";

/**
 * Resuelve los medios de comunidades PRIVADAS y OCULTAS.
 *
 * Esas imágenes se guardan sin URL: solo la ruta. La URL la firma —y la caduca a
 * la hora— la Cloud Function `getRestrictedMediaUrls`, que antes comprueba que
 * quien pide es miembro de la comunidad. Así la foto deja de abrirse por enlace
 * para siempre, que es lo que pasaba con la URL de descarga de Firebase.
 *
 * Esto se aplica al HIDRATAR, no al pintar. Es deliberado: rellenando aquí el
 * `url` que falta, los ~74 sitios de la app que dibujan imágenes siguen leyendo
 * `image.url` como siempre y no hay que tocar ninguno. Lo público no pasa por
 * aquí — ya trae su URL directa, que es más barata.
 */

type SignedUrlsResponse = {
  urls: Record<string, string>;
  expiresAt: number;
};

/** Caché por proceso: un feed que repite post no vuelve a firmar. */
const cache = new Map<string, { url: string; expiresAt: number }>();

/** Margen para no servir una URL que caduca mientras se está pintando. */
const REFRESH_MARGIN_MS = 60 * 1000;

function cached(path: string): string | null {
  const hit = cache.get(path);
  if (!hit) return null;
  if (hit.expiresAt - REFRESH_MARGIN_MS <= Date.now()) return null;
  return hit.url;
}

/** Una ruta necesita firma cuando existe pero su URL vino vacía. */
function needsSigning(url: unknown, path: unknown): path is string {
  return typeof path === "string" && path.length > 0 && !url;
}

async function signPaths(
  postId: string,
  paths: string[]
): Promise<Record<string, string>> {
  const missing = paths.filter((path) => !cached(path));

  if (missing.length > 0) {
    try {
      const call = httpsCallable<
        { postId: string; paths: string[] },
        SignedUrlsResponse
      >(functions, "getRestrictedMediaUrls");

      const { data } = await call({ postId, paths: missing });
      for (const [path, url] of Object.entries(data.urls)) {
        cache.set(path, { url, expiresAt: data.expiresAt });
      }
    } catch (error) {
      // Sin firma se queda sin imagen, pero el post se sigue viendo.
      captureError(error, { scope: "posts", code: "restricted_media_sign_failed" });
    }
  }

  const resolved: Record<string, string> = {};
  for (const path of paths) {
    const url = cached(path);
    if (url) resolved[path] = url;
  }
  return resolved;
}

/**
 * Rellena las URLs que falten en los medios de una tanda de publicaciones.
 *
 * Se agrupa por publicación porque la función comprueba el acceso post a post.
 * Las que no tengan nada que firmar no generan ninguna llamada.
 */
export async function attachRestrictedMediaUrls(posts: Post[]): Promise<Post[]> {
  const pending = posts
    .map((post) => ({
      post,
      paths: (post.media ?? []).flatMap((item) =>
        [
          needsSigning(item.url, item.path) ? item.path : null,
          needsSigning(item.thumbnailUrl, item.thumbnailPath)
            ? item.thumbnailPath
            : null,
        ].filter((value): value is string => !!value)
      ),
    }))
    .filter((entry) => entry.paths.length > 0);

  if (pending.length === 0) return posts;

  const signedByPost = new Map<string, Record<string, string>>();
  await Promise.all(
    pending.map(async (entry) => {
      signedByPost.set(entry.post.id, await signPaths(entry.post.id, entry.paths));
    })
  );

  return posts.map((post) => {
    const signed = signedByPost.get(post.id);
    if (!signed || !post.media) return post;

    return {
      ...post,
      media: post.media.map((item) => ({
        ...item,
        url: item.url || (item.path ? signed[item.path] ?? item.url : item.url),
        thumbnailUrl:
          item.thumbnailUrl ||
          (item.thumbnailPath
            ? signed[item.thumbnailPath] ?? item.thumbnailUrl
            : item.thumbnailUrl),
      })),
    };
  });
}

/** Lo mismo para las imágenes de comentarios y respuestas de una publicación. */
export async function attachRestrictedCommentImageUrls<
  T extends Comment | CommentReply,
>(postId: string, items: T[]): Promise<T[]> {
  const paths = items.flatMap((item) => {
    const image = item.image;
    if (!image) return [];
    return [
      needsSigning(image.url, image.path) ? image.path : null,
      needsSigning(image.thumbnailUrl, image.thumbnailPath)
        ? image.thumbnailPath
        : null,
    ].filter((value): value is string => !!value);
  });

  if (paths.length === 0) return items;

  const signed = await signPaths(postId, paths);

  return items.map((item) => {
    if (!item.image) return item;
    return {
      ...item,
      image: {
        ...item.image,
        url: item.image.url || signed[item.image.path] || item.image.url,
        thumbnailUrl:
          item.image.thumbnailUrl ||
          signed[item.image.thumbnailPath] ||
          item.image.thumbnailUrl,
      },
    };
  });
}
