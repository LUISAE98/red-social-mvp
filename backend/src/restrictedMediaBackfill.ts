/**
 * Cierra las imágenes YA SUBIDAS de comunidades privadas y ocultas.
 *
 * Desde este cambio, lo que se sube nuevo en esas comunidades ya no guarda URL
 * de descarga. Pero lo anterior sí la tiene, y esa URL lleva un token permanente
 * que abre el archivo sin sesión y para siempre. Mientras exista, la filtración
 * sigue abierta para ese contenido.
 *
 * Esto hace las dos mitades, que van juntas o no sirven:
 *  1. Quita el token del archivo en Storage → las URLs repartidas dejan de abrir.
 *  2. Vacía `url`/`thumbnailUrl` en Firestore → la app las pide firmadas.
 *
 * ⚠️ NO ES REVERSIBLE. Una vez quitado el token, las URLs que alguien tuviera
 * guardadas dejan de funcionar para siempre (que es justo el objetivo). Por eso
 * trae `dryRun`, que por defecto va ACTIVADO: la primera pasada solo cuenta.
 */

import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";

const db = getFirestore();
const ADMIN_EMAIL = "luis@consumed.mx";

/** Quita el token de descarga de un archivo. Sin token, su URL deja de abrir. */
async function stripDownloadToken(path: string): Promise<void> {
  const file = getStorage().bucket().file(path);
  const [exists] = await file.exists();
  if (!exists) return;

  await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: "" } });
}

type Counters = {
  gruposRevisados: number;
  postsTocados: number;
  comentariosTocados: number;
  archivosSinToken: number;
  errores: number;
};

export const backfillRestrictedMedia = onCall(
  { region: "us-central1", timeoutSeconds: 540, memory: "512MiB" },
  async (request) => {
    const email = request.auth?.token?.email;
    if (!email || email !== ADMIN_EMAIL) {
      throw new HttpsError("permission-denied", "Solo el administrador puede ejecutar esto.");
    }

    // Por defecto NO escribe: hay que pedir explícitamente que lo haga.
    const dryRun = request.data?.dryRun !== false;

    const counters: Counters = {
      gruposRevisados: 0,
      postsTocados: 0,
      comentariosTocados: 0,
      archivosSinToken: 0,
      errores: 0,
    };

    const groupsSnap = await db
      .collection("groups")
      .where("visibility", "in", ["private", "hidden"])
      .get();

    for (const groupDoc of groupsSnap.docs) {
      counters.gruposRevisados += 1;

      const postsSnap = await db
        .collection("posts")
        .where("groupId", "==", groupDoc.id)
        .get();

      for (const postDoc of postsSnap.docs) {
        try {
          const media = postDoc.data().media;
          if (Array.isArray(media)) {
            const paths: string[] = [];
            const nextMedia = media.map((item) => {
              if (!item || typeof item !== "object") return item;
              const next = { ...item };
              if (typeof next.path === "string" && next.url) {
                paths.push(next.path);
                next.url = "";
              }
              if (typeof next.thumbnailPath === "string" && next.thumbnailUrl) {
                paths.push(next.thumbnailPath);
                next.thumbnailUrl = null;
              }
              return next;
            });

            if (paths.length > 0) {
              counters.postsTocados += 1;
              counters.archivosSinToken += paths.length;
              if (!dryRun) {
                await Promise.all(paths.map(stripDownloadToken));
                await postDoc.ref.update({ media: nextMedia });
              }
            }
          }

          // Las imágenes de comentarios y respuestas del mismo post.
          const commentsSnap = await postDoc.ref.collection("comments").get();
          for (const commentDoc of commentsSnap.docs) {
            const refs = [
              commentDoc,
              ...(await commentDoc.ref.collection("replies").get()).docs,
            ];

            for (const docSnap of refs) {
              const image = docSnap.data().image;
              if (!image || typeof image !== "object") continue;
              if (!image.url && !image.thumbnailUrl) continue;

              const paths = [image.path, image.thumbnailPath].filter(
                (value): value is string => typeof value === "string" && !!value
              );
              if (paths.length === 0) continue;

              counters.comentariosTocados += 1;
              counters.archivosSinToken += paths.length;
              if (!dryRun) {
                await Promise.all(paths.map(stripDownloadToken));
                await docSnap.ref.update({
                  image: { ...image, url: "", thumbnailUrl: "" },
                });
              }
            }
          }
        } catch (error) {
          counters.errores += 1;
          logger.error("backfillRestrictedMedia: fallo en un post", {
            postId: postDoc.id,
            error,
          });
        }
      }
    }

    logger.info("backfillRestrictedMedia", { dryRun, ...counters });
    return { dryRun, ...counters };
  }
);
