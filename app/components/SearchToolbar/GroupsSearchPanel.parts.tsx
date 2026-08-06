"use client";

// Tipos, helpers y sub-componentes compartidos de GroupsSearchPanel.

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import { usePathname, useRouter } from "next/navigation";
import { onAuthStateChanged, type User } from "firebase/auth";
import {
  doc,
  getDoc,
} from "firebase/firestore";

import { auth, db } from "@/lib/firebase";
import { followUser } from "@/lib/social/social-service";
import { searchGroups } from "@/lib/groups/searchGroups";
import { searchProfiles } from "@/lib/profile/searchProfiles";
import { searchStories } from "@/lib/stories/searchStories";
import { searchPosts } from "@/lib/posts/searchPosts";
import type { StoryDoc } from "@/lib/stories/types";
import type { Post } from "@/lib/posts/types";
import StoryViewer from "@/app/components/Stories/StoryViewer";
import GroupsSearchToolbar from "./GroupsSearchToolbar";
import LiveRingAvatar from "@/app/components/LiveRing/LiveRingAvatar";

// Aro morado de Vibra para historias (mismo gradiente que el home).
export const VIBRA_STORY_RING = "linear-gradient(135deg, #ec4899 0%, #9333ea 52%, #3b82f6 100%)";

export function storyThumb(s: StoryDoc): string | null {
  if (s.muxPlaybackId) return `https://image.mux.com/${s.muxPlaybackId}/thumbnail.jpg?time=0`;
  if (s.thumbnailUrl) return s.thumbnailUrl;
  return null;
}

// Badge del post/live: premium, live programado, en vivo o VOD.
export type PostBadge = { label: string; ticket: boolean; live?: boolean };

export function postBadge(p: Post): PostBadge | null {
  const isPaid =
    p.access === "paid" || p.requiresPayment === true || p.requiresSubscription === true;
  const isLive = p.postType === "live" || p.postType === "scheduled_event";

  if (isLive) {
    const status = p.liveData?.status ?? p.scheduledData?.status ?? null;
    if (status === "ended") {
      // Live terminado → ahora es VOD
      return { label: isPaid ? "VOD Premium" : "VOD", ticket: false };
    }
    if (status === "live") {
      // Transmitiendo ahora → "En vivo" (en rojo)
      return { label: "En vivo", ticket: false, live: true };
    }
    // Programado: "Live programado"; con 🎫 si es de pago
    return { label: "Live programado", ticket: isPaid };
  }

  if (isPaid) return { label: "Post premium", ticket: false };
  return null;
}

export type CommunitySearchMatchType = "exact" | "related" | "suggested";
export const SEARCH_LIMIT = 12;
export const SEARCH_DEBOUNCE_MS = 300;
export const MIN_SEARCH_LENGTH = 2;

export type Community = {
  id: string;
  name?: string;
  description?: string;
  avatarUrl?: string | null;
  visibility?: "public" | "private" | "hidden" | string;
  ownerId?: string;
  category?: string;
  tags?: string[];
  discoverable?: boolean;
  isActive?: boolean;
  offerings?: Array<Record<string, unknown>> | Record<string, unknown>;
donation?: Record<string, unknown>;
greetingsEnabled?: boolean;
adviceEnabled?: boolean;
digitalMeetGreetEnabled?: boolean;
customClassEnabled?: boolean;
monetization?: {
    isPaid?: boolean;
    priceMonthly?: number | null;
    currency?: string | null;
    greetingsEnabled?: boolean;
adviceEnabled?: boolean;
digitalMeetGreetEnabled?: boolean;
customClassEnabled?: boolean;
  };
  searchMatchType?: CommunitySearchMatchType;
  searchScore?: number;
};

export type PublicUser = {
  uid: string;
  handle: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  photoURL?: string | null;
  offerings?: Array<Record<string, unknown>> | Record<string, unknown>;
  donation?: Record<string, unknown>;
  monetization?: Record<string, unknown>;
};

export type CanonicalMemberStatus =
  | "active"
  | "subscribed"
  | "muted"
  | "banned"
  | "removed"
  | null;

export function normalizeMemberStatus(raw: unknown): CanonicalMemberStatus {
  if (raw === "active") return "active";
  if (raw === "subscribed") return "subscribed";
  if (raw === "muted") return "muted";
  if (raw === "banned") return "banned";
  if (raw === "removed") return "removed";
  if (raw === "kicked") return "removed";
  if (raw === "expelled") return "removed";
  return null;
}

export function isJoinedStatus(status: CanonicalMemberStatus) {
  return status === "active" || status === "subscribed" || status === "muted";
}

export function isBlockedStatus(status: CanonicalMemberStatus) {
  return status === "banned" || status === "removed";
}

export function membershipStatusKey(status: CanonicalMemberStatus): string {
  if (status === "active") return "statusActive";
  if (status === "subscribed") return "statusSubscribed";
  if (status === "muted") return "statusMuted";
  if (status === "banned") return "statusBanned";
  if (status === "removed") return "statusRemoved";
  return "";
}

export function isPaidGroup(group: Community) {
  return !!group.monetization?.isPaid;
}

export function isPaidPrivateGroup(group: Community) {
  return group.visibility === "private" && isPaidGroup(group);
}

/** Precio mensual BASE de la suscripción del grupo (lo que fija el creador), o null. */
export function resolveSubscriptionBasePrice(group: Community): number | null {
  const m = group.monetization as Record<string, unknown> | undefined;
  const p =
    typeof m?.subscriptionPriceMonthly === "number"
      ? m.subscriptionPriceMonthly
      : typeof m?.priceMonthly === "number"
      ? m.priceMonthly
      : null;
  return p != null && Number.isFinite(p) && p > 0 ? p : null;
}

export function buildUserSearchText(user: PublicUser) {
  return [
    user.handle,
    user.displayName,
    user.firstName,
    user.lastName,
    `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim(),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function buildCommunitySearchText(group: Community) {
  return [group.name ?? "", group.description ?? "", group.visibility ?? ""]
    .join(" ")
    .toLowerCase();
}

export function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function initialsFromName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "";
  const b = parts[1]?.[0] ?? "";
  return (a + b).toUpperCase() || "U";
}

export function getDescriptionPreview(value?: string) {
  const clean = (value ?? "").trim().replace(/\s+/g, " ");

  if (!clean) return "";

  if (clean.length <= 60) return clean;

  return `${clean.slice(0, 80).trim()}...`;
}

export function getOfferingByType(
  offerings: Array<Record<string, unknown>> | Record<string, unknown> | undefined,
  type: string
): Record<string, unknown> | null {
  if (!offerings) return null;

  if (Array.isArray(offerings)) {
    return offerings.find((item) => item?.type === type) ?? null;
  }

  const direct = offerings[type];

  if (typeof direct === "object" && direct !== null) {
    return direct as Record<string, unknown>;
  }

  if (direct === true) {
    return { enabled: true, visible: true };
  }

  return null;
}

export function isVisibleEnabledService(service: Record<string, unknown> | null): boolean {
  if (!service) return false;

  const enabled = service.enabled === true;
  const visible = service.visible !== false;

  return enabled && visible;
}

// True si la comunidad ofrece saludos, consejos o algún tipo de sesión
// (meet & greet / clase / sesión exclusiva). No cuenta donaciones.
export function offersExperiences(
  source: {
    offerings?: Array<Record<string, unknown>> | Record<string, unknown>;
    monetization?: Record<string, unknown>;
    greetingsEnabled?: boolean;
    adviceEnabled?: boolean;
    digitalMeetGreetEnabled?: boolean;
    customClassEnabled?: boolean;
  } | undefined
): boolean {
  const offerings = source?.offerings;
  const monetization = source?.monetization ?? {};
  const saludo =
    isVisibleEnabledService(getOfferingByType(offerings, "saludo")) ||
    source?.greetingsEnabled === true ||
    monetization.greetingsEnabled === true;
  const consejo =
    isVisibleEnabledService(getOfferingByType(offerings, "consejo")) ||
    source?.adviceEnabled === true ||
    monetization.adviceEnabled === true;
  const meetGreet =
    isVisibleEnabledService(getOfferingByType(offerings, "meet_greet_digital")) ||
    source?.digitalMeetGreetEnabled === true ||
    monetization.digitalMeetGreetEnabled === true;
  const session =
    isVisibleEnabledService(getOfferingByType(offerings, "clase_personalizada")) ||
    source?.customClassEnabled === true ||
    monetization.customClassEnabled === true;
  return saludo || consejo || meetGreet || session;
}

export function getCommunityPreviewPriority(
  group: Community,
  currentUser: User | null,
  memberMap: Record<string, CanonicalMemberStatus>,
  reqMap: Record<string, boolean>
) {
  const isOwner =
    !!currentUser && !!group.ownerId && group.ownerId === currentUser.uid;
  const membershipStatus = isOwner ? "active" : memberMap[group.id] ?? null;
  const isMember = isOwner || isJoinedStatus(membershipStatus);
  const isBlocked = !isOwner && isBlockedStatus(membershipStatus);
  const isPrivate = group.visibility === "private";
  const isPublic = group.visibility === "public";
  const hasPendingReq = !!reqMap[group.id];
  const paidPrivate = isPaidPrivateGroup(group);

  if (!isOwner && !isMember && !isBlocked && isPublic) return 0;
  if (!isOwner && !isMember && !isBlocked && paidPrivate) return 1;
  if (!isOwner && !isMember && !isBlocked && isPrivate && !hasPendingReq)
    return 2;
  if (!isOwner && !isMember && !isBlocked && isPrivate && hasPendingReq)
    return 3;
  if (isMember && !isOwner) return 4;
  if (isOwner) return 5;
  if (isBlocked) return 6;
  return 7;
}

export const HISTORY_KEY = "vibra_search_history";
export const MAX_HISTORY = 15;

export type SearchHistoryEntity = {
  kind: "entity";
  entityType: "profile" | "community";
  id: string;
  name: string;
  handle?: string;
  avatarUrl?: string | null;
  href: string;
  ts: number;
};

export type SearchHistoryText = {
  kind: "text";
  query: string;
  ts: number;
};

export type SearchHistoryEntry = SearchHistoryEntity | SearchHistoryText;

export function loadHistory(): SearchHistoryEntry[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SearchHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

export function pushToHistory(
  current: SearchHistoryEntry[],
  entry: SearchHistoryEntry
): SearchHistoryEntry[] {
  const filtered = current.filter((e) => {
    if (e.kind === "text" && entry.kind === "text") return e.query !== entry.query;
    if (e.kind === "entity" && entry.kind === "entity") return e.href !== entry.href;
    return true;
  });
  const updated = [entry, ...filtered].slice(0, MAX_HISTORY);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  } catch {}
  return updated;
}

export type GroupsSearchPanelProps = {
  fontStack: string;
  showCreateGroup?: boolean;
  autoFocusOnMount?: boolean;
  createGroupHref?: string;
  showCloseSearch?: boolean;
  onCloseSearch?: () => void;
  // Modo página completa (búsqueda móvil): el preview/historial deja de ser un
  // dropdown flotante y llena la pantalla debajo del input.
  fullPage?: boolean;
};

export function isMobileSearchViewport() {
  return window.matchMedia("(max-width: 640px)").matches;
}

