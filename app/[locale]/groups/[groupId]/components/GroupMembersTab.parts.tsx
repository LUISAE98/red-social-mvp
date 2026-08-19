"use client";
import type { ReactNode } from "react";

// Tipos, helpers, cache y sub-componente Chevron de GroupMembersTab.

import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import {
  CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  type Timestamp,
  updateDoc,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import {
  banGroupMember,
  demoteGroupAdminToMember,
  muteGroupMember,
  promoteGroupMemberToAdmin,
  removeGroupMember,
  unbanGroupMember,
  unmuteGroupMember,
} from "../../../../../lib/groups/groupModeration";
import GroupJoinRequestsSection from "./GroupJoinRequestsSection";

export type GroupMembersTabProps = {
  groupId: string;
  isOwner: boolean;
  isModerator?: boolean;
  canMembersViewList: boolean;
  /**
   * Va en el MISMO renglon que el titulo, a su derecha. Lo usa la comunidad
   * ajena para el enlace de volver a publicaciones, que es su unica salida
   * cuando el subnav de secciones no se pinta.
   */
  titleAction?: ReactNode;
  /** Abre automáticamente la lista de solicitudes (deep-link `?requests=1`). */
  initialShowRequests?: boolean;
  /**
   * Solo una comunidad PRIVADA normal recibe solicitudes de unión: es el único
   * modelo donde alguien pide entrar y el dueño acepta o rechaza. En pública se
   * entra directo, en oculta por invitación y en suscripción pagando.
   */
  canReceiveJoinRequests?: boolean;
  /**
   * Invitar a moderar a alguien de fuera. NUNCA en comunidades ocultas: su
   * existencia no se revela a quien no está dentro.
   */
  canInviteModerators?: boolean;
  /** Abre el buscador de moderadores al entrar (deep-link `?assignModerator=1`). */
  initialShowModeratorPanel?: boolean;
};

export type MemberDoc = {
  id: string;
  uid?: string;
  userId?: string;
  role?: string;
  roleInGroup?: string;
  status?: string;
  mutedUntil?: Timestamp | null;
  createdAt?: Timestamp | null;
  joinedAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
};

export type EnrichedMember = MemberDoc & {
  resolvedUid: string;
  displayName: string | null;
  handle: string | null;
  photoURL: string | null;
};

// Cache a nivel de módulo: sobrevive al cambio de pestaña para no mostrar
// spinner ni recargar visualmente al volver a "Integrantes" (misma UX que Wallet).
export const membersMemoryCache = new Map<string, EnrichedMember[]>();

export type FilterValue =
  | "all"
  | "active"
  | "subscribed"
  | "muted"
  | "banned"
  | "removed"
  | "mod"
  | "member";

export type ModerationAction =
  | "mute"
  | "unmute"
  | "ban"
  | "unban"
  | "remove";

export type RoleAction = "promote_to_mod" | "demote_to_member";

export type MemberAction = ModerationAction | RoleAction;

export type MenuPosition = {
  top: number;
  left: number;
};

export type CanonicalMemberStatus =
  | "active"
  | "subscribed"
  | "muted"
  | "banned"
  | "removed";
export type CanonicalRole = "owner" | "mod" | "member";

export function normalizeRole(role?: string): CanonicalRole {
  if (role === "owner") return "owner";
  if (role === "mod") return "mod";
  if (role === "moderator") return "mod";
  return "member";
}

export function getMutedUntilDate(mutedUntil?: unknown): Date | null {
  if (!mutedUntil) return null;

  if (typeof (mutedUntil as { toDate?: unknown }).toDate === "function") {
    const d = (mutedUntil as { toDate: () => unknown }).toDate();
    return d instanceof Date && !Number.isNaN((d as Date).getTime()) ? (d as Date) : null;
  }

  if (mutedUntil instanceof Date && !Number.isNaN(mutedUntil.getTime())) {
    return mutedUntil;
  }

  if (typeof mutedUntil === "string" || typeof mutedUntil === "number") {
    const d = new Date(mutedUntil);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  return null;
}

export function resolveEffectiveStatus(
  status?: string,
  mutedUntil?: unknown
): CanonicalMemberStatus {
  if (status === "banned") return "banned";
  if (status === "removed") return "removed";
  if (status === "kicked") return "removed";
  if (status === "expelled") return "removed";

  if (status === "muted") {
    const until = getMutedUntilDate(mutedUntil);
    if (until && until.getTime() <= Date.now()) {
      return "active";
    }
    return "muted";
  }

  if (status === "subscribed") return "subscribed";

  return "active";
}

export function getRemainingMutedDaysLabel(mutedUntil?: unknown) {
  const until = getMutedUntilDate(mutedUntil);
  if (!until) return null;

  const diffMs = until.getTime() - Date.now();
  if (diffMs <= 0) return null;

  const days = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  return days === 1 ? "resta 1 día" : `restan ${days} días`;
}

export function friendlyRole(role?: string) {
  const normalized = normalizeRole(role);
  if (normalized === "owner") return "Owner";
  if (normalized === "mod") return "Moderador";
  return "Miembro";
}

export function friendlyStatus(status?: string, mutedUntil?: unknown) {
  const normalized = resolveEffectiveStatus(status, mutedUntil);

  if (normalized === "muted") {
    const remaining = getRemainingMutedDaysLabel(mutedUntil);
    return remaining ? `Muteado, ${remaining}` : "Muteado";
  }

  if (normalized === "subscribed") return "Suscrito";
  if (normalized === "banned") return "Baneado";
  if (normalized === "removed") return "Expulsado";
  return "Activo";
}

export function statusDotColor(status?: string, mutedUntil?: unknown) {
  const normalized = resolveEffectiveStatus(status, mutedUntil);
  if (normalized === "banned") return "#ff4d4f";
  if (normalized === "removed") return "#b91c1c";
  if (normalized === "muted") return "#f5a623";
  if (normalized === "subscribed") return "#38bdf8";
  return "#22c55e";
}

export function memberInitials(member: EnrichedMember) {
  const raw =
    member.displayName?.trim() ||
    member.handle?.trim() ||
    member.resolvedUid ||
    "U";
  return raw.slice(0, 2).toUpperCase();
}

export function memberPrimaryName(member: EnrichedMember) {
  return (
    member.displayName?.trim() ||
    member.handle?.trim() ||
    "Usuario sin nombre"
  );
}

export function buildActionLabel(action: MemberAction) {
  if (action === "promote_to_mod") return "Convertir en moderador";
  if (action === "demote_to_member") return "Quitar moderador";
  if (action === "mute") return "Mutear";
  if (action === "unmute") return "Quitar mute";
  if (action === "ban") return "Banear";
  if (action === "unban") return "Quitar ban";
  return "Expulsar de la comunidad";
}

export function Chevron({
  open,
  muted = false,
}: {
  open: boolean;
  muted?: boolean;
}) {
  const color = muted
    ? "rgba(255,255,255,0.34)"
    : "rgba(255,255,255,0.78)";

  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: 9,
        height: 9,
        borderInlineEnd: `1.7px solid ${color}`,
        borderBottom: `1.7px solid ${color}`,
        transform: open ? "rotate(225deg)" : "rotate(45deg)",
        transition: "transform 180ms ease",
        marginTop: open ? 3 : -1,
        flexShrink: 0,
      }}
    />
  );
}

