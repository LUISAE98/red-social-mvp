"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { onAuthStateChanged, type User } from "firebase/auth";
import {
  doc,
  getDoc,
} from "firebase/firestore";

import { auth, db } from "@/lib/firebase";
import { searchGroups } from "@/lib/groups/searchGroups";
import { searchProfiles } from "@/lib/profile/searchProfiles";
import GroupsSearchToolbar from "./GroupsSearchToolbar";
import StoryRingAvatar from "@/app/components/Stories/StoryRingAvatar";


export type CommunitySearchMatchType = "exact" | "related" | "suggested";
const SEARCH_LIMIT = 12;
const SEARCH_DEBOUNCE_MS = 300;
const MIN_SEARCH_LENGTH = 2;

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
  offerings?: Array<Record<string, any>> | Record<string, any>;
donation?: Record<string, any>;
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
  offerings?: Array<Record<string, any>> | Record<string, any>;
  donation?: Record<string, any>;
  monetization?: Record<string, any>;
};

export type CanonicalMemberStatus =
  | "active"
  | "subscribed"
  | "muted"
  | "banned"
  | "removed"
  | null;

function normalizeMemberStatus(raw: unknown): CanonicalMemberStatus {
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

export function membershipStatusLabel(status: CanonicalMemberStatus) {
  if (status === "active") return "Ya estás unido";
  if (status === "subscribed") return "Suscripción activa";
  if (status === "muted") return "Ya estás unido (muteado)";
  if (status === "banned") return "Baneado";
  if (status === "removed") return "Expulsado";
  return "";
}

function isPaidGroup(group: Community) {
  return !!group.monetization?.isPaid;
}

function isPaidPrivateGroup(group: Community) {
  return group.visibility === "private" && isPaidGroup(group);
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

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function initialsFromName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "";
  const b = parts[1]?.[0] ?? "";
  return (a + b).toUpperCase() || "U";
}

function getDescriptionPreview(value?: string) {
  const clean = (value ?? "").trim().replace(/\s+/g, " ");

  if (!clean) return "";

  if (clean.length <= 60) return clean;

  return `${clean.slice(0, 80).trim()}...`;
}

type SearchServiceDot = {
  key: string;
  color: string;
  title: string;
};

const SEARCH_SERVICE_COLORS = {
  saludo: "#7DD3FC",
  consejo: "#FACC15",
  meetGreet: "#A78BFA",
  exclusiveSession: "#F472B6",
  weddingDonation: "#C084FC",
  generalDonation: "#FB7185",
};

function getOfferingByType(
  offerings: Array<Record<string, any>> | Record<string, any> | undefined,
  type: string
): Record<string, any> | null {
  if (!offerings) return null;

  if (Array.isArray(offerings)) {
    return offerings.find((item) => item?.type === type) ?? null;
  }

  const direct = offerings[type];

  if (typeof direct === "object" && direct !== null) {
    return direct as Record<string, any>;
  }

  if (direct === true) {
    return { enabled: true, visible: true };
  }

  return null;
}

function isVisibleEnabledService(service: Record<string, any> | null): boolean {
  if (!service) return false;

  const enabled = service.enabled === true;
  const visible = service.visible !== false;

  return enabled && visible;
}

function buildSearchServiceDots(source?: {
  offerings?: Array<Record<string, any>> | Record<string, any>;
  donation?: Record<string, any>;
  monetization?: Record<string, any>;
  greetingsEnabled?: boolean;
  adviceEnabled?: boolean;
  digitalMeetGreetEnabled?: boolean;
  customClassEnabled?: boolean;
}): SearchServiceDot[] {
  const offerings = source?.offerings;
  const donation = source?.donation ?? {};
  const monetization = source?.monetization ?? {};

  const dots: SearchServiceDot[] = [];

  const saludoEnabled =
    isVisibleEnabledService(getOfferingByType(offerings, "saludo")) ||
    source?.greetingsEnabled === true ||
    monetization.greetingsEnabled === true;

  const consejoEnabled =
    isVisibleEnabledService(getOfferingByType(offerings, "consejo")) ||
    source?.adviceEnabled === true ||
    monetization.adviceEnabled === true;

  const meetGreetEnabled =
    isVisibleEnabledService(getOfferingByType(offerings, "meet_greet_digital")) ||
    source?.digitalMeetGreetEnabled === true ||
    monetization.digitalMeetGreetEnabled === true;

  const exclusiveSessionEnabled =
    isVisibleEnabledService(getOfferingByType(offerings, "clase_personalizada")) ||
    source?.customClassEnabled === true ||
    monetization.customClassEnabled === true;

  if (saludoEnabled) {
    dots.push({
      key: "saludo",
      color: SEARCH_SERVICE_COLORS.saludo,
      title: "Solicitar saludo",
    });
  }

  if (consejoEnabled) {
    dots.push({
      key: "consejo",
      color: SEARCH_SERVICE_COLORS.consejo,
      title: "Solicitar consejo",
    });
  }

  if (meetGreetEnabled) {
    dots.push({
      key: "meet_greet_digital",
      color: SEARCH_SERVICE_COLORS.meetGreet,
      title: "Agendar encuentro",
    });
  }

  if (exclusiveSessionEnabled) {
    dots.push({
      key: "clase_personalizada",
      color: SEARCH_SERVICE_COLORS.exclusiveSession,
      title: "Reservar sesión exclusiva",
    });
  }

  if (
    donation.enabled === true &&
    donation.visible !== false &&
    donation.mode === "wedding"
  ) {
    dots.push({
      key: "wedding_donation",
      color: SEARCH_SERVICE_COLORS.weddingDonation,
      title: "Apoyar boda",
    });
  }

  if (
    donation.enabled === true &&
    donation.visible !== false &&
    donation.mode === "general"
  ) {
    dots.push({
      key: "general_donation",
      color: SEARCH_SERVICE_COLORS.generalDonation,
      title: "Apoyar",
    });
  }

  return dots;
}

function ServiceDots({ dots }: { dots: SearchServiceDot[] }) {
  if (dots.length === 0) return null;

  return (
    <span
      aria-label="Servicios activos"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        flexShrink: 0,
      }}
    >
      {dots.map((dot) => (
        <span
          key={dot.key}
          title={dot.title}
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            border: "none",
            background: dot.color,
            boxSizing: "border-box",
            display: "inline-flex",
            flexShrink: 0,
          }}
        />
      ))}
    </span>
  );
}

function getCommunityPreviewPriority(
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

const HISTORY_KEY = "vibra_search_history";
const MAX_HISTORY = 15;

type SearchHistoryEntity = {
  kind: "entity";
  entityType: "profile" | "community";
  id: string;
  name: string;
  handle?: string;
  avatarUrl?: string | null;
  href: string;
  ts: number;
};

type SearchHistoryText = {
  kind: "text";
  query: string;
  ts: number;
};

type SearchHistoryEntry = SearchHistoryEntity | SearchHistoryText;

function loadHistory(): SearchHistoryEntry[] {
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

function pushToHistory(
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

type GroupsSearchPanelProps = {
  fontStack: string;
  showCreateGroup?: boolean;
  autoFocusOnMount?: boolean;
  createGroupHref?: string;
  showCloseSearch?: boolean;
  onCloseSearch?: () => void;
};

function isMobileSearchViewport() {
  return window.matchMedia("(max-width: 640px)").matches;
}

export default function GroupsSearchPanel({
  fontStack,
  showCreateGroup = true,
  autoFocusOnMount = false,
  createGroupHref = "/groups/new",
  showCloseSearch = false,
  onCloseSearch,
}: GroupsSearchPanelProps) {
  const router = useRouter();
  const pathname = usePathname();

const searchAreaRef = useRef<HTMLDivElement | null>(null);
const dropdownRef = useRef<HTMLDivElement | null>(null);
const previousPathnameRef = useRef<string | null>(null);

  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [communitiesLoading, setCommunitiesLoading] = useState(true);
  const [profilesLoading, setProfilesLoading] = useState(true);

  const [communities, setCommunities] = useState<Community[]>([]);
  const [profiles, setProfiles] = useState<PublicUser[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [memberMap, setMemberMap] = useState<
    Record<string, CanonicalMemberStatus>
  >({});
  const [reqMap, setReqMap] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [mounted, setMounted] = useState(false);
  const [isSearchClosing, setIsSearchClosing] = useState(false);
  const [history, setHistory] = useState<SearchHistoryEntry[]>([]);
  const [isFocused, setIsFocused] = useState(false);
  const isFocusedRef = useRef(false);

  const cardBorder = "1px solid rgba(255,255,255,0.14)";
  const softBorder = "1px solid rgba(255,255,255,0.18)";
  const shadow = "0 18px 46px rgba(0,0,0,0.42)";

const normalizedSearch = debouncedSearch.trim().toLowerCase();
const hasSearch = normalizedSearch.length >= MIN_SEARCH_LENGTH;
const historyVisible = !hasSearch && isFocused && history.length > 0;

isFocusedRef.current = isFocused;

  useEffect(() => {
    setMounted(true);
    setHistory(loadHistory());

    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
    });

    return () => unsub();
  }, []);
  useEffect(() => {
  const timer = window.setTimeout(() => {
    setDebouncedSearch(search);
  }, SEARCH_DEBOUNCE_MS);

  return () => window.clearTimeout(timer);
}, [search]);

useEffect(() => {
  function handlePointerDown(event: PointerEvent) {
    const target = event.target;
    if (!(target instanceof Node)) return;

    if (searchAreaRef.current?.contains(target)) return;
    if (dropdownRef.current?.contains(target)) return;

    if (isFocusedRef.current) {
      setIsFocused(false);
    }

    if (!hasSearch && !showCloseSearch) return;
    handleCloseSearch();
  }

  document.addEventListener("pointerdown", handlePointerDown, true);

  return () => {
    document.removeEventListener("pointerdown", handlePointerDown, true);
  };
}, [hasSearch, onCloseSearch]);

useEffect(() => {
  let cancelled = false;

  async function loadCommunities() {
    setError(null);

    if (!hasSearch) {
      setCommunities([]);
      setCommunitiesLoading(false);
      return;
    }

    try {
      setCommunitiesLoading(true);

      const result = await searchGroups({
        term: debouncedSearch,
        pageSize: SEARCH_LIMIT,
        visibility: ["public", "private"],
      });

      if (cancelled) return;

      setCommunities(result.groups as Community[]);
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Error cargando comunidades";

      setError(message);
      setCommunities([]);
    } finally {
      if (!cancelled) {
        setCommunitiesLoading(false);
      }
    }
  }

  loadCommunities();

  return () => {
    cancelled = true;
  };
}, [hasSearch, debouncedSearch]);

useEffect(() => {
  let cancelled = false;

  async function loadProfiles() {
    if (!hasSearch) {
      setProfiles([]);
      setProfilesLoading(false);
      return;
    }

    try {
      setProfilesLoading(true);

      const result = await searchProfiles({
        db,
        rawQuery: debouncedSearch,
        currentUserId: user?.uid ?? null,
        maxResults: SEARCH_LIMIT,
      });

      if (cancelled) return;

      setProfiles(
        result.map((profile) => ({
          uid: profile.uid,
          handle: profile.handle,
          displayName: profile.displayName,
          firstName: profile.firstName ?? "",
          lastName: profile.lastName ?? "",
          photoURL: profile.photoURL ?? null,
          offerings: profile.offerings,
          donation: profile.donation,
          monetization: profile.monetization,
        }))
      );
    } catch (e) {
      const message =
        e instanceof Error
          ? e.message
          : "Error cargando perfiles";

      setError(message);
      setProfiles([]);
    } finally {
      if (!cancelled) {
        setProfilesLoading(false);
      }
    }
  }

  loadProfiles();

  return () => {
    cancelled = true;
  };
}, [hasSearch, debouncedSearch, user?.uid]);

useEffect(() => {
  let cancelled = false;

  async function loadMembershipState() {
    if (!user || communities.length === 0) {
      setMemberMap({});
      setReqMap({});
      return;
    }

    try {
      const entries = await Promise.all(
        communities.slice(0, SEARCH_LIMIT).map(async (group) => {
          const memberRef = doc(
            db,
            "groups",
            group.id,
            "members",
            user.uid
          );

          const requestRef = doc(
            db,
            "groups",
            group.id,
            "joinRequests",
            user.uid
          );

          const [memberSnap, requestSnap] = await Promise.all([
            getDoc(memberRef),
            getDoc(requestRef),
          ]);

          const memberStatus = memberSnap.exists()
            ? normalizeMemberStatus(
                (memberSnap.data() as Record<string, unknown>)
                  ?.status ?? "active"
              )
            : null;

          const requestData = requestSnap.data() as
            | Record<string, unknown>
            | undefined;

          const pending =
            requestSnap.exists() &&
            (requestData?.status ?? "pending") === "pending";

          return {
            groupId: group.id,
            memberStatus,
            pending,
          };
        })
      );

      if (cancelled) return;

      const nextMemberMap: Record<
        string,
        CanonicalMemberStatus
      > = {};

      const nextReqMap: Record<string, boolean> = {};

      entries.forEach((entry) => {
        nextMemberMap[entry.groupId] = entry.memberStatus;
        nextReqMap[entry.groupId] = entry.pending;
      });

      setMemberMap(nextMemberMap);
      setReqMap(nextReqMap);
    } catch (e) {
      console.error(e);
    }
  }

  loadMembershipState();

  return () => {
    cancelled = true;
  };
}, [user, communities]);

  useEffect(() => {
    if (previousPathnameRef.current === null) {
      previousPathnameRef.current = pathname;
      return;
    }

    if (pathname !== previousPathnameRef.current) {
      setSearch("");
      onCloseSearch?.();
      previousPathnameRef.current = pathname;
    }
  }, [pathname, onCloseSearch]);

  const searchableCommunities = useMemo(() => {
    return communities.filter((group) => {
      if (group.visibility === "hidden") return false;
      if (group.isActive === false) return false;
      if (group.discoverable === false) return false;
      return true;
    });
  }, [communities]);

const filteredCommunities = useMemo(() => {
  if (!normalizedSearch) return [];

  return searchableCommunities;
}, [searchableCommunities, normalizedSearch]);

  const filteredProfiles = useMemo(() => {
    if (!normalizedSearch) return [];

    const normalizedQuery = normalizeText(search);

    return profiles.filter((p) => {
      if (!p.handle) return false;
      if (user?.uid && p.uid === user.uid) return false;
      return normalizeText(buildUserSearchText(p)).includes(normalizedQuery);
    });
  }, [profiles, normalizedSearch, search, user?.uid]);

  const previewCommunities = useMemo(() => {
    const ordered = [...filteredCommunities].sort((a, b) => {
      const priorityA = getCommunityPreviewPriority(a, user, memberMap, reqMap);
      const priorityB = getCommunityPreviewPriority(b, user, memberMap, reqMap);

      if (priorityA !== priorityB) return priorityA - priorityB;
      return (a.name ?? "").localeCompare(b.name ?? "");
    });

    return ordered.slice(0, 4);
  }, [filteredCommunities, user, memberMap, reqMap]);

  const previewProfiles = useMemo(
    () => filteredProfiles.slice(0, 4),
    [filteredProfiles]
  );

  async function handleJoinPublic(groupId: string) {
    if (!user) return;

    try {
      const { joinGroup } = await import("@/lib/groups/membership");
      await joinGroup(groupId, user.uid);

      setMemberMap((prev) => ({
        ...prev,
        [groupId]: "active",
      }));

      setReqMap((prev) => ({
        ...prev,
        [groupId]: false,
      }));
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "No se pudo unir a la comunidad";
      setError(message);
    }
  }

  async function handleRequestPrivate(groupId: string) {
    if (!user) return;

    const group = communities.find((item) => item.id === groupId);
    if (group && isPaidPrivateGroup(group)) {
      handleNavigateAndClose(`/groups/${groupId}`);
      return;
    }

    try {
      const { requestToJoin } = await import("@/lib/groups/joinRequests");
      await requestToJoin(groupId, user.uid);

      setReqMap((prev) => ({
        ...prev,
        [groupId]: true,
      }));
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "No se pudo enviar solicitud";
      setError(message);
    }
  }

  async function handleCancelRequest(groupId: string) {
    if (!user) return;

    try {
      const { cancelJoinRequest } = await import("@/lib/groups/joinRequests");
      await cancelJoinRequest(groupId, user.uid);

      setReqMap((prev) => ({
        ...prev,
        [groupId]: false,
      }));
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "No se pudo cancelar solicitud";
      setError(message);
    }
  }

  async function handleLeave(groupId: string, ownerId?: string) {
    if (!user) return;

    if (ownerId && ownerId === user.uid) {
      setError("El owner no puede salir de su propia comunidad.");
      return;
    }

    try {
      const { leaveGroup } = await import("@/lib/groups/membership");
      await leaveGroup(groupId, user.uid);

      setMemberMap((prev) => ({
        ...prev,
        [groupId]: null,
      }));

      setReqMap((prev) => ({
        ...prev,
        [groupId]: false,
      }));
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "No se pudo salir de la comunidad";
      setError(message);
    }
  }

function handleCloseSearch() {
  if (isSearchClosing) return;

  if (isMobileSearchViewport()) {
    setIsSearchClosing(true);

    window.setTimeout(() => {
      setSearch("");
      setDebouncedSearch("");
      setIsSearchClosing(false);
      onCloseSearch?.();
    }, 260);

    return;
  }

  setSearch("");
  setDebouncedSearch("");
  onCloseSearch?.();
}

  function handleNavigateAndClose(href: string) {
    setSearch("");
    onCloseSearch?.();
    router.push(href);
  }

  function handleOpenSubscription(groupId: string) {
    handleNavigateAndClose(`/groups/${groupId}`);
  }

function handleOpenFullResults() {
  if (!normalizedSearch) return;

  const trimmed = search.trim();
  if (trimmed) {
    const entry: SearchHistoryEntry = { kind: "text", query: trimmed, ts: Date.now() };
    setHistory((h) => pushToHistory(h, entry));
  }

  const params = new URLSearchParams();
  params.set("q", search);

  if (filteredProfiles.length > 0 && filteredCommunities.length === 0) {
    params.set("tab", "profiles");
  } else {
    params.set("tab", "groups");
  }

  setSearch("");
  onCloseSearch?.();

  router.push(`/search?${params.toString()}`);
}

  const isLoading = authLoading || communitiesLoading || profilesLoading;
  const hasAnyResults =
    filteredCommunities.length > 0 || filteredProfiles.length > 0;

  return (
    <>
      <style jsx>{`
.search-area {
  position: relative;
  z-index: 60;
  width: 100%;
  overflow: visible;
}

.search-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  right: 0;
  width: 100%;
  min-width: 0;
  border: ${cardBorder};
  border-radius: 20px;
  background: rgba(12, 12, 12, 0.97);
  box-shadow: ${shadow};
  overflow: hidden;
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  z-index: 9999;
  display: flex;
  flex-direction: column;
  max-height: min(58dvh, 460px);
  opacity: 0;
  transform: translateY(-8px) scaleY(0.96);
  transform-origin: top center;
  animation: dropdown-enter 0.28s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}

        @keyframes dropdown-enter {
from {
  opacity: 0;
  transform: translateY(-8px) scaleY(0.96);
}

to {
  opacity: 1;
  transform: translateY(0) scaleY(1);
}
        }

        .search-dropdown-inner {
          flex: 1 1 auto;
          min-height: 0;
          overflow-y: auto;
        }

        .dropdown-section {
          display: grid;
        }

        .dropdown-section + .dropdown-section {
          border-top: 1px solid rgba(255, 255, 255, 0.08);
        }

        .dropdown-title {
          margin: 0;
          padding: 12px 14px 8px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: rgba(255, 255, 255, 0.58);
          background: rgba(255, 255, 255, 0.02);
        }

        .dropdown-helper {
          padding: 14px;
          color: rgba(255, 255, 255, 0.76);
          font-size: 13px;
          line-height: 1.4;
        }

        .dropdown-footer {
          flex: 0 0 auto;
          padding: 10px 12px 12px;
          border-top: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(12, 12, 12, 0.98);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
        }

        .more-results-btn {
          width: 100%;
          min-height: 40px;
          padding: 9px 12px;
          border-radius: 12px;
          border: ${softBorder};
          background: rgba(255, 255, 255, 0.07);
          color: #fff;
          cursor: pointer;
          font-weight: 600;
          font-size: 13px;
          font-family: ${fontStack};
        }

        .more-results-btn:hover {
          background: rgba(255, 255, 255, 0.09);
        }

        .error-card {
          margin-top: 14px;
          padding: 12px 14px;
          border-radius: 14px;
          border: 1px solid rgba(255, 255, 255, 0.14);
          background: rgba(255, 255, 255, 0.05);
          color: #fff;
          font-size: 13px;
          line-height: 1.45;
        }

        .result-item {
          padding: 10px 14px;
          transition: background 0.16s ease;
          cursor: pointer;
        }

        .result-item:hover {
          background: rgba(255, 255, 255, 0.035);
        }

        .result-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 10px;
          align-items: center;
        }

        .result-main-mobile {
          display: flex;
          gap: 10px;
          align-items: center;
          min-width: 0;
        }

        .result-avatar {
          width: 42px;
          height: 42px;
          border-radius: 50%;
          overflow: hidden;
          border: 1px solid rgba(255, 255, 255, 0.14);
          background: rgba(255, 255, 255, 0.04);
          display: grid;
          place-items: center;
          flex-shrink: 0;
        }

        .result-avatar-fallback {
          font-size: 12px;
          font-weight: 700;
          color: #fff;
        }

        .result-content {
          min-width: 0;
          display: grid;
          gap: 5px;
        }

.result-name {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.2;
  color: #fff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-name-with-meta {
  display: flex;
  align-items: baseline;
  gap: 5px;
  min-width: 0;
}

.result-name-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-name-dot {
  flex-shrink: 0;
  color: rgba(255, 255, 255, 0.42);
  font-size: 11px;
  line-height: 1;
}

.result-name-visibility {
  flex-shrink: 0;
  color: rgba(255, 255, 255, 0.48);
  font-size: 11px;
  font-weight: 500;
  line-height: 1.2;
  white-space: nowrap;
}

.visibility-mobile {
  display: none;
}

.service-dots {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.service-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  border: 1.5px solid currentColor;
  background: transparent;
  box-sizing: border-box;
  display: inline-flex;
  flex-shrink: 0;
}

.service-dots-desktop {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}

.service-dots-mobile {
  display: none;
}
  .result-description-preview {
  display: block;
  margin: -1px 0 0;
  max-width: 420px;
  overflow: hidden;
  color: rgba(255, 255, 255, 0.5);
  font-size: 11px;
  font-weight: 400;
  line-height: 1.25;
  white-space: nowrap;
  text-overflow: ellipsis;
}

        .result-meta {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
        }

        .pill {
          font-size: 11px;
          padding: 3px 8px;
          border-radius: 999px;
          border: 1px solid rgba(255, 255, 255, 0.14);
          background: rgba(255, 255, 255, 0.05);
          color: rgba(255, 255, 255, 0.88);
          line-height: 1.2;
          white-space: nowrap;
        }

        .pill-paid {
          border: 1px solid rgba(255, 225, 166, 0.26);
          background: rgba(255, 225, 166, 0.1);
          font-weight: 600;
        }

        .meta-inline {
          font-size: 11px;
          color: rgba(255, 255, 255, 0.56);
          line-height: 1.25;
        }

        .meta-danger {
          color: rgba(255, 176, 176, 0.9);
        }

        .actions-wrap {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 6px;
          flex-wrap: nowrap;
          flex-shrink: 0;
        }

        .primary-btn {
          min-height: 34px;
          padding: 7px 11px;
          border-radius: 11px;
          border: 1px solid rgba(255, 255, 255, 0.22);
          background: #fff;
          color: #000;
          cursor: pointer;
          font-weight: 600;
          font-size: 12px;
          font-family: ${fontStack};
          display: inline-flex;
          align-items: center;
          justify-content: center;
          white-space: nowrap;
        }

        .secondary-btn {
          min-height: 34px;
          padding: 7px 11px;
          border-radius: 11px;
          border: ${softBorder};
          background: rgba(255, 255, 255, 0.06);
          color: #fff;
          cursor: pointer;
          font-weight: 600;
          font-size: 12px;
          font-family: ${fontStack};
          white-space: nowrap;
        }

        .disabled-btn {
          min-height: 34px;
          padding: 7px 11px;
          border-radius: 11px;
          border: 1px solid rgba(255, 255, 255, 0.14);
          background: rgba(255, 255, 255, 0.05);
          color: rgba(255, 255, 255, 0.68);
          font-weight: 600;
          font-size: 12px;
          font-family: ${fontStack};
          cursor: default;
          white-space: nowrap;
        }

        .profile-cta {
          font-size: 11px;
          color: rgba(255, 255, 255, 0.52);
          white-space: nowrap;
        }

@media (max-width: 640px) {
  .search-area {
    position: relative;
    z-index: 9999;
    overflow: visible;
  }

.search-dropdown {
  position: fixed;
  top: calc(env(safe-area-inset-top, 0px) + 58px);
  left: 0;
  right: 0;
  width: auto;
  min-width: 0;
  border-radius: 0 0 18px 18px;
  max-height: min(58dvh, 460px);
  z-index: 99999;
  transform: translateY(-14px);
  opacity: 0;
  animation: mobile-search-enter 0.26s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}

  .search-dropdown-inner {
    overscroll-behavior: contain;
  }

  .service-dot {
    width: 7px;
    height: 7px;
    border-width: 1.4px;
  }

  .service-dots-desktop {
    display: none;
  }

  .service-dots-mobile {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 14px;
    margin-top: -1px;
  }

  .mobile-service-separator {
    color: rgba(255, 255, 255, 0.34);
    font-size: 10px;
    line-height: 1;
    flex-shrink: 0;
  }

  .mobile-visibility-label {
    color: rgba(255, 255, 255, 0.48);
    font-size: 10px;
    font-weight: 500;
    line-height: 1.2;
    white-space: nowrap;
  }

  .result-description-preview {
    display: none;
  }

  .visibility-desktop {
    display: none;
  }

  .visibility-mobile {
    display: none;
  }

  .dropdown-title {
    padding: 11px 13px 8px;
    font-size: 11px;
  }

  .result-item {
    padding: 10px 12px;
  }

  .result-grid {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
    align-items: center;
  }

  .result-main-mobile {
    gap: 8px;
    align-items: center;
  }

  .result-avatar {
    width: 38px;
    height: 38px;
  }

  .result-content {
    min-width: 0;
  }

  .result-name {
    font-size: 13px;
  }

  .result-name-visibility {
    font-size: 10px;
  }

  .result-meta {
    gap: 5px;
  }

  .actions-wrap {
    justify-content: flex-end;
    width: auto;
  }

  .primary-btn,
  .secondary-btn,
  .disabled-btn {
    min-height: 32px;
    padding: 6px 10px;
    font-size: 11px;
  }

  .profile-cta {
    display: none;
  }

.search-dropdown-closing {
  animation: mobile-search-exit 0.24s ease forwards;
}

@keyframes mobile-search-enter {
  from {
    opacity: 0;
    transform: translateY(-14px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes mobile-search-exit {
  from {
    opacity: 1;
    transform: translateY(0);
  }

  to {
    opacity: 0;
    transform: translateY(-14px);
  }
}
      `}</style>

      <div ref={searchAreaRef} className="search-area">
<GroupsSearchToolbar
  search={search}
  onSearchChange={setSearch}
  onCreateGroup={
    showCreateGroup ? () => router.push(createGroupHref) : undefined
  }
  onCloseSearch={showCloseSearch ? handleCloseSearch : undefined}
  onFocusChange={(focused) => {
    if (focused) {
      setIsFocused(true);
    } else {
      // On touch devices, blur fires at touchstart — before the synthesized click.
      // Delay so history-item taps have time to fire before the dropdown unmounts.
      window.setTimeout(() => setIsFocused(false), 200);
    }
  }}
  onEnterKey={handleOpenFullResults}
  fontStack={fontStack}
  showCreateGroup={showCreateGroup}
  showCloseSearch={showCloseSearch}
  isMobileClosing={isSearchClosing}
  autoFocusOnMount={autoFocusOnMount}
/>

{mounted && historyVisible && (
  <div
    ref={dropdownRef}
    className="search-dropdown"
    onMouseDown={(e) => e.preventDefault()}
  >
    <div className="search-dropdown-inner">
      <section className="dropdown-section">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px 4px" }}>
          <h2 className="dropdown-title" style={{ padding: 0 }}>Recientes</h2>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              try { localStorage.removeItem(HISTORY_KEY); } catch {}
              setHistory([]);
            }}
            style={{ background: "none", border: "none", color: "rgba(255,255,255,0.44)", fontSize: "12px", cursor: "pointer", fontFamily: fontStack, padding: "2px 4px", borderRadius: 6 }}
          >
            Limpiar
          </button>
        </div>
        {history.map((entry, i) => {
          const removeBtn = (
            <button
              type="button"
              aria-label="Eliminar del historial"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                const updated = history.filter((_, j) => j !== i);
                try { localStorage.setItem(HISTORY_KEY, JSON.stringify(updated)); } catch {}
                setHistory(updated);
              }}
              style={{ flexShrink: 0, background: "none", border: "none", color: "rgba(255,255,255,0.35)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 6, padding: 0 }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          );

          if (entry.kind === "text") {
            return (
              <div
                key={i}
                className="result-item"
                style={{ display: "flex", alignItems: "center", gap: 10 }}
                onClick={() => setSearch(entry.query)}
              >
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(255,255,255,0.07)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                </div>
                <span style={{ color: "rgba(255,255,255,0.88)", fontSize: 13, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.query}</span>
                {removeBtn}
              </div>
            );
          }
          const isProfile = entry.entityType === "profile";
          return (
            <div
              key={i}
              className="result-item"
              style={{ display: "flex", alignItems: "center", gap: 10 }}
              onClick={() => handleNavigateAndClose(entry.href)}
            >
              {entry.avatarUrl ? (
                <img src={entry.avatarUrl} alt="" style={{ width: 36, height: 36, borderRadius: isProfile ? "50%" : 10, objectFit: "cover", flexShrink: 0 }} />
              ) : (
                <div style={{ width: 36, height: 36, borderRadius: isProfile ? "50%" : 10, background: "rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.7)", flexShrink: 0 }}>
                  {initialsFromName(entry.name)}
                </div>
              )}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ color: "rgba(255,255,255,0.9)", fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{entry.name}</div>
                <div style={{ color: "rgba(255,255,255,0.44)", fontSize: 12 }}>
                  {isProfile && entry.handle ? `@${entry.handle}` : "Comunidad"}
                </div>
              </div>
              {removeBtn}
            </div>
          );
        })}
      </section>
    </div>
  </div>
)}

{mounted && hasSearch && (
  <div
    ref={dropdownRef}
    className={`search-dropdown${isSearchClosing ? " search-dropdown-closing" : ""}`}
  >
            <div className="search-dropdown-inner">
              {isLoading && (
                <div className="dropdown-helper">
                  Buscando comunidades, perfiles y publicaciones...
                </div>
              )}

              {!isLoading && !hasAnyResults && (
                <div className="dropdown-helper">
                  No se encontraron comunidades ni perfiles con esa búsqueda.
                </div>
              )}

              {!isLoading && previewCommunities.length > 0 && (
                <section className="dropdown-section">
                  <h2 className="dropdown-title">Comunidades</h2>

                  {previewCommunities.map((g) => {
                    const isOwner =
                      !!user && !!g.ownerId && g.ownerId === user.uid;
                    const membershipStatus = isOwner
                      ? "active"
                      : memberMap[g.id] ?? null;

                    const isMember = isOwner || isJoinedStatus(membershipStatus);
                    const isBlocked =
                      !isOwner && isBlockedStatus(membershipStatus);

                    const isPrivate = g.visibility === "private";
                    const isPublic = g.visibility === "public";
                    const hasPendingReq = !!reqMap[g.id];
                    const paidPrivate = isPaidPrivateGroup(g);

const visLabel =
  g.visibility === "public"
    ? "Comunidad pública"
    : g.visibility === "private"
      ? "Comunidad privada"
      : "Comunidad oculta";
                    const price = g.monetization?.priceMonthly ?? null;
                    const cur = g.monetization?.currency ?? null;
                    const serviceDots = buildSearchServiceDots(g);

                    return (
                      <div
                        key={g.id}
                        className="result-item"
                        onClick={() => {
                          const entry: SearchHistoryEntry = { kind: "entity", entityType: "community", id: g.id, name: g.name ?? "(sin nombre)", avatarUrl: g.avatarUrl ?? null, href: `/groups/${g.id}`, ts: Date.now() };
                          setHistory((h) => pushToHistory(h, entry));
                          handleNavigateAndClose(`/groups/${g.id}`);
                        }}
                      >
                        <div className="result-grid">
                          <div className="result-main-mobile">
                            <StoryRingAvatar
                              entityId={g.id}
                              entityType="group"
                              currentUserId={user?.uid ?? null}
                              photoURL={g.avatarUrl ?? null}
                              displayName={g.name ?? "Comunidad"}
                              size={42}
                              onClick={(e) => {
                                e.stopPropagation();
                                const entry: SearchHistoryEntry = { kind: "entity", entityType: "community", id: g.id, name: g.name ?? "(sin nombre)", avatarUrl: g.avatarUrl ?? null, href: `/groups/${g.id}`, ts: Date.now() };
                                setHistory((h) => pushToHistory(h, entry));
                                handleNavigateAndClose(`/groups/${g.id}`);
                              }}
                            />

                            <div className="result-content">
<h3 className="result-name result-name-with-meta">
  <span className="result-name-text">
    {g.name ?? "(sin nombre)"}
  </span>
<span className="result-name-dot visibility-desktop">·</span>
<span className="result-name-visibility">
  <span className="visibility-desktop">{visLabel}</span>
  <span className="visibility-mobile">
    {visLabel.replace("Comunidad ", "").toLowerCase()}
  </span>
</span>

<span className="service-dots-desktop">
  <ServiceDots dots={serviceDots} />
</span>
</h3>

{getDescriptionPreview(g.description) ? (
  <p className="result-description-preview">
    {getDescriptionPreview(g.description)}
  </p>
) : null}

<div className="service-dots-mobile">
  <span className="mobile-visibility-label">
    {visLabel}
  </span>

  {serviceDots.length > 0 ? (
    <>
      <span className="mobile-service-separator">·</span>
      <ServiceDots dots={serviceDots} />
    </>
  ) : null}
</div>

<div className="result-meta">

                                {!isOwner && isBlocked && (
                                  <span className="meta-inline meta-danger">
                                    ({membershipStatusLabel(membershipStatus)})
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div
                            className="actions-wrap"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {!isOwner && !isMember && !isBlocked && isPublic && (
                              <button
                                onClick={() => void handleJoinPublic(g.id)}
                                className="primary-btn"
                                type="button"
                              >
                                Unirme
                              </button>
                            )}

                            {!isOwner && !isMember && !isBlocked && paidPrivate && (
<button
  onClick={() => handleOpenSubscription(g.id)}
  className="primary-btn"
  type="button"
>
  💎 Suscribirme
  {price != null ? ` · ${price} ${cur ?? "MXN"}` : ""}
</button>
                            )}

                            {!isOwner &&
                              !isMember &&
                              !isBlocked &&
                              isPrivate &&
                              !paidPrivate && (
                                <>
                                  {!hasPendingReq ? (
                                    <button
                                      onClick={() =>
                                        void handleRequestPrivate(g.id)
                                      }
                                      className="secondary-btn"
                                      type="button"
                                    >
                                      Solicitar acceso
                                    </button>
                                  ) : (
<button
  onClick={() => void handleCancelRequest(g.id)}
  className="secondary-btn"
  type="button"
>
  Cancelar
</button>
                                  )}
                                </>
                              )}

                            {isMember && !isOwner && (
                              <button
                                onClick={() => void handleLeave(g.id, g.ownerId)}
                                className="secondary-btn"
                                type="button"
                              >
                                Salir
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </section>
              )}

              {!isLoading && previewProfiles.length > 0 && (
                <section className="dropdown-section">
                  <h2 className="dropdown-title">Perfiles</h2>

                  {previewProfiles.map((p) => {
                    const fullName =
                      p.displayName?.trim() ||
                      `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() ||
                      p.handle ||
                      "Usuario";

                      const serviceDots = buildSearchServiceDots(p);

                    return (
                      <div
                        key={p.uid}
                        className="result-item"
                        onClick={() => {
                          const entry: SearchHistoryEntry = { kind: "entity", entityType: "profile", id: p.uid, name: fullName, handle: p.handle, avatarUrl: p.photoURL ?? null, href: `/u/${p.handle}`, ts: Date.now() };
                          setHistory((h) => pushToHistory(h, entry));
                          handleNavigateAndClose(`/u/${p.handle}`);
                        }}
                      >
                        <div className="result-grid">
<div className="result-main-mobile">
  <StoryRingAvatar
    entityId={p.uid}
    entityType="profile"
    currentUserId={user?.uid ?? null}
    photoURL={p.photoURL}
    displayName={fullName}
    size={42}
    onClick={(e) => {
      e.stopPropagation();
      const entry: SearchHistoryEntry = { kind: "entity", entityType: "profile", id: p.uid, name: fullName, handle: p.handle, avatarUrl: p.photoURL ?? null, href: `/u/${p.handle}`, ts: Date.now() };
      setHistory((h) => pushToHistory(h, entry));
      handleNavigateAndClose(`/u/${p.handle}`);
    }}
  />

  <div className="result-content">
    <h3 className="result-name result-name-with-meta">
  <span className="result-name-text">{fullName}</span>
  <ServiceDots dots={serviceDots} />
</h3>

    <div className="result-meta">
      <span className="pill">@{p.handle}</span>
    </div>
  </div>
</div>

<div className="profile-cta">Abrir</div>
                        </div>
                      </div>
                    );
                  })}
                </section>
              )}
            </div>

            {!isLoading && hasSearch && (
              <div className="dropdown-footer">
                <button
                  type="button"
                  className="more-results-btn"
                  onClick={handleOpenFullResults}
                >
                  Ver más resultados
                </button>
              </div>
            )}
          </div>
        )}

        {error && <div className="error-card">{error}</div>}
      </div>
    </>
  );
}