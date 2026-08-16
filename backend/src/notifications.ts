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
import {
  onDocumentCreated,
  onDocumentDeleted,
  onDocumentUpdated,
} from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onTaskDispatched } from "firebase-functions/v2/tasks";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { getFunctions } from "firebase-admin/functions";
import { usersHaveBlockBetween } from "./social/blocks";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();
const REGION = "us-central1";

/**
 * Cuántas personas se pueden mencionar con @ en un solo comentario.
 *
 * B8-H04. Decisión de producto de Luis (2026-08-16). El mismo número está en el
 * cliente (`sanitizeCommentMentions`) y en las Firestore Rules; si cambia, cambia
 * en los tres.
 */
const MAX_MENCIONES = 5;

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
  | "join_rejected"
  | "moderator_invite"
  | "moderator_invite_accepted"
  | "moderator_invite_rejected"
  | "group_new_member"
  | "group_new_subscriber"
  | "group_moderation"
  | "group_subscription_transition"
  | "new_post"
  | "live_started"
  | "live_vod_ready"
  | "session_event"
  | "kyc_update"
  | "invite_expired"
  | "donation";

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
  /** invite_expired: "max_uses" | "expired". */
  reason?: string | null;
  /** group_moderation / kyc_update / session_event: acción/estado. */
  action?: string | null;
  /** session_event: id y tipo de la sesión 1-a-1. */
  sessionId?: string | null;
  sessionType?: string | null;
  /** donation: id de la donación individual (para el detalle por separado, futuro). */
  donationId?: string | null;
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

/** La comunidad como "actor" (avatar + nombre) cuando no hay una persona detrás. */
function groupActorOf(group: admin.firestore.DocumentSnapshot): Actor {
  return {
    id: group.id,
    name: str(group.get("name")) ?? "una comunidad",
    avatarUrl:
      str(group.get("avatarUrl")) ??
      str(group.get("photoURL")) ??
      str(group.get("imageUrl")),
    handle: null,
  };
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

  // Bloqueo de perfil: suprime notificaciones peer de CONTEXTO PERFIL (sin groupId)
  // entre usuarios bloqueados. Las de comunidad (con groupId) y las de sistema/
  // moderación NO se suprimen (el bloqueo de perfil no se propaga a comunidades).
  const PROFILE_PEER_TYPES: NotificationType[] = [
    "post_like", "comment", "reply", "comment_like", "mention", "follow",
  ];
  if (
    !target.groupId &&
    PROFILE_PEER_TYPES.includes(type) &&
    (await usersHaveBlockBetween(actor.id, recipientId))
  ) {
    return;
  }

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

    // ⚠️ B8-H04. Este bucle no tenía tope y las reglas no limitan el tamaño de
    // `mentions`, así que un solo comentario escrito directamente contra
    // Firestore podía traer miles de menciones y este `await` dentro del bucle
    // las convertía en miles de transacciones seguidas: bombardeo de
    // notificaciones a quien quisieras y factura de Functions a cambio de nada.
    //
    // El tope vive AQUÍ además de en el cliente y en las reglas porque es el
    // único sitio que ve la escritura venga de donde venga: el Admin SDK no
    // pasa por las reglas.
    if (seen.size > MAX_MENCIONES) {
      logger.warn("emitMentions: se superó el tope de menciones, se ignora el resto", {
        groupKey,
        recibidas: mentions.length,
        tope: MAX_MENCIONES,
      });
      return;
    }

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
    const commentPreview = str(data.text)?.slice(0, 120) ?? null;
    const target: Target = {
      ...base,
      commentId,
      preview:
        commentPreview && commentPreview.trim().length > 0
          ? commentPreview
          : data.image
            ? "📷 Foto"
            : null,
    };

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
    const replyPreview = str(data.text)?.slice(0, 120) ?? null;
    const target: Target = {
      ...base,
      commentId,
      preview:
        replyPreview && replyPreview.trim().length > 0
          ? replyPreview
          : data.image
            ? "📷 Foto"
            : null,
    };

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

    // El dueño del post también recibe aviso de la nueva actividad (respuesta) en
    // su publicación, aunque la respuesta no sea a su comentario. Se agrega bajo
    // la misma clave que los comentarios del post (actividad de comentarios). Se
    // evita duplicar: no si es quien responde, el autor del comentario (que ya
    // recibió su aviso de respuesta) o alguien ya mencionado.
    const postAuthorId = post.exists ? str(post.get("authorId")) : null;
    if (
      postAuthorId &&
      postAuthorId !== actor.id &&
      postAuthorId !== commentAuthorId &&
      !mentionedIds.has(postAuthorId)
    ) {
      await emit({
        recipientId: postAuthorId,
        groupKey: `post_comment_${postId}`,
        type: "comment",
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
// Umbral: hasta 5 solicitudes pendientes se muestran como notificaciones
// INDIVIDUALES (con Aceptar/Rechazar inline). A partir de 6 se colapsan en UNA
// sola notificación agregada (bulk) que solo lleva a "Ver todas las solicitudes".
const JOIN_REQUEST_BULK_THRESHOLD = 5;

/**
 * Quién debe enterarse de las solicitudes de una comunidad: el owner y TODOS sus
 * moderadores.
 *
 * Los moderadores siempre pudieron aprobar y rechazar (ver `joinRequests.ts`),
 * pero la notificación solo se le escribía al owner, así que un moderador nunca
 * se enteraba de que había algo pendiente. Esto cierra ese hueco.
 *
 * Se consultan los dos campos de rol porque conviven en los documentos de
 * miembro: `roleInGroup` es el canónico y `role` el heredado (`normalizeRole`
 * lee el primero con el segundo de respaldo). Se aceptan las dos grafías de
 * moderador. Banneados y expulsados quedan fuera: siguen siendo documentos de
 * miembro, pero ya no gestionan nada.
 */
async function resolveJoinRequestRecipients(
  groupId: string,
  ownerId: string
): Promise<string[]> {
  const members = db.collection("groups").doc(groupId).collection("members");

  const queries = await Promise.all(
    (["roleInGroup", "role"] as const).flatMap((field) =>
      (["mod", "moderator"] as const).map((value) =>
        members
          .where(field, "==", value)
          .get()
          .catch(() => null)
      )
    )
  );

  const recipients = new Set<string>([ownerId]);

  for (const snap of queries) {
    if (!snap) continue;
    for (const doc of snap.docs) {
      const status = str(doc.get("status"));
      if (status === "banned" || status === "removed") continue;
      if (doc.id) recipients.add(doc.id);
    }
  }

  return Array.from(recipients);
}

/**
 * Reconcilia las notificaciones de solicitud de unión a partir del estado real
 * de solicitudes pendientes del grupo. Idempotente: maneja las transiciones
 * individual↔agregada sin duplicar ni dejar huérfanas.
 *
 * Se ejecuta para el owner Y para cada moderador. Que la fuente de verdad sea la
 * subcolección `joinRequests` (y no la notificación) es lo que evita respuestas
 * duplicadas: en cuanto alguien resuelve, el documento se borra, el trigger
 * dispara este reconcile y la notificación desaparece de TODAS las campanitas.
 */
async function reconcileJoinRequestNotifications(groupId: string): Promise<void> {
  const group = await db.collection("groups").doc(groupId).get();
  if (!group.exists) return;
  const ownerId = str(group.get("ownerId"));
  if (!ownerId) return;
  const groupName = str(group.get("name"));

  const recipients = await resolveJoinRequestRecipients(groupId, ownerId);

  await Promise.all(
    recipients.map((recipientId) =>
      reconcileJoinRequestNotificationsFor(groupId, recipientId, groupName)
    )
  );
}

/** El reconcile de UN destinatario. La lógica original, con el uid parametrizado. */
async function reconcileJoinRequestNotificationsFor(
  groupId: string,
  recipientId: string,
  groupName: string | null
): Promise<void> {
  const notifs = db.collection("users").doc(recipientId).collection("notifications");
  const aggRef = notifs.doc(`join_request_${groupId}`);

  const pendingSnap = await db
    .collection("groups")
    .doc(groupId)
    .collection("joinRequests")
    .where("status", "==", "pending")
    .get();
  const pending = pendingSnap.docs
    .map((d) => ({
      id: str(d.get("userId")) ?? d.id,
      ms: (d.get("createdAt") as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0,
    }))
    // Nadie se ve a sí mismo en su propia campanita.
    .filter((p) => p.id !== recipientId);
  const count = pending.length;
  const now = admin.firestore.FieldValue.serverTimestamp();

  if (count === 0) {
    await aggRef.delete().catch(() => {});
    return;
  }

  if (count > JOIN_REQUEST_BULK_THRESHOLD) {
    // BULK: una sola notificación, sin acciones inline.
    await Promise.all(
      pending.map((p) => notifs.doc(`join_request_${groupId}_${p.id}`).delete().catch(() => {}))
    );
    const recent = [...pending].sort((a, b) => b.ms - a.ms).slice(0, MAX_VISIBLE_ACTORS);
    const actors = await Promise.all(recent.map((p) => resolveActor(p.id)));
    const existing = await aggRef.get();
    await aggRef.set(
      {
        type: "join_request",
        groupKey: `join_request_${groupId}`,
        bulk: true,
        actors,
        actorIds: pending.map((p) => p.id).slice(0, MAX_DEDUPE_IDS),
        actorCount: count,
        target: { groupId, groupName },
        read: false,
        updatedAt: now,
        ...(existing.exists ? {} : { createdAt: now }),
      },
      { merge: true }
    );
    return;
  }

  // ≤ umbral: individuales. Borra la agregada y asegura una notif por solicitante.
  await aggRef.delete().catch(() => {});
  await Promise.all(
    pending.map(async (p) => {
      const ref = notifs.doc(`join_request_${groupId}_${p.id}`);
      const existing = await ref.get();
      if (existing.exists) return; // preserva read/createdAt; no re-emitir
      const actor = await resolveActor(p.id);
      await ref.set({
        type: "join_request",
        groupKey: ref.id,
        bulk: false,
        actors: [actor],
        actorIds: [p.id],
        actorCount: 1,
        target: { groupId, groupName },
        read: false,
        createdAt: now,
        updatedAt: now,
      });
    })
  );
}

/**
 * Notificación de DONACIÓN (Sociales). Se dispara cuando una donación queda
 * pagada (`profileDonations/{id}` con paymentStatus paid/simulated).
 *
 * Canal = perfil (sin `groupId`) o comunidad (`groupId`/`groupName`). Agregación
 * POR CANAL con umbral 3:
 *  - Donaciones 1–3 → tarjetas separadas (`donation_{donationId}`).
 *  - A partir de la 4ª → se colapsan en UNA sola (`donation_agg_{canal}`, bulk),
 *    borrando las 3 individuales. Sin monto (se define después).
 *
 * Un doc-bucket por canal (`users/{uid}/donationBuckets/{canal}`) lleva la cuenta
 * y los ids, y hace la transición idempotente.
 */
export const onDonationNotify = onDocumentCreated(
  { document: "profileDonations/{donationId}", region: REGION },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const d = snap.data() ?? {};
    const status = str(d.paymentStatus);
    if (status !== "paid" && status !== "simulated_paid") return;

    const creatorId = str(d.creatorId);
    const buyerId = str(d.buyerId);
    if (!creatorId || !buyerId || creatorId === buyerId) return;

    const donationId = event.params.donationId as string;
    const groupId = str(d.groupId);
    const groupName = str(d.groupName);
    const actor = await resolveActor(buyerId);

    const channelKey = groupId ? `g_${groupId}` : "p";
    const target: Target = { groupId: groupId ?? null, groupName: groupName ?? null };

    const notifsRef = db.collection("users").doc(creatorId).collection("notifications");
    const bucketRef = db.collection("users").doc(creatorId).collection("donationBuckets").doc(channelKey);
    const aggRef = notifsRef.doc(`donation_agg_${channelKey}`);

    await db.runTransaction(async (tx) => {
      const bucketSnap = await tx.get(bucketRef);
      const bucket = bucketSnap.exists ? bucketSnap.data() ?? {} : {};
      const prevIds: string[] = Array.isArray(bucket.donationIds) ? bucket.donationIds : [];
      if (prevIds.includes(donationId)) return; // idempotente

      const prevActors: Actor[] = Array.isArray(bucket.actors) ? bucket.actors : [];
      const count = (typeof bucket.count === "number" ? bucket.count : prevIds.length) + 1;

      const now = admin.firestore.FieldValue.serverTimestamp();
      const nextActors = [actor, ...prevActors.filter((a) => a?.id !== actor.id)].slice(0, MAX_VISIBLE_ACTORS);
      const nextIds = [donationId, ...prevIds].slice(0, MAX_DEDUPE_IDS);

      if (count <= 3) {
        // Tarjeta separada por donación.
        tx.set(notifsRef.doc(`donation_${donationId}`), {
          type: "donation",
          groupKey: `donation_${donationId}`,
          actors: [actor],
          actorIds: [actor.id],
          actorCount: 1,
          target: { ...target, donationId },
          read: false,
          createdAt: now,
          updatedAt: now,
        });
      } else if (count === 4) {
        // Colapsar: borra las 3 individuales previas y crea la agregada.
        for (const id of prevIds) tx.delete(notifsRef.doc(`donation_${id}`));
        tx.set(aggRef, {
          type: "donation",
          groupKey: `donation_agg_${channelKey}`,
          actors: nextActors,
          actorIds: nextIds,
          actorCount: count,
          target,
          bulk: true,
          read: false,
          createdAt: now,
          updatedAt: now,
        });
      } else {
        // Ya agregada: bump.
        tx.set(
          aggRef,
          {
            actors: nextActors,
            actorIds: nextIds,
            actorCount: count,
            target,
            bulk: true,
            read: false,
            updatedAt: now,
          },
          { merge: true }
        );
      }

      tx.set(bucketRef, { donationIds: nextIds, actors: nextActors, count, updatedAt: now });
    });
  }
);

export const onJoinRequestCreated = onDocumentCreated(
  { document: "groups/{groupId}/joinRequests/{requesterId}", region: REGION },
  async (event) => {
    await reconcileJoinRequestNotifications(event.params.groupId);
  }
);

// Al resolverse (aprobar/rechazar) o cancelarse, el doc se borra → limpiamos la
// notificación individual de ese solicitante y reconciliamos el resto.
export const onJoinRequestRemoved = onDocumentDeleted(
  { document: "groups/{groupId}/joinRequests/{requesterId}", region: REGION },
  async (event) => {
    const { groupId, requesterId } = event.params;
    const group = await db.collection("groups").doc(groupId).get();
    const ownerId = group.exists ? str(group.get("ownerId")) : null;

    if (ownerId) {
      // Se borra en TODAS las campanitas, no solo en la del owner: si un
      // moderador aprueba, la solicitud tiene que desaparecerle también al
      // dueño y al resto de moderadores, para que nadie responda dos veces.
      const recipients = await resolveJoinRequestRecipients(groupId, ownerId);

      await Promise.all(
        recipients.map((recipientId) =>
          db
            .collection("users")
            .doc(recipientId)
            .collection("notifications")
            .doc(`join_request_${groupId}_${requesterId}`)
            .delete()
            .catch(() => {})
        )
      );
    }

    await reconcileJoinRequestNotifications(groupId);
  }
);

// ---------------------------------------------------------------------------
// 7. Nuevo miembro en una comunidad:
//    - aprobación (tiene approvedBy) → se notifica al solicitante aceptado
//    - unión directa (tiene accessType) → se notifica al owner del grupo
// ---------------------------------------------------------------------------
/** ¿El doc de miembro corresponde a un suscriptor de pago (no gratuito)? */
function isSubscriberMember(data: Record<string, unknown>): boolean {
  return (
    str(data.accessType) === "subscription" ||
    str(data.status) === "subscribed" ||
    data.subscriptionActive === true ||
    data.requiresSubscription === true
  );
}

/**
 * Avisa al owner que alguien se unió. Diferencia suscriptor de pago
 * (`group_new_subscriber`) de miembro gratuito (`group_new_member`): distinto
 * tipo y distinta clave de agregación, para que no se mezclen en la campanita.
 */
async function emitGroupJoin(
  group: admin.firestore.DocumentSnapshot,
  memberUid: string,
  isSubscriber: boolean
): Promise<void> {
  const ownerId = str(group.get("ownerId"));
  if (!ownerId || ownerId === memberUid) return;
  const groupId = group.id;
  const groupName = str(group.get("name"));
  const actor = await resolveActor(memberUid);
  await emit({
    recipientId: ownerId,
    groupKey: isSubscriber
      ? `group_new_subscriber_${groupId}`
      : `group_new_member_${groupId}`,
    type: isSubscriber ? "group_new_subscriber" : "group_new_member",
    actor,
    target: { groupId, groupName },
  });
}

/**
 * Notifica al owner que alguien se unió, invocado server-side desde
 * `consumeInviteLink`. Se emite aquí (y no solo vía trigger) porque la unión por
 * invite usa `set(..., { merge: true })`: si el miembro ya tenía un doc con un
 * status intermedio (p.ej. `subscribed`), el merge es un *update* y el trigger
 * `onGroupMemberCreated` no dispararía. El miembro lleva `joinSource:"invite_link"`
 * para que ese trigger omita estas uniones y no se duplique el aviso.
 */
export async function notifyGroupNewMemberFromInvite(
  groupId: string,
  memberUid: string,
  isSubscriber: boolean
): Promise<void> {
  const group = await db.collection("groups").doc(groupId).get();
  if (!group.exists) return;
  await emitGroupJoin(group, memberUid, isSubscriber);
}

/**
 * Avisa al solicitante que su solicitud de unión fue rechazada. Invocado
 * server-side desde `rejectJoinRequest` (el joinRequest se borra, no hay trigger).
 * La comunidad hace de actor. Clic → la comunidad.
 */
export async function notifyJoinRejected(
  groupId: string,
  userId: string
): Promise<void> {
  const group = await db.collection("groups").doc(groupId).get();
  if (!group.exists) return;
  await emit({
    recipientId: userId,
    groupKey: `join_rejected_${groupId}`,
    type: "join_rejected",
    actor: groupActorOf(group),
    target: { groupId, groupName: str(group.get("name")) },
  });
}

/**
 * Invitación a MODERAR una comunidad. El invitado la responde desde la propia
 * notificación (Aceptar / Rechazar). Actor = quien invita (el dueño).
 * Una invitación por comunidad: el groupKey no lleva el uid del invitado porque
 * el destinatario ES el invitado.
 */
export async function notifyModeratorInvite(
  groupId: string,
  inviteeId: string,
  inviterId: string
): Promise<void> {
  const group = await db.collection("groups").doc(groupId).get();
  if (!group.exists) return;
  await emit({
    recipientId: inviteeId,
    groupKey: `moderator_invite_${groupId}`,
    type: "moderator_invite",
    actor: await resolveActor(inviterId),
    target: { groupId, groupName: str(group.get("name")) },
  });
}

/**
 * Respuesta a la invitación a moderar, de vuelta a quien invitó. Actor = la
 * persona invitada (su avatar), que es de quien se habla en el texto.
 */
export async function notifyModeratorInviteResponse(
  groupId: string,
  inviterId: string,
  inviteeId: string,
  accepted: boolean
): Promise<void> {
  const group = await db.collection("groups").doc(groupId).get();
  if (!group.exists) return;
  const type: NotificationType = accepted
    ? "moderator_invite_accepted"
    : "moderator_invite_rejected";
  await emit({
    recipientId: inviterId,
    // Con el uid del invitado: si invitas a varias personas, cada respuesta es
    // su propia tarjeta y no se pisan entre sí.
    groupKey: `${type}_${groupId}_${inviteeId}`,
    type,
    actor: await resolveActor(inviteeId),
    target: { groupId, groupName: str(group.get("name")) },
  });
}

/**
 * Avisa al miembro afectado por una acción de moderación de comunidad.
 * `action`: "muted" (silenciado) | "kicked" (expulsado) | "banned" (bloqueado).
 * Un solo tipo `group_moderation`; el texto y el destino de clic dependen de
 * `action`. Invocado server-side desde `groupModeration.ts` tras aplicar la acción.
 */
export async function notifyGroupModeration(
  groupId: string,
  targetUserId: string,
  action: "muted" | "kicked" | "banned"
): Promise<void> {
  const group = await db.collection("groups").doc(groupId).get();
  if (!group.exists) return;
  await emit({
    recipientId: targetUserId,
    groupKey: `group_moderation_${groupId}`,
    type: "group_moderation",
    actor: groupActorOf(group),
    target: { groupId, groupName: str(group.get("name")), action },
  });
}

/**
 * Avisa a un miembro afectado por una TRANSICIÓN de modelo de la comunidad
 * (gratis↔suscripción / cambio de precio). `action`:
 *  · "legacy_free"                → lo dejaron con acceso gratis (sigue dentro).
 *  · "removed_needs_subscription" → lo sacaron; ahora requiere suscripción.
 *  · "removed_now_free"           → lo sacaron al volver la comunidad gratis.
 * La comunidad hace de actor (su avatar). Clic → la comunidad. Idempotente por grupo:
 * un solo doc por comunidad (refleja la última transición). Best-effort desde
 * `subscriptionTransitions.ts` tras aplicar la transición. `groupSnap` opcional para
 * no releer el grupo por cada miembro.
 */
export async function notifySubscriptionTransition(
  groupId: string,
  targetUserId: string,
  action: "legacy_free" | "removed_needs_subscription" | "removed_now_free",
  groupSnap?: admin.firestore.DocumentSnapshot
): Promise<void> {
  const group = groupSnap ?? (await db.collection("groups").doc(groupId).get());
  if (!group.exists) return;
  await emit({
    recipientId: targetUserId,
    groupKey: `group_subscription_transition_${groupId}`,
    type: "group_subscription_transition",
    actor: groupActorOf(group),
    target: { groupId, groupName: str(group.get("name")), action },
  });
}

/**
 * Avisa al creador de un cambio de estado de su verificación KYC.
 * Un solo tipo `kyc_update` con `action` = "approved" | "declined" | "in_review"
 * | "pending" (siempre la misma clave → refleja el estado más reciente).
 * La plataforma hace de actor (no hay persona). Clic → wallet/finanzas.
 * ⚠️ HOY SIN EMISOR: Didit se eliminó el 2026-08-13 y nadie llama a esta función.
 * Se conserva porque el tipo `kyc_update` ya se renderiza en la campana y el alta de
 * Stripe volverá a necesitarla. Si en 2027 sigue sin emisor, borrarla.
 */
export async function notifyKycStatus(
  uid: string,
  status: "approved" | "declined" | "in_review" | "pending"
): Promise<void> {
  if (!uid) return;
  await emit({
    recipientId: uid,
    groupKey: "kyc_update",
    type: "kyc_update",
    actor: { id: "kyc", name: "Verificación", avatarUrl: null, handle: null },
    target: { action: status },
  });
}

/** Acciones del ciclo de vida de una sesión 1-a-1 (LiveKit). */
export type SessionEventAction =
  | "reminder"
  | "partner_ready"
  | "partner_joined"
  | "ended"
  | "incomplete"
  | "no_show"
  | "no_show_both"
  | "recording_ready"
  | "recording_failed";

/**
 * Avisa de un evento de sesión 1-a-1 (exclusiva o meet & greet) a uno o varios
 * destinatarios. `actorUid` = la otra parte (para "está listo"/"se unió"); si no
 * hay persona detrás (fin, no-show, grabación, recordatorio) se usa un actor
 * neutro "Sesión" y así todos los destinatarios lo reciben. Un `groupKey` por
 * (sesión, acción) para no pisar eventos distintos de la misma sesión.
 *
 * `counterpartByRecipient` mapea cada destinatario → uid de la OTRA parte, y a
 * cada uno se le muestra a su contraparte como actor (avatar/nombre). Se usa en
 * eventos que van a ambas partes pero donde cada quien debe ver la cara del otro
 * (recordatorio): el comprador ve al creador y el creador al comprador. Tiene
 * prioridad sobre `actorUid`; si un destinatario no está en el mapa cae al actor
 * compartido.
 */
export async function notifySessionEvent(opts: {
  action: SessionEventAction;
  sessionId: string;
  sessionType: string;
  recipientIds: Array<string | null | undefined>;
  actorUid?: string | null;
  counterpartByRecipient?: Record<string, string | null | undefined>;
}): Promise<void> {
  const sharedActor: Actor = opts.actorUid
    ? await resolveActor(opts.actorUid)
    : { id: "session", name: "Sesión", avatarUrl: null, handle: null };

  const actorCache = new Map<string, Actor>();

  const seen = new Set<string>();
  for (const rid of opts.recipientIds) {
    if (!rid || seen.has(rid)) continue;
    seen.add(rid);

    let actor = sharedActor;
    const counterpartUid = opts.counterpartByRecipient?.[rid];
    if (counterpartUid) {
      const cached = actorCache.get(counterpartUid);
      actor = cached ?? (await resolveActor(counterpartUid));
      actorCache.set(counterpartUid, actor);
    }

    await emit({
      recipientId: rid,
      groupKey: `session_${opts.sessionId}_${opts.action}`,
      type: "session_event",
      actor,
      target: {
        action: opts.action,
        sessionId: opts.sessionId,
        sessionType: opts.sessionType,
      },
    });
  }
}

export const onGroupMemberCreated = onDocumentCreated(
  { document: "groups/{groupId}/members/{userId}", region: REGION },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;
    const { groupId, userId } = event.params;

    // Uniones por invite link: la notificación la emite consumeInviteLink
    // (server-side), porque el merge-set puede ser update y no dispararía este
    // trigger. Omitir aquí evita el doble aviso.
    if (str(data.joinSource) === "invite_link") return;

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

    // Unión directa (grupo público / suscripción vía group page) → avisar al owner.
    await emitGroupJoin(group, userId, isSubscriberMember(data));
  }
);

// ---------------------------------------------------------------------------
// Nuevo post (fan-out) → seguidores (perfil) / miembros (comunidad).
//   - Agregado por autor + contexto: varios posts del mismo autor colapsan en
//     una sola notificación cuyo contador (`actorCount`) = nº de posts.
//   - Se omiten posts borrados y lives (los lives tienen su propia noti).
//   - PRODUCCIÓN / VOLUMEN: el reparto NO se hace inline. El trigger encola la
//     primera página en Cloud Tasks; `fanoutNewPostTask` procesa una página de
//     destinatarios (paginada por cursor sobre el id de documento), escribe sus
//     notificaciones en lote y se auto-encola para la siguiente página. Así cada
//     invocación queda acotada (sin lectura masiva en memoria ni riesgo de
//     timeout con audiencias grandes) y la cola reintenta/limita el ritmo.
// ---------------------------------------------------------------------------
const FANOUT_PAGE = 450; // destinatarios por tarea (< 500 del límite de batch)
const FANOUT_TASK = "fanoutNewPostTask";

type FanoutSource = "followers" | "members";

interface FanoutTaskData {
  jobId: string; // = postId, estable → dedupe de tareas encadenadas
  source: FanoutSource;
  sourceId: string; // authorId (followers) | groupId (members)
  authorId: string; // se excluye de los destinatarios
  groupKey: string;
  actor: Actor;
  target: Target;
  startAfter: string | null; // cursor: id del último doc de la página previa
  /** Tipo de notificación a escribir (por defecto "new_post"). */
  notifType?: NotificationType;
}

/** Encola una página del reparto. `id` determinista → Cloud Tasks deduplica. */
async function enqueueFanoutPage(data: FanoutTaskData): Promise<void> {
  const kind = data.notifType ?? "new_post";
  const taskId = `${kind}_${data.jobId}_${data.source}_${data.startAfter ?? "start"}`;
  await getFunctions()
    .taskQueue(FANOUT_TASK)
    .enqueue(data, { id: taskId });
}

/**
 * Fan-out de un aviso a la audiencia (seguidores del creador o miembros de las
 * comunidades donde ocurre). Reutiliza la cola de Cloud Tasks. Un `groupKey` por
 * evento (`${notifType}_${postId}`), así los destinatarios que estén en varias
 * fuentes (p.ej. seguidor Y miembro) reciben una sola notificación.
 */
export async function enqueueAudienceFanout(opts: {
  notifType: NotificationType;
  postId: string;
  authorId: string;
  actor: Actor;
  target: Target;
  groupIds: string[];
  includeFollowers: boolean;
}): Promise<void> {
  const base = {
    jobId: opts.postId,
    authorId: opts.authorId,
    groupKey: `${opts.notifType}_${opts.postId}`,
    actor: opts.actor,
    target: opts.target,
    notifType: opts.notifType,
    startAfter: null as string | null,
  };
  if (opts.includeFollowers) {
    await enqueueFanoutPage({ ...base, source: "followers", sourceId: opts.authorId });
  }
  for (const gid of opts.groupIds) {
    if (gid) await enqueueFanoutPage({ ...base, source: "members", sourceId: gid });
  }
}

/**
 * Audiencia de un aviso de live a partir del doc del post: seguidores (live de
 * perfil) o miembros de la comunidad + `broadcastGroupIds` (live de comunidad).
 * Compartido por los webhooks de Cloudflare (`cfWebhooks`) y Mux (`muxWebhooks`).
 */
export function liveAudience(
  data: admin.firestore.DocumentData,
  postId: string
) {
  const authorId = str(data.authorId);
  const groupId = str(data.groupId);
  const live = (data.liveData as admin.firestore.DocumentData | undefined) ?? {};
  const broadcast: string[] = Array.isArray(live.broadcastGroupIds)
    ? (live.broadcastGroupIds as unknown[]).filter(
        (id): id is string => typeof id === "string" && !!id
      )
    : [];
  const groupIds = [groupId, ...broadcast].filter(
    (id): id is string => typeof id === "string" && !!id
  );
  const name = str(data.authorName) ?? "Alguien";
  const avatar = str(data.authorAvatarUrl);
  const username = str(data.authorUsername);
  const image = str(data.shareImageUrl);
  const text = str(data.text)?.slice(0, 120) ?? null;

  return {
    authorId,
    groupId,
    groupIds,
    includeFollowers: !groupId, // perfil → seguidores; comunidad → miembros
    actor: { id: authorId ?? "", name, avatarUrl: avatar, handle: username } as Actor,
    creatorName: name,
    creatorAvatar: avatar,
    target: {
      postId,
      groupId: groupId ?? null,
      handle: username,
      preview: text,
      imageUrl: image,
    } as Target,
  };
}

/** VOD del live listo → aviso directo al creador (además del fan-out a la audiencia). */
export async function notifyLiveVodReadyOwner(opts: {
  postId: string;
  authorId: string;
  creatorName: string;
  creatorAvatar: string | null;
  target: Target;
}): Promise<void> {
  if (!opts.authorId) return;
  await emit({
    recipientId: opts.authorId,
    groupKey: `live_vod_ready_${opts.postId}`,
    type: "live_vod_ready",
    // Actor sintético (id ≠ creador) para que `emit` no lo omita como auto-aviso.
    actor: {
      id: `live_${opts.postId}`,
      name: opts.creatorName || "Tu live",
      avatarUrl: opts.creatorAvatar,
      handle: null,
    },
    target: { ...opts.target, action: "self" },
  });
}

export const onPostCreated = onDocumentCreated(
  { document: "posts/{postId}", region: REGION },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data();
    if (!data) return;

    if (data.isDeleted === true) return;
    // Los lives tienen (o tendrán) su propia notificación "X está en vivo".
    if (str(data.postType) === "live" || data.liveData != null) return;

    const authorId = str(data.authorId);
    if (!authorId) return;

    const postId = event.params.postId;
    const contextType = str(data.contextType);

    const actor: Actor = {
      id: authorId,
      name: str(data.authorName) ?? str(data.authorUsername) ?? "Alguien",
      avatarUrl: str(data.authorAvatarUrl),
      handle: str(data.authorUsername),
    };

    const media = data.media;
    let imageUrl: string | null = null;
    if (Array.isArray(media) && media.length > 0) {
      imageUrl = str(media[0]?.thumbnailUrl) ?? str(media[0]?.url);
    }
    if (!imageUrl) imageUrl = str(data.shareImageUrl);

    const preview = str(data.text)?.slice(0, 120) ?? null;
    const handle = str(data.authorUsername);

    const isGroup = contextType === "group";
    const groupId = isGroup ? str(data.groupId) : null;
    if (isGroup && !groupId) return;

    const target: Target = {
      postId,
      groupId: isGroup ? groupId : null,
      groupName: isGroup ? str(data.groupName) : null,
      handle,
      preview,
      imageUrl,
    };

    try {
      await enqueueFanoutPage({
        jobId: postId,
        source: isGroup ? "members" : "followers",
        sourceId: isGroup ? (groupId as string) : authorId,
        authorId,
        groupKey: isGroup
          ? `new_post_group_${groupId}_${authorId}`
          : `new_post_profile_${authorId}`,
        actor,
        target,
        startAfter: null,
      });
    } catch (err: unknown) {
      // Causa típica: la SA de la función no tiene `roles/cloudtasks.enqueuer`.
      logger.error("onPostCreated fan-out enqueue failed", {
        postId,
        source: isGroup ? "members" : "followers",
        message: err instanceof Error ? err.message : "Error desconocido",
      });
    }
  }
);

/**
 * Procesa UNA página del fan-out y encadena la siguiente. Reintentable: en el
 * peor caso (reintento tras commit) recuenta una página (contador cosmético);
 * el `id` determinista evita clonar tareas de páginas siguientes.
 */
export const fanoutNewPostTask = onTaskDispatched<FanoutTaskData>(
  {
    region: REGION,
    retryConfig: { maxAttempts: 5, minBackoffSeconds: 5 },
    rateLimits: { maxConcurrentDispatches: 6 },
  },
  async (req) => {
    const { source, sourceId, authorId, groupKey, actor, target, startAfter } =
      req.data;
    const notifType = req.data.notifType ?? "new_post";

    const col =
      source === "followers"
        ? db.collection("users").doc(sourceId).collection("followers")
        : db.collection("groups").doc(sourceId).collection("members");

    let query = col
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(FANOUT_PAGE);
    if (startAfter) query = query.startAfter(startAfter);
    if (source === "members") query = query.select("status");
    else query = query.select();

    const pageSnap = await query.get();
    if (pageSnap.empty) return;

    const now = admin.firestore.FieldValue.serverTimestamp();
    const batch = db.batch();
    let writes = 0;

    for (const doc of pageSnap.docs) {
      const uid = doc.id;
      if (uid === authorId) continue;
      if (source === "members") {
        const s = str(doc.get("status")) ?? "active";
        if (s !== "active" && s !== "muted") continue;
      }
      const ref = db
        .collection("users")
        .doc(uid)
        .collection("notifications")
        .doc(groupKey);
      batch.set(
        ref,
        {
          type: notifType,
          groupKey,
          actors: [actor],
          actorIds: [actor.id],
          actorCount: admin.firestore.FieldValue.increment(1),
          target,
          read: false,
          createdAt: now,
          updatedAt: now,
        },
        { merge: true }
      );
      writes += 1;
    }

    if (writes > 0) await batch.commit();

    // ¿Página llena? Encadena la siguiente desde el último id leído.
    if (pageSnap.size === FANOUT_PAGE) {
      const lastId = pageSnap.docs[pageSnap.docs.length - 1].id;
      await enqueueFanoutPage({ ...req.data, startAfter: lastId });
    }

    logger.info("fanoutNewPostTask page done", {
      source,
      sourceId,
      writes,
      pageSize: pageSnap.size,
      chained: pageSnap.size === FANOUT_PAGE,
    });
  }
);

// ---------------------------------------------------------------------------
// Enlace de invitación caducado → avisa al owner que lo creó.
//   - "max_uses": alcanzó el máximo de usos (evento al consumirse).
//   - "expired": venció por tiempo (cron horario).
// ---------------------------------------------------------------------------
async function emitInviteEnded(
  groupId: string,
  inviteId: string,
  createdBy: string,
  reason: "max_uses" | "expired"
): Promise<void> {
  if (!createdBy) return;
  const group = await db.collection("groups").doc(groupId).get();
  const groupName = str(group.get("name"));
  // La comunidad hace de "actor" (avatar + nombre); no hay una persona.
  const groupActor: Actor = {
    id: groupId,
    name: groupName ?? "Comunidad",
    avatarUrl: str(group.get("avatarUrl")) ?? str(group.get("photoURL")) ?? str(group.get("imageUrl")),
    handle: null,
  };
  const now = admin.firestore.FieldValue.serverTimestamp();
  const ref = db
    .collection("users")
    .doc(createdBy)
    .collection("notifications")
    .doc(`invite_expired_${inviteId}`);
  const existing = await ref.get();
  await ref.set(
    {
      type: "invite_expired",
      groupKey: `invite_expired_${inviteId}`,
      actors: [groupActor],
      actorIds: [groupId],
      actorCount: 1,
      target: { groupId, groupName, reason },
      read: false,
      updatedAt: now,
      ...(existing.exists ? {} : { createdAt: now }),
    },
    { merge: true }
  );
}

// Máximo de usos: `isActive` pasa de true→false por agotarse (no por revocar).
export const onInviteLinkUpdated = onDocumentUpdated(
  { document: "groups/{groupId}/inviteLinks/{inviteId}", region: REGION },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;
    const { groupId, inviteId } = event.params;

    const becameInactive = before.isActive === true && after.isActive === false;
    if (!becameInactive) return;
    if (after.revokedAt) return; // revocado manualmente → sin aviso
    const maxUses = typeof after.maxUses === "number" ? after.maxUses : null;
    const usedCount = typeof after.usedCount === "number" ? after.usedCount : 0;
    if (maxUses === null || usedCount < maxUses) return; // no fue por máximo

    const createdBy = str(after.createdBy);
    if (createdBy) await emitInviteEnded(groupId, inviteId, createdBy, "max_uses");
  }
);

// Vencimiento por tiempo: el paso del tiempo no dispara evento, así que un cron
// horario busca links activos ya vencidos, avisa al owner y los desactiva.
export const expireInviteLinks = onSchedule(
  { schedule: "every 1 hours", timeZone: "America/Mexico_City", region: REGION },
  async () => {
    const now = admin.firestore.Timestamp.now();
    const snap = await db
      .collectionGroup("inviteLinks")
      .where("isActive", "==", true)
      .where("expiresAt", "<=", now)
      .limit(300)
      .get();

    for (const doc of snap.docs) {
      const d = doc.data();
      if (!d.revokedAt) {
        const groupId = str(d.groupId);
        const createdBy = str(d.createdBy);
        if (groupId && createdBy) {
          await emitInviteEnded(groupId, doc.id, createdBy, "expired");
        }
      }
      // Desactiva (revocado o no) para no re-procesarlo y reflejar la realidad.
      await doc.ref.update({ isActive: false }).catch(() => {});
    }
  }
);
