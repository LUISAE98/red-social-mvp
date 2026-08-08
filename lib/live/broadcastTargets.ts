import type { Firestore } from "firebase-admin/firestore";

/**
 * Filtra los destinos de "publicar también en…" (`liveData.broadcastGroupIds`) a
 * las comunidades que el creador REALMENTE puede usar: propias, no borradas y no
 * ocultas — exactamente las que ofrece el composer.
 *
 * ⚠️ Por qué existe: `broadcastGroupIds` lo escribe el cliente en SU PROPIO post
 * (las reglas se lo permiten, es suyo), y las rutas de broadcast usan Admin SDK,
 * que se salta las reglas. Sin este filtro, bastaba con meter cualquier groupId
 * en la lista para plantar el anillo del live en una comunidad ajena.
 *
 * `mustPointTo` permite exigir además que la comunidad esté apuntando a ese post
 * antes de apagarle el anillo, para no borrar el live de otra transmisión.
 */
export async function filterOwnedBroadcastGroupIds(
  db: Firestore,
  uid: string,
  groupIds: unknown,
  opts?: { mustPointTo?: string },
): Promise<string[]> {
  const ids = Array.isArray(groupIds)
    ? Array.from(
        new Set(
          groupIds.filter(
            (id): id is string => typeof id === "string" && id.trim().length > 0,
          ),
        ),
      )
    : [];

  if (ids.length === 0) return [];

  const snaps = await db.getAll(...ids.map((id) => db.collection("groups").doc(id)));

  return snaps
    .filter((snap) => {
      const data = snap.data();
      if (!snap.exists || !data) return false;
      if (data.isDeleted === true) return false;
      if (data.visibility === "hidden") return false;
      if (data.ownerId !== uid) return false;
      if (opts?.mustPointTo && data.activeLivePostId !== opts.mustPointTo) return false;
      return true;
    })
    .map((snap) => snap.id);
}
