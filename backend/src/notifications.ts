/**
 * Notificaciones sociales — triggers de Firestore que generan las notificaciones
 * in-app de la campanita. Todas las notificaciones a OTROS usuarios se escriben
 * exclusivamente desde el backend (Admin SDK); las Firestore Rules bloquean la
 * escritura desde cliente.
 *
 * Agregación: los eventos del mismo tipo sobre el mismo objetivo colapsan en un
 * único documento cuyo id es determinista (`groupKey`). Ej.: varios likes al
 * mismo post = un solo doc `post_like_{postId}` con la lista de actores y un
 * contador. Al llegar un actor nuevo se antepone a la lista, se incrementa el
 * contador y la notificación vuelve a marcarse como no leída (re-emerge arriba).
 */
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();
const REGION = "us-central1";

/** Cuántos actores recientes conservamos para mostrar avatares apilados. */
const MAX_VISIBLE_ACTORS = 5;
/** Tope de ids que guardamos para de-duplicar (evita documentos gigantes). */
const MAX_DEDUPE_IDS = 500;

type NotificationType =
  | "post_like"
  | "comment"
  | "reply"
  | "comment_like"
  | "mention"
  | "follow"
  | "join_request"
  | "join_approved"
  | "group_new_member";

interface Actor {
  id: string;
  name: string;
  avatarUrl: string | null;
  handle: string | null;
}

interface Target {
  postId?: string | null;
  commentId?: string | null;
  groupId?: string | null;
  groupName?: string | null;
  handle?: string | null;
  preview?: string | null;
  imageUrl?: string | null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Resuelve nombre/avatar/handle de un usuario desde `users/{uid}`. */
async function resolveActor(uid: string): Promise<Actor> {
  try {
    const snap = await db.collection("users").doc(uid).get();
    const d = snap.data() ?? {};
    return {
      id: uid,
      name: str(d.displayName) ?? str(d.name) ?? str(d.username) ?? str(d.handle) ?? "Alguien",
      avatarUrl: str(d.avatarUrl) ?? str(d.photoURL) ?? null,
      handle: str(d.username) ?? str(d.handle) ?? null,
    };
  } catch {
    return { id: uid, name: "Alguien", avatarUrl: null, handle: null };
  }
}

/** Construye el `target` a partir del documento del post. */
function buildPostTarget(postId: string, post: admin.firestore.DocumentSnapshot): Target {
  const media = post.get("media");
  let imageUrl: string | null = null;
  if (Array.isArray(media) && media.length > 0) {
    imageUrl = str(media[0]?.thumbnailUrl) ?? str(media[0]?.url);
  }
  if (!imageUrl) imageUrl = str(post.get("shareImageUrl"));
  return {
    postId,
    groupId: str(post.get("groupId")),
    handle: str(post.get("authorUsername")),
    preview: str(post.get("text"))?.slice(0, 120) ?? null,
    imageUrl,
  };
}

/**
 * Escribe (o agrega a) una notificación agregada en la bandeja del destinatario.
 * Idempotente: reprocesar el mismo actor no duplica el conteo.
 */
async function emit(opts: {
  recipientId: string | null | undefined;
  groupKey: string;
  type: NotificationType;
  actor: Actor;
  target: Target;
}): Promise<void> {
  const { recipientId, groupKey, type, actor, target } = opts;
  if (!recipientId || recipientId === actor.id) return;

  const ref = db
    .collection("users")
    .doc(recipientId)
    .collection("notifications")
    .doc(groupKey);

  await db.runTransaction(async (tx) => {
    const cur = await tx.get(ref);
    const now = admin.firestore.FieldValue.serverTimestamp();

    if (!cur.exists) {
      tx.set(ref, {
        type,
        groupKey,
        actors: [actor],
        actorIds: [actor.id],
        actorCount: 1,
        target,
        read: false,
        createdAt: now,
        updatedAt: now,
      });
      return;
    }

    const data = cur.data() ?? {};
    const prevActors: Actor[] = Array.isArray(data.actors) ? data.actors : [];
    const prevIds: string[] = Array.isArray(data.actorIds) ? data.actorIds : [];
    const isNewActor = !prevIds.includes(actor.id);

    const nextActors = [actor, ...prevActors.filter((a) => a?.id !== actor.id)].slice(
      0,
      MAX_VISIBLE_ACTORS
    );
    const nextIds = (isNewActor ? [actor.id, ...prevIds] : prevIds).slice(0, MAX_DEDUPE_IDS);
    const prevCount = typeof data.actorCount === "number" ? data.actorCount : prevIds.length;

    tx.update(ref, {
      type,
      actors: nextActors,
      actorIds: nextIds,
      actorCount: isNewActor ? prevCount + 1 : prevCount,
      target,
      read: false,
      updatedAt: now,
    });
  });
}

/** Emite una notificación de mención por cada perfil mencionado. */
async function emitMentions(
  mentions: unknown,
  actor: Actor,
  target: Target,
  groupKey: string,
  excludeIds: Set<string>
): Promise<void> {
  if (!Array.isArray(mentions)) return;
  const seen = new Set<string>();
  for (const m of mentions) {
    const id = str(m?.id);
    if (!m || m.type !== "profile" || !id) continue;
    if (seen.has(id) || excludeIds.has(id)) continue;
    seen.add(id);
    await emit({ recipientId: id, groupKey, type: "mention", actor, target });
  }
}

// ---------------------------------------------------------------------------
// 1. Like a un post → autor del post
// ---------------------------------------------------------------------------
export const onPostReactionCreated = onDocumentCreated(
  { document: "posts/{postId}/reactions/{actorId}", region: REGION },
  async (event) => {
    const { postId, actorId } = event.params;
    const post = await db.collection("posts").doc(postId).get();
    if (!post.exists) return;
    const authorId = str(post.get("authorId"));
    if (!authorId || authorId === actorId) return;

    const actor = await resolveActor(actorId);
    await emit({
      recipientId: authorId,
      groupKey: `post_like_${postId}`,
      type: "post_like",
      actor,
      target: buildPostTarget(postId, post),
    });
  }
);

// ---------------------------------------------------------------------------
// 2. Comentario en un post → autor del post (+ menciones)
// ---------------------------------------------------------------------------
export const onPostCommentCreated = onDocumentCreated(
  { document: "posts/{postId}/comments/{commentId}", region: REGION },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;
    const { postId, commentId } = event.params;

    const actor: Actor = {
      id: str(data.authorId) ?? "",
      name: str(data.authorName) ?? "Alguien",
      avatarUrl: str(data.authorAvatarUrl),
      handle: str(data.authorUsername),
    };
    if (!actor.id) return;

    const post = await db.collection("posts").doc(postId).get();
    if (!post.exists) return;
    const authorId = str(post.get("authorId"));
    const base = buildPostTarget(postId, post);
    const target: Target = { ...base, commentId, preview: str(data.text)?.slice(0, 120) ?? null };

    // Menciones primero, para no duplicar aviso al autor si además fue mencionado.
    const mentionedIds = new Set<string>();
    if (Array.isArray(data.mentions)) {
      for (const m of data.mentions) {
        const id = str(m?.id);
        if (m?.type === "profile" && id) mentionedIds.add(id);
      }
    }
    await emitMentions(data.mentions, actor, target, `mention_c_${commentId}`, new Set([actor.id]));

    if (authorId && authorId !== actor.id && !mentionedIds.has(authorId)) {
      await emit({
        recipientId: authorId,
        groupKey: `post_comment_${postId}`,
        type: "comment",
        actor,
        target,
      });
    }
  }
);

// ---------------------------------------------------------------------------
// 3. Respuesta a un comentario → autor del comentario (+ menciones)
// ---------------------------------------------------------------------------
export const onPostCommentReplyCreated = onDocumentCreated(
  { document: "posts/{postId}/comments/{commentId}/replies/{replyId}", region: REGION },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;
    const { postId, commentId } = event.params;

    const actor: Actor = {
      id: str(data.authorId) ?? "",
      name: str(data.authorName) ?? "Alguien",
      avatarUrl: str(data.authorAvatarUrl),
      handle: str(data.authorUsername),
    };
    if (!actor.id) return;

    const post = await db.collection("posts").doc(postId).get();
    const base = post.exists ? buildPostTarget(postId, post) : { postId };
    const target: Target = { ...base, commentId, preview: str(data.text)?.slice(0, 120) ?? null };

    const comment = await db
      .collection("posts")
      .doc(postId)
      .collection("comments")
      .doc(commentId)
      .get();
    const commentAuthorId = str(comment.get("authorId"));

    const mentionedIds = new Set<string>();
    if (Array.isArray(data.mentions)) {
      for (const m of data.mentions) {
        const id = str(m?.id);
        if (m?.type === "profile" && id) mentionedIds.add(id);
      }
    }
    await emitMentions(data.mentions, actor, target, `mention_r_${commentId}`, new Set([actor.id]));

    if (commentAuthorId && commentAuthorId !== actor.id && !mentionedIds.has(commentAuthorId)) {
      await emit({
        recipientId: commentAuthorId,
        groupKey: `comment_reply_${commentId}`,
        type: "reply",
        actor,
        target,
      });
    }
  }
);

// ---------------------------------------------------------------------------
// 4. Like a un comentario → autor del comentario
// ---------------------------------------------------------------------------
export const onCommentReactionCreated = onDocumentCreated(
  { document: "posts/{postId}/comments/{commentId}/reactions/{actorId}", region: REGION },
  async (event) => {
    const { postId, commentId, actorId } = event.params;
    const comment = await db
      .collection("posts")
      .doc(postId)
      .collection("comments")
      .doc(commentId)
      .get();
    if (!comment.exists) return;
    const commentAuthorId = str(comment.get("authorId"));
    if (!commentAuthorId || commentAuthorId === actorId) return;

    const post = await db.collection("posts").doc(postId).get();
    const base = post.exists ? buildPostTarget(postId, post) : { postId };
    const target: Target = { ...base, commentId, preview: str(comment.get("text"))?.slice(0, 120) ?? null };

    const actor = await resolveActor(actorId);
    await emit({
      recipientId: commentAuthorId,
      groupKey: `comment_like_${commentId}`,
      type: "comment_like",
      actor,
      target,
    });
  }
);

// ---------------------------------------------------------------------------
// 5. Nuevo seguidor → usuario seguido
// ---------------------------------------------------------------------------
export const onFollowerCreated = onDocumentCreated(
  { document: "users/{recipientId}/followers/{actorId}", region: REGION },
  async (event) => {
    const { recipientId, actorId } = event.params;
    if (recipientId === actorId) return;

    const actor = await resolveActor(actorId);
    await emit({
      recipientId,
      groupKey: "follow",
      type: "follow",
      actor,
      target: { handle: actor.handle },
    });
  }
);

// ---------------------------------------------------------------------------
// 6. Solicitud de unirse a una comunidad → owner del grupo
// ---------------------------------------------------------------------------
export const onJoinRequestCreated = onDocumentCreated(
  { document: "groups/{groupId}/joinRequests/{requesterId}", region: REGION },
  async (event) => {
    const { groupId, requesterId } = event.params;
    const group = await db.collection("groups").doc(groupId).get();
    if (!group.exists) return;
    const ownerId = str(group.get("ownerId"));
    if (!ownerId || ownerId === requesterId) return;

    const actor = await resolveActor(requesterId);
    await emit({
      recipientId: ownerId,
      groupKey: `join_request_${groupId}`,
      type: "join_request",
      actor,
      target: { groupId, groupName: str(group.get("name")) },
    });
  }
);

// ---------------------------------------------------------------------------
// 7. Nuevo miembro en una comunidad:
//    - aprobación (tiene approvedBy) → se notifica al solicitante aceptado
//    - unión directa (tiene accessType) → se notifica al owner del grupo
// ---------------------------------------------------------------------------
export const onGroupMemberCreated = onDocumentCreated(
  { document: "groups/{groupId}/members/{userId}", region: REGION },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;
    const { groupId, userId } = event.params;

    const group = await db.collection("groups").doc(groupId).get();
    if (!group.exists) return;
    const groupName = str(group.get("name"));

    const approvedBy = str(data.approvedBy);
    if (approvedBy) {
      // Membresía aprobada por un owner/mod → avisar al miembro aceptado.
      const actor = await resolveActor(approvedBy);
      await emit({
        recipientId: userId,
        groupKey: `join_approved_${groupId}`,
        type: "join_approved",
        actor,
        target: { groupId, groupName },
      });
      return;
    }

    // Unión directa (grupo público / invite hidden) → avisar al owner.
    const ownerId = str(group.get("ownerId"));
    if (!ownerId || ownerId === userId) return;
    const actor = await resolveActor(userId);
    await emit({
      recipientId: ownerId,
      groupKey: `group_new_member_${groupId}`,
      type: "group_new_member",
      actor,
      target: { groupId, groupName },
    });
  }
);
