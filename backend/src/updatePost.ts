/**
 * Editar una publicación, con el servidor decidiendo qué se guarda.
 *
 * B8-C01, la otra mitad. Los dos consumidores —`getRestrictedMediaUrls`, que
 * firma, y `postMediaCleanup`, que borra— ya ignoran las rutas ajenas, así que
 * el ataque está muerto. Esto cierra la ESCRITURA: que no se puedan meter en el
 * documento.
 *
 * Por qué un callable y no una regla: las Firestore Rules **no saben recorrer
 * una lista**. Se puede exigir que `media` sea una lista y acotar su tamaño,
 * pero no mirar dentro de cada elemento. Y `media` es exactamente una lista de
 * objetos con rutas. No hay forma de cerrarlo allí; es el mismo motivo que llevó
 * `createPost` al servidor en el bloque 4.
 *
 * De paso se cierran tres medios del mismo bloque:
 *
 *  - La edición no validaba longitud del texto, número de medios ni el esquema
 *    de cada medio: se podían meter campos arbitrarios en `media[]`.
 *  - Aceptaba URLs externas, que sirven de baliza para registrar la IP de quien
 *    abra la publicación.
 *  - El historial de edición se escribía en un `setDoc` APARTE del cambio. Si el
 *    segundo fallaba, quedaba un historial que no correspondía a nada. Aquí los
 *    dos van en la MISMA transacción.
 */

import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";

import { rutaPerteneceAlPost, prefijoDeMedios } from "./postMediaPaths";
import { assertAccountNotBanned } from "./accountStatus";

const REGION = "us-central1";

/** Los mismos topes que `createPost`. Si cambian allá, cambian aquí. */
const MAX_TEXT = 5000;
const MAX_MEDIA = 10;

/** Las mismas claves que `CAMPOS_MEDIA` en `createPost`. */
const CAMPOS_MEDIA = new Set([
  "type", "id", "index", "url", "path", "thumbnailUrl", "thumbnailPath",
  "altText", "width", "height", "size", "mimeType",
  "provider", "status", "uploadId", "assetId", "playbackId", "hlsUrl", "duration",
]);

/**
 * Hosts a los que puede apuntar una `url` de medio.
 *
 * Firebase Storage sirve las imágenes; Mux y Cloudflare, el vídeo. Cualquier
 * otro host convierte la publicación en una baliza: quien la abra le entrega su
 * IP a un tercero sin enterarse.
 */
const HOSTS_PERMITIDOS = [
  "firebasestorage.googleapis.com",
  "storage.googleapis.com",
  "image.mux.com",
  "stream.mux.com",
];

function esHostPermitido(url: unknown): boolean {
  if (typeof url !== "string" || url.length === 0) return true; // vacía es válida: un vídeo en proceso aún no tiene URL

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:") return false;

  return (
    HOSTS_PERMITIDOS.includes(parsed.host) ||
    parsed.host.endsWith(".mux.com") ||
    parsed.host.endsWith(".cloudflarestream.com")
  );
}

function soloClaves(value: unknown, permitidas: Set<string>): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const salida: Record<string, unknown> = {};
  for (const [clave, bruto] of Object.entries(value as Record<string, unknown>)) {
    if (permitidas.has(clave)) salida[clave] = bruto;
  }
  return salida;
}

export const updatePost = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");

  const proveedor = (
    request.auth?.token as { firebase?: { sign_in_provider?: string } } | undefined
  )?.firebase?.sign_in_provider;
  if (proveedor === "anonymous") {
    throw new HttpsError("permission-denied", "Necesitas una cuenta para editar.");
  }

  await assertAccountNotBanned(uid);

  const data = (request.data ?? {}) as Record<string, unknown>;
  const postId = String(data.postId ?? "").trim();
  if (!postId) throw new HttpsError("invalid-argument", "Falta la publicación.");

  const texto = typeof data.text === "string" ? data.text.trim() : "";
  if (texto.length > MAX_TEXT) {
    throw new HttpsError("invalid-argument", "El texto es demasiado largo.");
  }

  const mediaBruta = Array.isArray(data.media) ? data.media : [];
  if (mediaBruta.length > MAX_MEDIA) {
    throw new HttpsError("invalid-argument", "Demasiados archivos en una publicación.");
  }

  const db = admin.firestore();
  const postRef = db.collection("posts").doc(postId);
  const historialRef = postRef.collection("editHistory").doc();

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(postRef);
    if (!snap.exists) throw new HttpsError("not-found", "La publicación no existe.");

    const post = snap.data() ?? {};

    if (post.authorId !== uid) {
      throw new HttpsError("permission-denied", "Solo el autor puede editar esta publicación.");
    }
    if (post.isDeleted === true) {
      throw new HttpsError("failed-precondition", "No se puede editar una publicación eliminada.");
    }

    // ── El corazón de C01 ────────────────────────────────────────────────────
    //
    // Cada ruta declarada tiene que caer bajo el prefijo de ESTE post y de SU
    // autor. No basta con acertar la comunidad: el uid va en la ruta.
    const media: Record<string, unknown>[] = [];

    for (const bruto of mediaBruta) {
      const item = soloClaves(bruto, CAMPOS_MEDIA);
      if (!item) continue;

      for (const clave of ["path", "thumbnailPath"] as const) {
        const ruta = item[clave];
        if (ruta === undefined || ruta === null) continue;

        if (!rutaPerteneceAlPost(ruta, post)) {
          logger.warn("updatePost: ruta ajena rechazada", {
            postId,
            uid,
            clave,
            ruta,
            prefijoEsperado: prefijoDeMedios(post),
          });
          throw new HttpsError(
            "permission-denied",
            "Uno de los archivos no pertenece a esta publicación."
          );
        }
      }

      for (const clave of ["url", "thumbnailUrl"] as const) {
        if (!esHostPermitido(item[clave])) {
          throw new HttpsError(
            "invalid-argument",
            "Uno de los enlaces apunta fuera de los servidores permitidos."
          );
        }
      }

      media.push(item);
    }

    const ahora = admin.firestore.FieldValue.serverTimestamp();

    // El historial y el cambio, en la MISMA transacción. Antes eran dos
    // escrituras sueltas y el historial podía quedar huérfano.
    tx.set(historialRef, {
      editedAt: ahora,
      editedBy: uid,
      previousText: typeof post.text === "string" ? post.text : "",
      previousMedia: Array.isArray(post.media) ? post.media : [],
    });

    tx.update(postRef, {
      text: texto,
      media,
      editedAt: ahora,
      updatedAt: ahora,
    });
  });

  return { ok: true };
});
