import { Timestamp } from "firebase/firestore";

export type GroupRole = "owner" | "moderator" | "member";
export type MemberStatus = "active" | "muted" | "banned";

/**
 * Controla el tipo de acceso del usuario dentro del grupo
 */
export type AccessType =
  | "free" // acceso abierto
  | "subscription_active" // suscripción vigente
  | "subscription_inactive" // suscripción vencida
  | "legacy_free"; // acceso gratis por transición histórica

export type GroupMember = {
  userId: string;

  // Roles y estado base
  roleInGroup: GroupRole;
  status: MemberStatus;

  // Control de acceso real (CRÍTICO)
  accessType: AccessType;

  // Suscripción (si aplica)
  subscriptionActive?: boolean; // redundancia útil para queries
  subscriptionStartedAt?: Timestamp | null;
  subscriptionExpiresAt?: Timestamp | null;

  // Flags para transiciones
  isLegacy?: boolean; // vino de etapa gratis → suscripción

  // Auditoría
  joinedAt: Timestamp;
  updatedAt: Timestamp;
};