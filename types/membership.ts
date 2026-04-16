import { Timestamp } from "firebase/firestore";

export type GroupRole = "owner" | "moderator" | "member";

/**
 * Estado visible/canónico del miembro dentro del grupo.
 *
 * active:
 *   miembro normal con acceso vigente.
 *
 * subscribed:
 *   miembro con acceso vigente por suscripción.
 *
 * muted:
 *   miembro vigente pero silenciado/restringido.
 *
 * banned:
 *   bloqueado del grupo.
 *
 * removed:
 *   removido/expulsado del grupo.
 */
export type MemberStatus =
  | "active"
  | "subscribed"
  | "muted"
  | "banned"
  | "removed";

/**
 * Controla el tipo de acceso del usuario dentro del grupo.
 *
 * standard:
 *   acceso normal gratis.
 *
 * subscription:
 *   acceso por suscripción activa.
 *
 * legacy_free:
 *   acceso gratis conservado por transición histórica.
 */
export type AccessType =
  | "standard"
  | "subscription"
  | "legacy_free";

export type GroupMember = {
  userId: string;

  // Roles y estado base
  roleInGroup: GroupRole;
  status: MemberStatus;

  // Control de acceso real (crítico)
  accessType: AccessType;

  // Compatibilidad con lógica actual
  requiresSubscription?: boolean;
  subscriptionActive?: boolean;

  // Metadata de suscripción
  subscriptionStartedAt?: Timestamp | null;
  subscriptionExpiresAt?: Timestamp | null;
  subscriptionEndedAt?: Timestamp | null;
  subscriptionPriceMonthly?: number | null;
  subscriptionCurrency?: string | null;
  subscribedAt?: Timestamp | null;

  // Flags y metadata legacy / transición
  isLegacy?: boolean;
  legacyComplimentary?: boolean;
  legacyGrantedAt?: Timestamp | null;
  legacyGrantedBy?: string | null;

  transitionPendingAction?: boolean;
  transitionDirection?: string | null;
  transitionResolvedAt?: Timestamp | null;
  removedDueToSubscriptionTransition?: boolean;

  // Auditoría de remoción
  removedAt?: Timestamp | null;
  removedBy?: string | null;
  removedReason?: string | null;

  // Auditoría general
  joinedAt: Timestamp;
  updatedAt: Timestamp;
};