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

/**
 * ¿Puede esta persona plantar el anillo de "en vivo" en esta comunidad?
 *
 * ⚠️ Las rutas de broadcast comprobaban solo que fueras el AUTOR del post, y
 * luego escribían `activeLivePostId` en `post.groupId` con Admin SDK, que se
 * salta las reglas. O sea que el permiso se decidía con un campo del documento y
 * nunca se volvía a verificar contra la comunidad.
 *
 * Importa incluso con el post bien formado: entre crearlo y transmitir pueden
 * pasar días, y en ese tiempo a la persona la pueden banear, expulsar, o la
 * comunidad puede cerrar las publicaciones a solo el dueño.
 *
 * Mismo criterio que `canPostInGroup` de las reglas: el dueño siempre; los demás
 * solo si la comunidad deja publicar a sus miembros y su estado es válido.
 */
export async function canBroadcastToGroup(
  db: Firestore,
  uid: string,
  groupId: string,
): Promise<boolean> {
  const groupSnap = await db.collection("groups").doc(groupId).get();
  if (!groupSnap.exists) return false;

  const group = groupSnap.data() ?? {};
  if (group.isActive === false) return false;
  if (group.ownerId === uid) return true;

  // La comunidad puede tener las publicaciones reservadas a su dueño.
  const postingMode = typeof group.postingMode === "string" ? group.postingMode : "members";
  if (postingMode !== "members") return false;

  const memberSnap = await groupSnap.ref.collection("members").doc(uid).get();
  if (!memberSnap.exists) return false;

  const status = memberSnap.get("status");
  return status === "active" || status === "subscribed";
}
