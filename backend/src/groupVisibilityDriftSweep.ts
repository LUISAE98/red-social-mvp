/**
 * Barrido diario: encuentra comunidades NO públicas cuyos posts siguen diciendo
 * que son públicos, y las resincroniza.
 *
 * ── Por qué hace falta si el trigger ya reintenta ────────────────────────────
 * `onGroupVisibilityPostsSync` ahora reintenta hasta que sale bien, así que
 * cubre lo que pase de ahora en adelante. Pero no cubre:
 *
 *  · la deriva que YA exista, de cuando el trigger se tragaba los errores;
 *  · un cambio de visibilidad anterior a que el trigger existiera;
 *  · los reintentos agotados (Firebase los abandona a los ~7 días).
 *
 * Y la deriva no es cosmética: las reglas de LISTADO deciden quién ve un post
 * con la copia `groupVisibility` que lleva el propio post, no consultando la
 * comunidad —hacerlo documento a documento reventaría la cuota de `get()`—. Una
 * copia congelada en `public` es contenido de una comunidad privada u oculta
 * abierto a cualquiera.
 *
 * ── Por qué se recorre por COMUNIDAD y no por post ───────────────────────────
 * Recorrer todos los posts de la plataforma cada día es caro y crece sin
 * límite. Las comunidades no públicas son pocas, y por cada una basta una
 * consulta acotada: sus posts que aún se declaran públicos. Si no hay deriva, la
 * consulta vuelve vacía y no cuesta casi nada.
 */

import { getFirestore } from "firebase-admin/firestore";
import { getApps, initializeApp } from "firebase-admin/app";
import * as logger from "firebase-functions/logger";

import { syncPostsVisibility, syncStoriesSearchable } from "./groupPostsVisibilitySync";

if (!getApps().length) {
  initializeApp();
}

const db = getFirestore();

/** Tope por corrida, para que un día malo no se convierta en una factura mala. */
const MAX_COMUNIDADES_POR_CORRIDA = 200;

export async function sweepGroupVisibilityDriftHandler(): Promise<{
  revisadas: number;
  corregidas: number;
}> {
  const snap = await db
    .collection("groups")
    .where("visibility", "in", ["private", "hidden"])
    .limit(MAX_COMUNIDADES_POR_CORRIDA)
    .get();

  let revisadas = 0;
  let corregidas = 0;

  for (const doc of snap.docs) {
    revisadas += 1;
    const groupId = doc.id;
    const visibility = typeof doc.get("visibility") === "string" ? doc.get("visibility") : null;

    // ¿Queda algún post declarándose público? Con uno basta para saber que esa
    // comunidad quedó a medio sincronizar.
    const derivados = await db
      .collection("posts")
      .where("groupId", "==", groupId)
      .where("groupVisibility", "==", "public")
      .limit(1)
      .get();

    if (derivados.empty) continue;

    logger.error("visibilityDrift: comunidad no pública con posts públicos", {
      groupId,
      visibility,
    });

    try {
      const posts = await syncPostsVisibility(groupId, visibility);
      const historias = await syncStoriesSearchable(groupId, visibility);
      corregidas += 1;
      logger.info("visibilityDrift: corregida", { groupId, visibility, posts, historias });
    } catch (error) {
      // No se lanza: un grupo que falla no debe impedir revisar los demás. Queda
      // registrado y el barrido de mañana vuelve a intentarlo.
      logger.error("visibilityDrift: no se pudo corregir", { groupId, error });
    }
  }

  logger.info("visibilityDrift: barrido terminado", { revisadas, corregidas });
  return { revisadas, corregidas };
}
