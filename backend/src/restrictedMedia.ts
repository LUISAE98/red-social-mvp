/**
 * URLs firmadas para los medios de comunidades PRIVADAS y OCULTAS.
 *
 * El problema que resuelve: hasta ahora toda imagen se guardaba con la URL de
 * descarga de Firebase, que lleva un token permanente dentro. Esa URL abre el
 * archivo sin sesión, para siempre, y no consulta las Storage Rules. O sea que
 * la foto de un post de una comunidad oculta se abría con solo tener el enlace
 * — aunque no fueras miembro, aunque te hubieran sacado, aunque el post ya no
 * existiera.
 *
 * Aquí se comprueba contra Firestore que quien pide puede leer ese post, y se
 * devuelve una URL que CADUCA. Es el mismo patrón que `dmImages.ts`.
 *
 * Solo aplica a privadas y ocultas: lo público sigue con su URL directa, que es
 * más barato y no tiene nada que proteger.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();
const REGION = "us-central1";

/** Una hora, igual que las imágenes de DM. */
const URL_TTL_MS = 60 * 60 * 1000;

/**
 * Tope de rutas por llamada. Un feed pide de golpe lo que tiene en pantalla;
 * con las páginas actuales no se acerca a este número.
 */
const MAX_PATHS = 120;

type RequestData = {
  postId?: string;
  paths?: string[];
};

type ResponseData = {
  /** ruta → URL firmada. Las rutas inválidas simplemente no aparecen. */
  urls: Record<string, string>;
  expiresAt: number;
};

/**
 * ¿Puede este usuario ver el contenido de esa comunidad?
 *
 * Dueño o miembro. Se mira el doc de miembro directamente: es la misma fuente
 * que usan las reglas de Firestore para el resto del contenido del grupo.
 */
async function canReadGroup(groupId: string, uid: string): Promise<boolean> {
  const groupSnap = await db.collection("groups").doc(groupId).get();
  if (!groupSnap.exists) return false;

  const group = groupSnap.data() ?? {};
  const visibility = typeof group.visibility === "string" ? group.visibility : "public";

  // Lo público no necesita permiso: si alguien llama aquí para una comunidad
  // abierta, se le firma igual y no pasa nada.
  if (visibility !== "private" && visibility !== "hidden") return true;

  if (group.ownerId === uid) return true;

  const memberSnap = await db
    .collection("groups")
    .doc(groupId)
    .collection("members")
    .doc(uid)
    .get();

  if (!memberSnap.exists) return false;

  // ⚠️ Antes bastaba con que el documento EXISTIERA, y ahí estaba el agujero: al
  // banear o expulsar a alguien su documento de miembro NO se borra, se queda
  // con `status: banned` o `removed` para conservar el historial. Las Firestore
  // Rules sí lo tienen en cuenta, pero esta función no, así que un expulsado
  // seguía obteniendo URLs firmadas de las imágenes de la comunidad — y podía
  // renovarlas indefinidamente.
  //
  // Mismo criterio que `isReadableMemberStatus` en firestore.rules: los estados
  // sancionados pierden el acceso; ausente cuenta como miembro normal (datos
  // antiguos, anteriores al campo).
  const status = memberSnap.get("status");
  return status === undefined || ["active", "subscribed", "muted"].includes(String(status));
}

/**
 * ¿Puede este usuario ver los medios de un post de PERFIL?
 *
 * Un perfil restringido solo se lo lee su dueño — mismo criterio que
 * `canReadProfileContent` en firestore.rules, donde no hay excepción ni para
 * seguidores.
 *
 * ⚠️ Aquí antes no se comprobaba nada: "sin grupo es un post de perfil, no hay
 * comunidad que restrinja nada". Cierto para la comunidad, falso para el perfil,
 * así que cualquier cuenta con sesión podía pedir firmadas las fotos de un
 * perfil privado.
 *
 * La restricción se lee del PERFIL, no de la copia `profileRestricted` que lleva
 * el post: esa se escribe al publicar y no se actualiza si el perfil se cierra
 * después.
 */
async function canReadProfilePost(
  post: FirebaseFirestore.DocumentData,
  uid: string
): Promise<boolean> {
  const profileId =
    typeof post.profileId === "string" && post.profileId
      ? post.profileId
      : typeof post.authorId === "string" && post.authorId
        ? post.authorId
        : null;

  if (!profileId) return false;
  if (profileId === uid) return true;

  const perfil = await db.collection("users").doc(profileId).get();
  return perfil.get("profileRestricted") !== true;
}

export const getRestrictedMediaUrls = onCall<RequestData, Promise<ResponseData>>(
  { region: REGION },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
    }

    const postId = (request.data?.postId ?? "").trim();
    if (!postId) {
      throw new HttpsError("invalid-argument", "Falta la publicación.");
    }

    const paths = Array.isArray(request.data?.paths) ? request.data.paths : [];
    if (paths.length === 0) {
      return { urls: {}, expiresAt: Date.now() + URL_TTL_MS };
    }
    if (paths.length > MAX_PATHS) {
      throw new HttpsError("invalid-argument", "Demasiadas imágenes en una llamada.");
    }

    const postSnap = await db.collection("posts").doc(postId).get();
    if (!postSnap.exists) {
      throw new HttpsError("not-found", "La publicación no existe.");
    }

    const post = postSnap.data() ?? {};
    const groupId = typeof post.groupId === "string" ? post.groupId : null;

    if (groupId) {
      if (!(await canReadGroup(groupId, uid))) {
        throw new HttpsError("permission-denied", "No tienes acceso a esta comunidad.");
      }
    } else if (!(await canReadProfilePost(post, uid))) {
      throw new HttpsError("permission-denied", "Este perfil es privado.");
    }

    // ⚠️ Antes se aceptaba cualquier ruta bajo `posts/{groupId}/`, o sea
    // cualquier archivo de la comunidad entera: bastaba con ser miembro y
    // conocer la ruta para pedir firmados los medios de OTRO post, o de uno
    // borrado, o un archivo huérfano. Ahora las rutas de post se comparan contra
    // los medios de ESTE post, uno a uno.
    //
    // Las de comentario no lo necesitan: `commentImages/{postId}/` ya está atado
    // al post por su propia forma.
    const mediaPaths = new Set<string>();
    const media = Array.isArray(post.media) ? post.media : [];
    for (const item of media) {
      if (!item || typeof item !== "object") continue;
      const { path, thumbnailPath } = item as Record<string, unknown>;
      if (typeof path === "string" && path) mediaPaths.add(path);
      if (typeof thumbnailPath === "string" && thumbnailPath) mediaPaths.add(thumbnailPath);
    }

    const allowed = paths.filter(
      (p) =>
        typeof p === "string" &&
        !p.includes("..") &&
        (p.startsWith(`commentImages/${postId}/`) || mediaPaths.has(p))
    );

    const bucket = admin.storage().bucket();
    const expires = Date.now() + URL_TTL_MS;

    const entries = await Promise.all(
      allowed.map(async (path): Promise<[string, string] | null> => {
        try {
          const [url] = await bucket.file(path).getSignedUrl({
            version: "v4",
            action: "read",
            expires,
          });
          return [path, url];
        } catch (error) {
          // Un archivo borrado no debe tumbar el resto del feed.
          logger.warn("getRestrictedMediaUrls: no se pudo firmar", { path, error });
          return null;
        }
      })
    );

    const urls: Record<string, string> = {};
    for (const entry of entries) {
      if (entry) urls[entry[0]] = entry[1];
    }

    return { urls, expiresAt: expires };
  }
);
