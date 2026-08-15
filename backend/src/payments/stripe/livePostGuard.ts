/**
 * ¿Este documento es de verdad una publicación de EN VIVO?
 *
 * Lo comprobaban tres sitios de tres formas distintas, y dos estaban mal:
 *
 *   donaciones y supercomentarios → `if (!post.liveData && post.postType !== "live")`
 *   ticket de acceso             → `if (post.liveData == null)`
 *
 * La primera solo rechaza cuando fallan **las dos** condiciones, así que dejaba
 * pasar un post normal al que le colgara cualquier `liveData`, y también un post
 * marcado como live sin configuración ninguna. La segunda ni siquiera miraba el
 * tipo. Resultado: cobros asociados a publicaciones malformadas, supercomentarios
 * y donaciones sobre contenido que no es un directo, y accesos vendidos para algo
 * que no representa una transmisión.
 *
 * Es el mismo patrón que ya obligó a centralizar los guards de autorización en
 * `authz.ts`: criterios duplicados que se separan con el tiempo. Aquí hay uno
 * solo y los tres lo usan.
 */

import { HttpsError } from "firebase-functions/v2/https";

export function assertIsLivePost(post: Record<string, unknown>): void {
  const esTipoLive = post.postType === "live";
  const tieneConfiguracion =
    post.liveData != null &&
    typeof post.liveData === "object" &&
    !Array.isArray(post.liveData);

  // AND, no OR: tiene que ser de tipo directo Y traer su configuración.
  if (!esTipoLive || !tieneConfiguracion) {
    throw new HttpsError("failed-precondition", "Esta publicación no es un en vivo.");
  }
}
