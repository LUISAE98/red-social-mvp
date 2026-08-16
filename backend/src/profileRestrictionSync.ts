/**
 * Cuando alguien cierra su perfil, su contenido viejo tiene que enterarse.
 *
 * B8-C03 y B8-H02. Dos copias denormalizadas se escribían UNA VEZ, al crear, y
 * no se volvían a tocar nunca:
 *
 *  - `posts/{id}.profileRestricted` — la copia que consultan las búsquedas
 *    públicas. Las lecturas directas sí miran el perfil de verdad, así que
 *    cerrar el perfil escondía el post por un camino y lo dejaba a la vista por
 *    el otro.
 *  - `stories/{id}.searchable` — el campo del que depende ENTERA la regla de
 *    lectura de historias, porque leer el perfil en cada documento de un `list`
 *    agota el tope de 10 `get()` y tumba la consulta completa.
 *
 * Sobre las historias, además, había un agujero de origen: se consideraba
 * pública toda historia sin comunidad, sin mirar `profileRestricted`, `showPosts`
 * ni los bloqueos. Un perfil cerrado seguía saliendo en el feed de reels y en las
 * búsquedas, con su vídeo y su nombre.
 *
 * Decisión de producto de Luis (2026-08-16): al cerrar el perfil, las historias
 * desaparecen del feed público, igual que ya hacían las publicaciones.
 *
 * ⚠️ `retry: true` a propósito. Esto RETIRA acceso: si falla y no se reintenta,
 * el contenido de un perfil cerrado se queda visible para siempre y nadie se
 * entera. Es la misma lección de B7-C01 con la visibilidad de las comunidades.
 */

import * as admin from "firebase-admin";
import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";

const REGION = "us-central1";

/** Cuántos documentos se tocan por lote. Firestore admite 500 por batch. */
const TAMANO_LOTE = 400;

function db() {
  return admin.firestore();
}

/** ¿Este perfil se puede mostrar en público? Mismo criterio que las reglas. */
export function perfilEsPublico(perfil: Record<string, unknown> | undefined): boolean {
  if (!perfil) return false;

  return perfil.showPosts !== false && perfil.profileRestricted !== true;
}

/**
 * El valor honesto de `searchable` para una historia.
 *
 * Repite el criterio de las reglas y de `lib/stories/storyService.ts`: una
 * historia es públicamente legible si su contexto lo permite (perfil siempre;
 * comunidad solo si es pública) Y su creador no ha cerrado el perfil.
 */
export function searchableHonesto(
  historia: Record<string, unknown>,
  perfilPublico: boolean,
  comunidadEsPublica: (groupId: string) => boolean
): boolean {
  const groupId = typeof historia.groupId === "string" ? historia.groupId.trim() : "";
  const contextoPublico = groupId ? comunidadEsPublica(groupId) : true;

  return contextoPublico && perfilPublico;
}

/**
 * Recorre una consulta por lotes y aplica un cambio.
 *
 * Se pagina por `documentId()` en vez de acumularlo todo en memoria: un creador
 * con años de publicaciones no cabe de una sola vez, y esto tiene que terminar
 * también para él.
 */
async function actualizarPorLotes(
  consultaBase: admin.firestore.Query,
  cambio: (doc: admin.firestore.QueryDocumentSnapshot) => Record<string, unknown> | null,
  etiqueta: string
): Promise<number> {
  let ultimo: admin.firestore.QueryDocumentSnapshot | null = null;
  let tocados = 0;

  for (;;) {
    let consulta = consultaBase.orderBy(admin.firestore.FieldPath.documentId()).limit(TAMANO_LOTE);
    if (ultimo) consulta = consulta.startAfter(ultimo.id);

    const snap = await consulta.get();
    if (snap.empty) break;

    const batch = db().batch();
    let enEsteLote = 0;

    for (const doc of snap.docs) {
      const campos = cambio(doc);
      if (!campos) continue;

      batch.update(doc.ref, campos);
      enEsteLote++;
    }

    if (enEsteLote > 0) {
      await batch.commit();
      tocados += enEsteLote;
    }

    ultimo = snap.docs[snap.docs.length - 1];
    if (snap.size < TAMANO_LOTE) break;
  }

  logger.info(`profileRestrictionSync: ${etiqueta}`, { tocados });

  return tocados;
}

/** Cache de visibilidad de comunidades para no releer la misma en cada historia. */
async function cargarVisibilidades(groupIds: Set<string>): Promise<Map<string, boolean>> {
  const mapa = new Map<string, boolean>();
  if (groupIds.size === 0) return mapa;

  const ids = [...groupIds];
  const snaps = await db().getAll(...ids.map((id) => db().collection("groups").doc(id)));

  snaps.forEach((snap, i) => {
    mapa.set(ids[i], snap.exists && snap.data()?.visibility === "public");
  });

  return mapa;
}

async function resincronizarHistorias(uid: string, perfilPublico: boolean): Promise<void> {
  const historias = await db().collection("stories").where("creatorId", "==", uid).get();

  if (historias.empty) return;

  const groupIds = new Set<string>();
  for (const doc of historias.docs) {
    const groupId = doc.get("groupId");
    if (typeof groupId === "string" && groupId.trim()) groupIds.add(groupId.trim());
  }

  const visibilidades = await cargarVisibilidades(groupIds);
  const esPublica = (groupId: string) => visibilidades.get(groupId) === true;

  const batch = db().batch();
  let tocados = 0;

  for (const doc of historias.docs) {
    const deseado = searchableHonesto(doc.data(), perfilPublico, esPublica);
    if (doc.get("searchable") === deseado) continue;

    batch.update(doc.ref, { searchable: deseado });
    tocados++;
  }

  if (tocados > 0) await batch.commit();

  logger.info("profileRestrictionSync: historias", { uid, perfilPublico, tocados });
}

/**
 * El perfil cambió de estado, hay que repasar todo lo que dejó publicado.
 */
export const onProfileRestrictionChanged = onDocumentUpdated(
  { document: "users/{uid}", region: REGION, retry: true },
  async (event) => {
    const antes = event.data?.before.data();
    const despues = event.data?.after.data();
    if (!despues) return;

    const antesPublico = perfilEsPublico(antes);
    const despuesPublico = perfilEsPublico(despues);

    // Solo interesa el cambio de estado. Sin esto, cualquier escritura en el
    // perfil —un cambio de avatar— dispararía un barrido completo.
    if (antesPublico === despuesPublico) return;

    const uid = event.params.uid;

    logger.info("profileRestrictionSync: el perfil cambió de estado", {
      uid,
      antesPublico,
      despuesPublico,
    });

    // Las publicaciones llevan la copia al revés: `profileRestricted`.
    const restringido = !despuesPublico;

    // ⚠️ SOLO las publicaciones de perfil. En las de comunidad este campo vale
    // `null` A PROPÓSITO (`createPost` lo escribe así), y tanto las dos consultas
    // que lo usan como las dos ramas de reglas filtran antes por
    // `contextType == "profile"`. Pisar ese `null` con true/false no cambiaría
    // nada visible, pero rompería la convención y escribiría en cientos de
    // documentos para nada.
    //
    // El filtro va en código y no en la consulta para no depender de un índice
    // compuesto: `authorId` solo ya está indexado.
    await actualizarPorLotes(
      db().collection("posts").where("authorId", "==", uid),
      (doc) => {
        if (doc.get("contextType") !== "profile") return null;
        return doc.get("profileRestricted") === restringido
          ? null
          : { profileRestricted: restringido };
      },
      `posts de perfil de ${uid} → profileRestricted=${restringido}`
    );

    await resincronizarHistorias(uid, despuesPublico);
  }
);

/**
 * Red de seguridad al crear una historia.
 *
 * ⚠️ Esto existe porque la regla de creación NO puede exigir todavía el
 * `searchable` honesto: el cliente actual lo calcula sin mirar
 * `profileRestricted`, así que endurecer la regla antes de desplegar el frontend
 * dejaría a los perfiles cerrados sin poder publicar historias. Mientras tanto,
 * esto lo corrige en cuanto se escribe.
 *
 * Cuando el frontend esté desplegado y la regla cerrada, este disparador se
 * queda igualmente como segunda capa: el Admin SDK no pasa por las reglas y este
 * es el único sitio que ve la creación venga de donde venga.
 */
export const onStoryCreatedEnforceSearchable = onDocumentCreated(
  { document: "stories/{storyId}", region: REGION, retry: true },
  async (event) => {
    const historia = event.data?.data();
    if (!historia) return;

    if (historia.searchable !== true) return; // ya es restrictiva, nada que hacer

    const creatorId = typeof historia.creatorId === "string" ? historia.creatorId : "";
    if (!creatorId) return;

    const perfil = await db().collection("users").doc(creatorId).get();
    if (perfilEsPublico(perfil.data())) return;

    await event.data!.ref.update({ searchable: false });

    logger.info("profileRestrictionSync: historia de perfil cerrado marcada no buscable", {
      storyId: event.params.storyId,
      creatorId,
    });
  }
);
