/**
 * Tipos compartidos del sistema de notificaciones in-app (campanita).
 * El documento vive en `users/{uid}/notifications/{groupKey}` y lo escribe SOLO
 * el backend (ver `backend/src/notifications.ts`). Aquí modelamos la forma que
 * consume el cliente.
 */

export type NotificationType =
  | "post_like"
  | "comment"
  | "reply"
  | "comment_like"
  | "mention"
  | "follow"
  | "join_request"
  | "join_approved"
  | "group_new_member"
  | "moderation_warning";

export interface NotificationActor {
  id: string;
  name: string;
  avatarUrl?: string | null;
  handle?: string | null;
}

export interface NotificationTarget {
  postId?: string | null;
  commentId?: string | null;
  groupId?: string | null;
  groupName?: string | null;
  handle?: string | null;
  preview?: string | null;
  imageUrl?: string | null;
}

/** Notificación ya normalizada para la UI. */
export interface AppNotification {
  id: string;
  type: NotificationType;
  actors: NotificationActor[];
  actorCount: number;
  target: NotificationTarget;
  read: boolean;
  createdAtMs: number | null;
  updatedAtMs: number | null;
  /** Texto genérico para tipos sin plantilla propia (ej. moderación). */
  message?: string | null;
}

/** Tipos que la campanita sabe renderizar de forma enriquecida. */
export const KNOWN_NOTIFICATION_TYPES: ReadonlySet<NotificationType> = new Set([
  "post_like",
  "comment",
  "reply",
  "comment_like",
  "mention",
  "follow",
  "join_request",
  "join_approved",
  "group_new_member",
]);

/** Ruta relativa (sin prefijo de idioma) a la que lleva una notificación. */
export function notificationHref(n: AppNotification): string {
  switch (n.type) {
    case "follow":
      return n.actors[0]?.handle ? `/u/${n.actors[0].handle}` : "/notifications";
    case "join_request":
    case "join_approved":
    case "group_new_member":
      return n.target.groupId ? `/groups/${n.target.groupId}` : "/notifications";
    default:
      // post_like / comment / reply / comment_like / mention → post individual.
      // El comentario a enfocar viaja aparte (ver notificationQuery), como query
      // objeto, porque el Link de next-intl no preserva el query en href string.
      if (n.target.postId) return `/post/${n.target.postId}`;
      if (n.target.groupId) return `/groups/${n.target.groupId}`;
      if (n.target.handle) return `/u/${n.target.handle}`;
      return "/notifications";
  }
}

/** Query string (objeto) para el deep-link: enfoca un comentario dentro del post. */
export function notificationQuery(n: AppNotification): Record<string, string> | undefined {
  if (n.target.postId && n.target.commentId) {
    return { c: n.target.commentId };
  }
  return undefined;
}
