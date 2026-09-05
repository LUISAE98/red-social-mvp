/**
 * URLs firmadas para las imágenes de mensajes directos.
 *
 * Las imágenes de DM NO se sirven con la URL pública de Firebase Storage: esa
 * URL lleva un token permanente y quien la tenga puede abrir el archivo para
 * siempre, aunque luego bloquees a la persona o borres el mensaje.
 *
 * Aquí se comprueba contra Firestore que quien pide la imagen es participante de
 * esa conversación, y se devuelve una URL firmada que CADUCA. Es el mismo patrón
 * que `recordingDownload.ts` usa para las grabaciones de sesiones.
 *
 * Las reglas de Storage no pueden hacer esto por su cuenta: no pueden consultar
 * Firestore, así que no saben quién participa en un hilo.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { usersHaveBlockBetween } from "./social/blocks";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();
const REGION = "us-central1";

/** Una hora, igual que la descarga de grabaciones. */
const URL_TTL_MS = 60 * 60 * 1000;

/**
 * Tope de rutas por llamada. Un hilo pide de golpe las imágenes que tiene
 * cargadas; con la página de 30 mensajes nunca se acerca a este número.
 */
const MAX_PATHS = 60;

type RequestData = {
  conversationId?: string;
  paths?: string[];
};

type ResponseData = {
  /** ruta → URL firmada. Las rutas inválidas simplemente no aparecen. */
  urls: Record<string, string>;
  /** Milisegundos de epoch en que caducan. El cliente refresca antes. */
  expiresAt: number;
};

/** Trocea una lista para las consultas `in` de Firestore, que topan en 10. */
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * De las rutas pedidas, devuelve solo las que siguen colgando de un mensaje que
 * `uid` puede ver: ni borrado para todos (`isDeleted`), ni ocultado por él
 * (`deletedFor`).
 *
 * Se buscan por los dos campos porque cada mensaje guarda la imagen y su
 * miniatura en rutas distintas.
 */
async function filterPathsWithLiveMessage(
  conversationId: string,
  uid: string,
  requested: string[]
): Promise<string[]> {
  if (requested.length === 0) return [];

  const messages = db.collection("conversations").doc(conversationId).collection("messages");
  const vivas = new Set<string>();

  await Promise.all(
    chunk(requested, 10).flatMap((grupo) =>
      ["image.path", "image.thumbnailPath"].map(async (campo) => {
        const snap = await messages.where(campo, "in", grupo).get();
        for (const doc of snap.docs) {
          if (doc.get("isDeleted") === true) continue;
          const deletedFor = doc.get("deletedFor");
          if (Array.isArray(deletedFor) && deletedFor.includes(uid)) continue;

          const image = doc.get("image");
          if (!image || typeof image !== "object") continue;
          const { path, thumbnailPath } = image as Record<string, unknown>;
          if (typeof path === "string") vivas.add(path);
          if (typeof thumbnailPath === "string") vivas.add(thumbnailPath);
        }
      })
    )
  );

  return requested.filter((p) => vivas.has(p));
}

export const getDirectMessageImageUrls = onCall<RequestData, Promise<ResponseData>>(
  {
    region: REGION,
    // Ver la nota extensa en sidebarGroups.ts: con la CPU por defecto la
    // concurrencia queda forzada a 1 y cada petición simultánea arranca una
    // instancia nueva, en frío. Esto NO es minInstances: no mantiene nada
    // encendido, solo deja que una instancia caliente sirva a muchos.
    cpu: 1,
    concurrency: 80,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
    }

    const conversationId = (request.data?.conversationId ?? "").trim();
    if (!conversationId) {
      throw new HttpsError("invalid-argument", "Falta la conversación.");
    }

    const paths = Array.isArray(request.data?.paths) ? request.data.paths : [];
    if (paths.length === 0) {
      return { urls: {}, expiresAt: Date.now() + URL_TTL_MS };
    }
    if (paths.length > MAX_PATHS) {
      throw new HttpsError("invalid-argument", "Demasiadas imágenes en una llamada.");
    }

    // Gate real: solo los dos participantes del hilo.
    const convSnap = await db.collection("conversations").doc(conversationId).get();
    if (!convSnap.exists) {
      throw new HttpsError("not-found", "La conversación no existe.");
    }
    const participants = convSnap.data()?.participants;
    if (!Array.isArray(participants) || !participants.includes(uid)) {
      throw new HttpsError("permission-denied", "No participas en esta conversación.");
    }

    // ⚠️ B9-medio. Participar no basta: hay que seguir sin bloqueo.
    //
    // Antes se comprobaba la participación y la visibilidad del mensaje, pero no
    // el bloqueo, así que quien te bloqueó —o a quien bloqueaste— podía seguir
    // renovando indefinidamente las URLs de todas las imágenes del historial.
    // El bloqueo cortaba los mensajes nuevos y dejaba abierto el archivo.
    //
    // Decisión de producto de Luis (2026-08-16): al bloquear, el hilo se cierra
    // DEL TODO, y eso incluye no poder volver a abrir lo ya enviado.
    const otro = participants.find((p) => p !== uid);
    if (typeof otro === "string" && otro) {
      if (await usersHaveBlockBetween(uid, otro)) {
        throw new HttpsError(
          "permission-denied",
          "Esta conversación está bloqueada."
        );
      }
    }

    // Una ruta de OTRA conversación no se firma aunque sí participes en esta:
    // sin esto, cualquiera podría pedir imágenes de hilos ajenos.
    const prefix = `dmImages/${conversationId}/`;
    const requested = paths.filter(
      (p) => typeof p === "string" && p.startsWith(prefix) && !p.includes("..")
    );

    // ⚠️ El prefijo NO basta. Antes se firmaba cualquier ruta que empezara por
    // esta conversación, así que quien se hubiera guardado la ruta de una imagen
    // podía seguir renovando su URL DESPUÉS de que el mensaje se borrara para
    // todos, o de haberla ocultado para sí mismo. Borrar no borraba nada.
    //
    // Ahora se firma solo lo que sigue colgando de un mensaje que esta persona
    // puede ver de verdad.
    const allowed = await filterPathsWithLiveMessage(conversationId, uid, requested);

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
          // Un archivo borrado o inaccesible no debe tumbar el resto del hilo.
          logger.warn("getDirectMessageImageUrls: no se pudo firmar", { path, error });
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
