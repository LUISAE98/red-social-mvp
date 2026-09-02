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
  /** 💸 Todo el ciclo de un retiro. `target.action` dice en qué momento. */
  | "withdrawal_update"
  | "invite_expired"
  | "moderation_warning"
  | "donation";

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
  /** invite_expired: motivo ("max_uses" | "expired"). */
  reason?: string | null;
  /** withdrawal_update: la solicitud, para poder abrirla desde el aviso. */
  withdrawalId?: string | null;
  /**
   * withdrawal_update: importes YA FORMATEADOS por quien emitió el aviso.
   *
   * 🚨 No son número + moneda a propósito. El aviso se lee meses después y tiene que decir
   *    lo mismo que dijo ese día: formateando al leer, un cambio de moneda de visualización
   *    reescribiría la historia del creador.
   */
  amountText?: string | null;
  creditedText?: string | null;
  /** withdrawal_update: cuándo espera llegar, ISO. */
  arrivalDate?: string | null;
  /**
   * group_moderation: acción ("muted" | "kicked" | "banned").
   * group_subscription_transition: "legacy_free" | "removed_needs_subscription" | "removed_now_free".
   * kyc_update: estado ("approved" | "declined" | "in_review" | "pending").
   * withdrawal_update: momento del retiro — requested, approved, sent, paid, rejected,
   * returned, can_withdraw, seal_expiring.
   */
  action?: string | null;
  /** donation: id de la donación individual (detalle por separado, futuro). */
  donationId?: string | null;
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
  /** join_request agregada (>5 solicitudes): sin acciones inline, solo "Ver todas". */
  bulk?: boolean;
}

/**
 * Notificaciones de "Experiencias" (Bloque 4: servicios/servicios request).
 * Son el ciclo de compra-venta de servicios del creador (saludo, consejo,
 * sesión exclusiva, meet & greet): solicitud, aceptación, agenda, entrega, etc.
 *
 * El subnav de la vista de notificaciones separa Experiencias de Sociales; en
 * Sociales aparecen TODAS las notificaciones, en Experiencias solo estas.
 *
 * TODO(bloque-4): agregar aquí los tipos de servicios cuando se implementen.
 * Por ahora está vacío a propósito (solo diseñamos el subnav).
 */
export const EXPERIENCE_NOTIFICATION_TYPES: ReadonlySet<NotificationType> = new Set<NotificationType>([
  // "service_request", "service_accepted", "service_scheduled", ...
]);

/** ¿Esta notificación pertenece a la pestaña "Experiencias"? */
export function isExperienceNotification(n: AppNotification): boolean {
  return EXPERIENCE_NOTIFICATION_TYPES.has(n.type);
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
  "join_rejected",
  "moderator_invite",
  "moderator_invite_accepted",
  "moderator_invite_rejected",
  "group_new_member",
  "group_new_subscriber",
  "group_moderation",
  "group_subscription_transition",
  "new_post",
  "live_started",
  "live_vod_ready",
  "session_event",
  "kyc_update",
  "withdrawal_update",
  "invite_expired",
  "donation",
]);

/**
 * Ruta relativa (sin prefijo de idioma) a la que lleva una notificación.
 * `selfHandle` = handle del usuario actual, necesario para la notificación
 * colectiva de nuevos seguidores (lleva al perfil propio).
 */
export function notificationHref(n: AppNotification, selfHandle?: string | null): string {
  switch (n.type) {
    case "follow":
      // Un solo seguidor → su perfil. Varios (colectiva) → mi perfil + lista de
      // seguidores (ver notificationQuery → { followers: "1" }).
      if (n.actorCount > 1) return selfHandle ? `/u/${selfHandle}` : "/notifications";
      return n.actors[0]?.handle ? `/u/${n.actors[0].handle}` : "/notifications";
    case "kyc_update":
      // Cualquier estado de KYC → finanzas del wallet (donde se gestionan retiros).
      return "/wallet/finanzas";
    case "session_event":
      // Sesiones 1-a-1 → el panel de sesiones (ya existe).
      return "/sessions";
    case "donation":
      // Donaciones → finanzas del wallet (donde vive el ingreso). El detalle
      // "ver cada donación por separado" se definirá después.
      return "/wallet/finanzas";
    case "group_moderation":
      // Silenciado → puede volver a la comunidad. Expulsado/baneado → ya no tiene
      // acceso, así que es informativa (sin destino).
      return n.target.action === "muted" && n.target.groupId
        ? `/groups/${n.target.groupId}`
        : "/notifications";
    case "join_request":
    case "join_approved":
    case "join_rejected":
    // Invitación a moderar y sus respuestas → siempre la comunidad. La pestaña
    // y el panel a abrir viajan en el query (ver notificationQuery).
    case "moderator_invite":
    case "moderator_invite_accepted":
    case "moderator_invite_rejected":
    case "group_new_member":
    case "group_new_subscriber":
    case "group_subscription_transition":
      // Sacado o dejado legado → siempre a la comunidad (para re-suscribirse,
      // re-unirse, o ver su acceso gratis).
    case "invite_expired":
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

/** Query string (objeto) para el deep-link: comentario a enfocar, o abrir la
 *  lista de seguidores en el perfil propio (notificación colectiva de follows). */
export function notificationQuery(n: AppNotification): Record<string, string> | undefined {
  if (n.target.postId && n.target.commentId) {
    return { c: n.target.commentId };
  }
  if (n.type === "follow" && n.actorCount > 1) {
    return { followers: "1" };
  }
  // Nuevo miembro / suscriptor → abre la pestaña Integrantes (la lista de miembros).
  if (
    (n.type === "group_new_member" || n.type === "group_new_subscriber") &&
    n.target.groupId
  ) {
    return { tab: "members" };
  }
  // Aceptó la invitación a moderar → a la lista de integrantes, a verlo ya como
  // moderador.
  if (n.type === "moderator_invite_accepted" && n.target.groupId) {
    return { tab: "members" };
  }
  // La rechazó → misma lista, pero abriendo el buscador de moderadores para
  // proponerle el puesto a alguien más sin tener que navegar de nuevo.
  if (n.type === "moderator_invite_rejected" && n.target.groupId) {
    return { tab: "members", assignModerator: "1" };
  }
  return undefined;
}
