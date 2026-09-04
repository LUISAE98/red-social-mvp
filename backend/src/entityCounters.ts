// Contadores de PUBLICACIONES y de MIEMBROS, mantenidos por el SERVIDOR.
//
// Por qué existen, y no se calculan al vuelo como antes: el card de la portada
// los pedía con `getCountFromServer` sobre las colecciones reales, y esa consulta
// pasa por las mismas reglas que LEER los documentos. A quien no es miembro de
// una comunidad privada, o mira un perfil restringido, las reglas se lo niegan —a
// propósito—, así que el card enseñaba un guion justo a quien había que
// convencer de entrar.
//
// Abrir las reglas no era opción: `getCountFromServer` comparte la regla `list`
// con la lectura, así que permitir el conteo habría permitido leer las
// publicaciones y la lista de miembros de cualquier comunidad privada.
//
// La salida es la que el proyecto ya usa para seguidores y experiencias: un
// número guardado en el documento, que es de lectura pública. Aquí lo lleva el
// servidor y no el cliente —a diferencia de `followersCount`— porque un contador
// solo puede derivarse de un hecho comprobable, y el hecho es la existencia del
// documento. Mismo criterio que `commentCounters.ts`.
//
// El cliente NO puede tocarlos: las reglas de `users` y `groups` acotan el update
// con `hasOnly([...])` y estos campos no están en esa lista.

import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import {
  onDocumentCreated,
  onDocumentDeleted,
  onDocumentUpdated,
  onDocumentWritten,
} from "firebase-functions/v2/firestore";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const REGION = "us-central1";

async function bump(
  ref: admin.firestore.DocumentReference,
  field: string,
  delta: number
): Promise<void> {
  try {
    await ref.update({
      [field]: admin.firestore.FieldValue.increment(delta),
    });
  } catch (err) {
    // El padre pudo borrarse antes que su hijo: no es un error que reintentar.
    logger.warn("entityCounters: no se pudo actualizar", {
      path: ref.path,
      field,
      delta,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/** El documento al que pertenece un post: su comunidad, o el perfil de su autor. */
function ownerRef(
  data: admin.firestore.DocumentData | undefined
): admin.firestore.DocumentReference | null {
  if (!data) return null;

  if (data.contextType === "group") {
    const groupId = typeof data.groupId === "string" ? data.groupId.trim() : "";
    return groupId ? db.collection("groups").doc(groupId) : null;
  }

  if (data.contextType === "profile") {
    const profileId = typeof data.profileId === "string" ? data.profileId.trim() : "";
    return profileId ? db.collection("users").doc(profileId) : null;
  }

  return null;
}

// Un post nace ya contado, salvo que nazca borrado (no ocurre hoy, pero el
// contador no debe fiarse de eso).
export const onPostsCountCreated = onDocumentCreated(
  { document: "posts/{postId}", region: REGION },
  async (event) => {
    const data = event.data?.data();
    if (!data || data.isDeleted === true) return;

    const ref = ownerRef(data);
    if (ref) await bump(ref, "postsCount", 1);
  }
);

/**
 * Retirar un post es un borrado LÓGICO (`isDeleted: true`), así que el descuento
 * vive aquí y no en `onDocumentDeleted`. Se mira el CAMBIO y no el estado: sin
 * eso, cualquier edición posterior de un post ya retirado volvería a restar.
 */
export const onPostsCountUpdated = onDocumentUpdated(
  { document: "posts/{postId}", region: REGION },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;

    const eraBorrado = before.isDeleted === true;
    const esBorrado = after.isDeleted === true;
    if (eraBorrado === esBorrado) return;

    // El contexto se toma del estado ANTERIOR: si la publicación cambió de sitio
    // en la misma escritura, lo que se descuenta es de donde estaba contada.
    const ref = ownerRef(esBorrado ? before : after);
    if (ref) await bump(ref, "postsCount", esBorrado ? -1 : 1);
  }
);

// El borrado duro existe (purgas, limpieza): solo descuenta si el post seguía
// contando, o sea si no estaba ya retirado.
export const onPostsCountDeleted = onDocumentDeleted(
  { document: "posts/{postId}", region: REGION },
  async (event) => {
    const data = event.data?.data();
    if (!data || data.isDeleted === true) return;

    const ref = ownerRef(data);
    if (ref) await bump(ref, "postsCount", -1);
  }
);

export const onMembersCountCreated = onDocumentCreated(
  { document: "groups/{groupId}/members/{userId}", region: REGION },
  async (event) => {
    await bump(db.collection("groups").doc(event.params.groupId), "membersCount", 1);
  }
);

export const onMembersCountDeleted = onDocumentDeleted(
  { document: "groups/{groupId}/members/{userId}", region: REGION },
  async (event) => {
    await bump(db.collection("groups").doc(event.params.groupId), "membersCount", -1);
  }
);

/**
 * Solicitudes de ingreso PENDIENTES, contadas en el documento de la comunidad.
 *
 * Por qué: el menú lateral del creador abría UNA escucha por comunidad sobre
 * `groups/{id}/joinRequests` solo para pintar el globito de «hay solicitudes».
 * Quien administra veinte comunidades pagaba veinte escuchas en cada pantalla,
 * y las abría de nuevo al navegar. Con el número en el documento del grupo el
 * globo sale gratis: el menú YA escucha los grupos del creador, así que son
 * veinte escuchas menos y ninguna nueva.
 *
 * La lista de quién pidió entrar se sigue leyendo de la subcolección, pero solo
 * cuando el creador abre esa comunidad — que es cuando de verdad hace falta.
 *
 * Un solo `onDocumentWritten` en vez de tres funciones porque aquí lo que cuenta
 * no es que el documento exista, sino que exista Y esté pendiente. Con triggers
 * separados esa condición habría que repetirla en los tres, y un rechazo (que
 * BORRA el documento) y una aprobación (que le cambia el estado) tendrían que
 * mantenerse en sintonía por separado. Comparar el antes y el después en un solo
 * sitio lo resuelve para los tres casos a la vez.
 */
function esPendiente(data: admin.firestore.DocumentData | undefined): boolean {
  return data?.status === "pending";
}

export const onJoinRequestsPendingCount = onDocumentWritten(
  { document: "groups/{groupId}/joinRequests/{userId}", region: REGION },
  async (event) => {
    const antes = esPendiente(event.data?.before.data());
    const despues = esPendiente(event.data?.after.data());

    // Ni entró ni salió del estado que se cuenta: no hay nada que mover. Cubre
    // también las ediciones que no tocan `status`.
    if (antes === despues) return;

    await bump(
      db.collection("groups").doc(event.params.groupId),
      "pendingJoinRequestsCount",
      despues ? 1 : -1
    );
  }
);
