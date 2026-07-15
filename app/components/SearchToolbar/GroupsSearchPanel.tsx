"use client";

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
const VIBRA_STORY_RING = "linear-gradient(135deg, #ec4899 0%, #9333ea 52%, #3b82f6 100%)";

function storyThumb(s: StoryDoc): string | null {
  if (s.muxPlaybackId) return `https://image.mux.com/${s.muxPlaybackId}/thumbnail.jpg?time=0`;
  if (s.thumbnailUrl) return s.thumbnailUrl;
  return null;
}

// Badge del post/live: premium, live programado, en vivo o VOD.
type PostBadge = { label: string; ticket: boolean; live?: boolean };

function postBadge(p: Post): PostBadge | null {
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

export function membershipStatusKey(status: CanonicalMemberStatus): string {
  if (status === "active") return "statusActive";
  if (status === "subscribed") return "statusSubscribed";
  if (status === "muted") return "statusMuted";
  if (status === "banned") return "statusBanned";
  if (status === "removed") return "statusRemoved";
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

function getOfferingByType(
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

function isVisibleEnabledService(service: Record<string, unknown> | null): boolean {
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
  // Modo página completa (búsqueda móvil): el preview/historial deja de ser un
  // dropdown flotante y llena la pantalla debajo del input.
  fullPage?: boolean;
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
  fullPage = false,
}: GroupsSearchPanelProps) {
  const tGroups = useTranslations("groups");
  const tCommon = useTranslations("common");

  const router = useRouter();
  const pathname = usePathname();

const searchAreaRef = useRef<HTMLDivElement | null>(null);
const dropdownRef = useRef<HTMLDivElement | null>(null);
const previousPathnameRef = useRef<string | null>(null);

  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [communitiesLoading, setCommunitiesLoading] = useState(true);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [storiesLoading, setStoriesLoading] = useState(true);
  const [postsLoading, setPostsLoading] = useState(true);

  const [communities, setCommunities] = useState<Community[]>([]);
  const [profiles, setProfiles] = useState<PublicUser[]>([]);
  const [stories, setStories] = useState<StoryDoc[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [storyViewerIndex, setStoryViewerIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { toast: searchToast, showToast: showSearchToast } = useVibraToast();
  useEffect(() => { if (error) showSearchToast(error, "error"); }, [error]); // eslint-disable-line react-hooks/exhaustive-deps

  const [memberMap, setMemberMap] = useState<
    Record<string, CanonicalMemberStatus>
  >({});
  const [reqMap, setReqMap] = useState<Record<string, boolean>>({});
  // Seguir a un perfil: uid → ¿ya lo sigues? / ¿en curso?
  const [followMap, setFollowMap] = useState<Record<string, boolean>>({});
  const [followBusy, setFollowBusy] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [mounted, setMounted] = useState(false);
  const [isSearchClosing, setIsSearchClosing] = useState(false);
  // Salida animada del panel de resultados: seguimos montados mientras corre
  // la animación de cierre y desmontamos al terminar.
  const [resultsRendered, setResultsRendered] = useState(false);
  const [resultsClosing, setResultsClosing] = useState(false);
  const [history, setHistory] = useState<SearchHistoryEntry[]>([]);
  const [isFocused, setIsFocused] = useState(false);
  const isFocusedRef = useRef(false);
  const storyViewerOpenRef = useRef(false);


const normalizedSearch = debouncedSearch.trim().toLowerCase();
const hasSearch = normalizedSearch.length >= MIN_SEARCH_LENGTH;
// Sin sesión iniciada nunca se muestra historial (es privado del usuario).
// En página completa (búsqueda móvil) el historial se muestra siempre que no haya
// búsqueda activa, sin depender del foco del input.
const historyVisible = !!user && !hasSearch && (fullPage || isFocused) && history.length > 0;

isFocusedRef.current = isFocused;
// Mientras el visor de historias está abierto, ignoramos los clics fuera para
// que el preview no se cierre (solo se cierra al abrir post/perfil/comunidad).
storyViewerOpenRef.current = storyViewerIndex !== null;

// Mantener el panel de resultados montado durante la animación de salida.
// Si al cerrar pasamos a mostrar el historial, hacemos el cambio sin animar
// para no solapar ambos paneles.
const resultsOpen = mounted && hasSearch;
useEffect(() => {
  if (resultsOpen) {
    setResultsRendered(true);
    setResultsClosing(false);
    return;
  }
  if (!resultsRendered) return;
  if (historyVisible) {
    setResultsRendered(false);
    setResultsClosing(false);
    return;
  }
  setResultsClosing(true);
  const t = window.setTimeout(() => {
    setResultsRendered(false);
    setResultsClosing(false);
  }, 240);
  return () => window.clearTimeout(t);
}, [resultsOpen, resultsRendered, historyVisible]);

  useEffect(() => {
    setMounted(true);

    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);

      if (u) {
        // Sesión activa: cargar el historial guardado en este navegador.
        setHistory(loadHistory());
      } else {
        // Sin sesión: el historial de búsqueda es privado del usuario.
        // No mostrarlo y borrarlo del almacenamiento para que no quede
        // disponible al siguiente usuario del navegador.
        setHistory([]);
        try {
          localStorage.removeItem(HISTORY_KEY);
        } catch {}
      }
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

    // Con el visor de historias abierto no cerramos el preview por clic fuera.
    if (storyViewerOpenRef.current) return;

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
// eslint-disable-next-line react-hooks/exhaustive-deps
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
        e instanceof Error ? e.message : tGroups("loadError");

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
          : tCommon("loadError");

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

  async function loadStories() {
    if (!hasSearch) {
      setStories([]);
      setStoriesLoading(false);
      return;
    }
    try {
      setStoriesLoading(true);
      const result = await searchStories({ search: debouncedSearch, pageSize: 12 });
      if (cancelled) return;
      setStories(result);
    } catch {
      if (!cancelled) setStories([]);
    } finally {
      if (!cancelled) setStoriesLoading(false);
    }
  }

  loadStories();

  return () => {
    cancelled = true;
  };
}, [hasSearch, debouncedSearch]);

useEffect(() => {
  let cancelled = false;

  async function loadPosts() {
    if (!hasSearch) {
      setPosts([]);
      setPostsLoading(false);
      return;
    }
    try {
      setPostsLoading(true);
      const result = await searchPosts({ search: debouncedSearch, pageSize: 8, viewerId: user?.uid ?? null });
      if (cancelled) return;
      setPosts(result.posts.filter((p) => p.isDeleted !== true));
    } catch {
      if (!cancelled) setPosts([]);
    } finally {
      if (!cancelled) setPostsLoading(false);
    }
  }

  loadPosts();

  return () => {
    cancelled = true;
  };
}, [hasSearch, debouncedSearch, user?.uid]);

// Al cambiar la búsqueda cerramos el visor de historias, para que una nueva
// búsqueda que reencuentre la misma historia no la reabra sola.
useEffect(() => {
  setStoryViewerIndex(null);
}, [debouncedSearch]);

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

// Carga si el usuario ya sigue a cada perfil del preview.
useEffect(() => {
  let cancelled = false;

  async function loadFollowState() {
    if (!user || profiles.length === 0) {
      setFollowMap({});
      return;
    }
    const uids = Array.from(
      new Set(
        profiles
          .slice(0, SEARCH_LIMIT)
          .map((p) => p.uid)
          .filter((id): id is string => !!id && id !== user.uid)
      )
    );
    if (uids.length === 0) {
      setFollowMap({});
      return;
    }
    try {
      const entries = await Promise.all(
        uids.map(async (uid) => {
          const snap = await getDoc(doc(db, "users", user.uid, "following", uid));
          return [uid, snap.exists()] as const;
        })
      );
      if (cancelled) return;
      setFollowMap((prev) => {
        const merged = { ...prev };
        entries.forEach(([id, isF]) => {
          merged[id] = merged[id] || isF;
        });
        return merged;
      });
    } catch (e) {
      console.error(e);
    }
  }

  loadFollowState();

  return () => {
    cancelled = true;
  };
}, [user, profiles]);

async function handleFollow(uid: string | undefined) {
  if (!user || !uid || user.uid === uid) return;
  if (followMap[uid] || followBusy[uid]) return;
  setFollowBusy((p) => ({ ...p, [uid]: true }));
  setFollowMap((p) => ({ ...p, [uid]: true })); // optimista
  try {
    await followUser({ currentUserId: user.uid, targetUserId: uid });
  } catch (e) {
    console.error(e);
    setFollowMap((p) => ({ ...p, [uid]: false })); // revertir
  } finally {
    setFollowBusy((p) => ({ ...p, [uid]: false }));
  }
}

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
        e instanceof Error ? e.message : tGroups("joinError");
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
        e instanceof Error ? e.message : tGroups("requestAccess");
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
        e instanceof Error ? e.message : tCommon("cancel");
      setError(message);
    }
  }

  async function handleLeave(groupId: string, ownerId?: string) {
    if (!user) return;

    if (ownerId && ownerId === user.uid) {
      setError(tGroups("leaveConfirm"));
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
        e instanceof Error ? e.message : tCommon("leave");
      setError(message);
    }
  }

  function handleOpenSubscription(groupId: string) {
    handleNavigateAndClose(`/groups/${groupId}`);
  }

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

    return ordered.slice(0, 5);
  }, [filteredCommunities, user, memberMap, reqMap]);

  const previewProfiles = useMemo(
    () => filteredProfiles.slice(0, 5),
    [filteredProfiles]
  );

  const previewStories = useMemo(() => stories.slice(0, 6), [stories]);
  const previewPosts = useMemo(() => posts.slice(0, 4), [posts]);

  // Snapshot del último contenido con resultados, para congelarlo durante el cierre.
  const lastResultsRef = useRef({
    anyLoading: false,
    hasAnything: false,
    previewStories,
    previewProfiles,
    previewCommunities,
    previewPosts,
  });

function handleCloseSearch() {
  if (isSearchClosing) return;

  // En página completa el cierre lo maneja el overlay (slide-out); avisamos de
  // inmediato sin animar el dropdown ni limpiar (el panel se desmonta al cerrar).
  if (fullPage) {
    onCloseSearch?.();
    return;
  }

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
    setIsFocused(false);
    onCloseSearch?.();
    router.push(href);
  }


// Navega a la página de resultados completa con la query dada, guardándola en el
// historial. Reutilizado por Enter, el "Ver más..." de cada sección y el clic en
// un historial de texto. tabOverride fuerza la pestaña destino (stories, profiles,
// groups, posts); si no se pasa, se infiere de los resultados del preview.
function openSearchFor(
  rawQuery: string,
  tabOverride?: "stories" | "profiles" | "groups" | "posts",
  pinPostId?: string
) {
  const trimmed = rawQuery.trim();
  if (!trimmed) return;

  const entry: SearchHistoryEntry = { kind: "text", query: trimmed, ts: Date.now() };
  setHistory((h) => pushToHistory(h, entry));

  const params = new URLSearchParams();
  params.set("q", rawQuery);

  if (tabOverride) {
    params.set("tab", tabOverride);
  } else if (filteredProfiles.length > 0 && filteredCommunities.length === 0) {
    params.set("tab", "profiles");
  } else {
    params.set("tab", "groups");
  }

  // Post seleccionado desde el preview → se fija primero en los resultados.
  if (pinPostId) params.set("post", pinPostId);

  setSearch("");
  setIsFocused(false);
  onCloseSearch?.();

  router.push(`/search?${params.toString()}`);
}

function handleOpenFullResults() {
  // Usamos el valor EN VIVO (search), no el debounced (normalizedSearch), para
  // que Enter dispare la búsqueda al instante sin esperar los 300 ms del debounce.
  // Enter cae en la pestaña "Experiencias" (stories) por defecto.
  openSearchFor(search, "stories");
}

  const anyLoading =
    authLoading || storiesLoading || profilesLoading || communitiesLoading || postsLoading;
  const hasAnything =
    previewStories.length > 0 ||
    previewProfiles.length > 0 ||
    previewCommunities.length > 0 ||
    previewPosts.length > 0;

  // Congelar el contenido del panel mientras se anima el cierre, para no mostrar
  // un flash de "sin resultados" cuando la búsqueda ya se limpió.
  if (hasSearch) {
    lastResultsRef.current = { anyLoading, hasAnything, previewStories, previewProfiles, previewCommunities, previewPosts };
  }
  const dAnyLoading = resultsClosing ? lastResultsRef.current.anyLoading : anyLoading;
  const dHasAnything = resultsClosing ? lastResultsRef.current.hasAnything : hasAnything;
  const dStories = resultsClosing ? lastResultsRef.current.previewStories : previewStories;
  const dProfiles = resultsClosing ? lastResultsRef.current.previewProfiles : previewProfiles;
  const dCommunities = resultsClosing ? lastResultsRef.current.previewCommunities : previewCommunities;
  const dPosts = resultsClosing ? lastResultsRef.current.previewPosts : previewPosts;

  return (
    <>
      <style jsx>{`
.search-area {
  position: relative;
  z-index: 60;
  width: 100%;
  overflow: visible;
}

/* ── Modo página completa (búsqueda móvil) ───────────────────────────────────
   El input queda arriba y el preview/historial llena la pantalla debajo como
   una lista normal en flujo (sin dropdown flotante ni animación propia). */
.search-area-full {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.search-area-full .search-dropdown {
  position: relative;
  top: auto;
  left: auto;
  right: auto;
  width: 100%;
  max-width: 100%;
  margin: 8px 0 0;
  flex: 1 1 auto;
  min-height: 0;
  max-height: none;
  border-radius: 0;
  box-shadow: none;
  background: transparent;
  transform: none;
  opacity: 1;
  animation: none;
}

.search-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  right: 0;
  width: 600px;
  max-width: 100%;
  margin: 0 auto;
  min-width: 0;
  border: none;
  border-radius: 18px;
  background: #0a0a0a;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08), 0 32px 72px rgba(0, 0, 0, 0.9);
  overflow: hidden;
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

.search-dropdown-closing {
  animation: dropdown-exit 0.2s cubic-bezier(0.4, 0, 1, 1) forwards;
}

@keyframes dropdown-exit {
from {
  opacity: 1;
  transform: translateY(0) scaleY(1);
}

to {
  opacity: 0;
  transform: translateY(-8px) scaleY(0.96);
}
        }

        .search-dropdown-inner {
          flex: 1 1 auto;
          min-height: 0;
          overflow-y: auto;
        }

        .search-dropdown-inner::-webkit-scrollbar {
          width: 7px;
          height: 7px;
        }

        .search-dropdown-inner::-webkit-scrollbar-track {
          background: transparent;
        }

        .search-dropdown-inner::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.18);
          border-radius: 999px;
        }

        .dropdown-section {
          display: grid;
        }

        .dropdown-section + .dropdown-section {
          border-top: none;
        }

        .dropdown-title {
          margin: 0;
          padding: 12px 14px 8px;
          font-size: 13px;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.6);
          text-transform: lowercase;
        }
        .dropdown-title::first-letter {
          text-transform: uppercase;
        }

        .dropdown-section-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .section-more {
          flex-shrink: 0;
          background: none;
          border: none;
          color: #a855ff;
          font-weight: 600;
          font-size: 13px;
          cursor: pointer;
          font-family: inherit;
          padding: 12px 14px 8px;
          white-space: nowrap;
        }

        .dropdown-helper {
          padding: 14px;
          color: rgba(255, 255, 255, 0.76);
          font-size: 13px;
          line-height: 1.4;
        }

        /* Historias — fila horizontal con aro morado de Vibra */
        .story-row {
          display: flex;
          gap: 12px;
          overflow-x: auto;
          padding: 4px 14px 10px;
          scrollbar-width: none;
        }
        .story-row::-webkit-scrollbar { display: none; }

        .story-bubble {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 5px;
          background: none;
          border: none;
          padding: 0;
          cursor: pointer;
          flex-shrink: 0;
          width: 64px;
          font-family: inherit;
          -webkit-tap-highlight-color: transparent;
        }

        .story-ring {
          width: 60px;
          height: 60px;
          border-radius: 50%;
          background: ${VIBRA_STORY_RING};
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 2.4px;
          box-sizing: border-box;
        }

        .story-ring-inner {
          position: relative;
          width: 100%;
          height: 100%;
          border-radius: 50%;
          border: 1.5px solid #0a0a0a;
          overflow: hidden;
          background: #1a1a2e;
          display: flex;
          align-items: center;
          justify-content: center;
          box-sizing: border-box;
        }

        .story-emoji { font-size: 20px; line-height: 1; }

        .story-name {
          max-width: 64px;
          font-size: 11px;
          font-weight: 500;
          color: #fff;
          line-height: 1.3;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        /* Publicaciones — fila compacta */
        .post-row {
          display: flex;
          gap: 10px;
          align-items: center;
          min-width: 0;
          overflow: hidden;
        }

        .post-body {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
          flex: 1;
          overflow: hidden;
        }

        .post-author-row {
          display: flex;
          align-items: baseline;
          gap: 5px;
          min-width: 0;
        }

        .post-author {
          min-width: 0;
          font-size: 12px;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.9);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .post-badge-dot {
          flex-shrink: 0;
          color: rgba(255, 255, 255, 0.42);
          font-size: 11px;
          line-height: 1;
        }

        .post-badge {
          flex-shrink: 0;
          color: rgba(168, 85, 255, 0.85);
          font-size: 11px;
          font-weight: 500;
          white-space: nowrap;
        }

        .post-badge-live {
          color: #ef4444;
        }

        .post-text {
          min-width: 0;
          max-width: 100%;
          font-size: 12.5px;
          color: rgba(255, 255, 255, 0.6);
          line-height: 1.35;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .dropdown-footer {
          flex: 0 0 auto;
          padding: 10px 12px 12px;
          background: #0a0a0a;
        }

        .more-results-btn {
          width: 100%;
          height: 42px;
          border: none;
          border-radius: 5px;
          background: #a855ff;
          color: rgba(255, 255, 255, 0.98);
          cursor: pointer;
          font-weight: 500;
          font-size: 17px;
          letter-spacing: -0.02em;
          font-family: ${fontStack};
          display: grid;
          place-items: center;
        }

        .more-results-btn:hover {
          background: #9333ea;
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
          overflow: hidden;
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

.result-name-experiences {
  flex-shrink: 0;
  color: rgba(168, 85, 255, 0.85);
  font-size: 11px;
  font-weight: 500;
  line-height: 1.2;
  white-space: nowrap;
}

/* @usuario debajo del nombre, alineado a la izquierda, sin contenedor */
.result-handle {
  color: rgba(255, 255, 255, 0.44);
  font-size: 12px;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
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
.result-meta-mobile {
  display: none;
}
  .result-description-preview {
  display: block;
  margin: -1px 0 0;
  max-width: 100%;
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
          width: 134px;
          box-sizing: border-box;
          min-height: 34px;
          padding: 7px 8px;
          border-radius: 10px;
          border: none;
          background: linear-gradient(135deg, #ec4899, #9333ea);
          color: #fff;
          cursor: pointer;
          font-weight: 600;
          font-size: 12px;
          letter-spacing: -0.01em;
          font-family: ${fontStack};
          display: inline-flex;
          align-items: center;
          justify-content: center;
          white-space: nowrap;
        }

        /* Suscribirse (privada de pago) — azul, igual que en las comunidades */
        .subscribe-btn {
          background: #70aefb;
        }

        /* Estado de miembro (Ya perteneces / Suscrito) — accionable:
           salir del grupo o abrir el panel para cancelar la suscripción. */
        .member-state {
          width: 134px;
          box-sizing: border-box;
          min-height: 34px;
          padding: 7px 8px;
          border-radius: 10px;
          border: none;
          background: rgba(255, 255, 255, 0.06);
          color: rgba(255, 255, 255, 0.5);
          cursor: pointer;
          font-weight: 600;
          font-size: 12px;
          letter-spacing: -0.01em;
          font-family: ${fontStack};
          display: inline-flex;
          align-items: center;
          justify-content: center;
          white-space: nowrap;
        }

        .secondary-btn {
          width: 134px;
          box-sizing: border-box;
          min-height: 34px;
          padding: 7px 8px;
          border-radius: 10px;
          border: 1px solid rgba(255, 255, 255, 0.18);
          background: rgba(255, 255, 255, 0.14);
          color: rgba(255, 255, 255, 0.7);
          cursor: pointer;
          font-weight: 600;
          font-size: 12px;
          letter-spacing: -0.01em;
          font-family: ${fontStack};
          display: inline-flex;
          align-items: center;
          justify-content: center;
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

  .result-meta-mobile {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 14px;
    margin-top: 1px;
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

  .mobile-experiences-label {
    color: rgba(168, 85, 255, 0.85);
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
  .disabled-btn,
  .member-state {
    width: 118px;
    min-height: 32px;
    padding: 6px 8px;
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

      <div ref={searchAreaRef} className={`search-area${fullPage ? " search-area-full" : ""}`}>
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
          <h2 className="dropdown-title" style={{ padding: 0 }}>{tCommon("recent")}</h2>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              try { localStorage.removeItem(HISTORY_KEY); } catch {}
              setHistory([]);
            }}
            style={{ background: "none", border: "none", color: "rgba(255,255,255,0.44)", fontSize: "12px", cursor: "pointer", fontFamily: fontStack, padding: "2px 4px", borderRadius: 6 }}
          >
            {tCommon("clear")}
          </button>
        </div>
        {history.map((entry, i) => {
          const removeBtn = (
            <button
              type="button"
              aria-label={tCommon("removeFromHistory")}
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
                onClick={() => openSearchFor(entry.query)}
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
                <Image src={entry.avatarUrl} alt="" width={36} height={36} style={{ borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
              ) : (
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.7)", flexShrink: 0 }}>
                  {initialsFromName(entry.name)}
                </div>
              )}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ color: "rgba(255,255,255,0.9)", fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{entry.name}</div>
                <div style={{ color: "rgba(255,255,255,0.44)", fontSize: 12 }}>
                  {isProfile && entry.handle ? `@${entry.handle}` : tGroups("title")}
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

{resultsRendered && (
  <div
    ref={dropdownRef}
    className={`search-dropdown${(isSearchClosing || resultsClosing) ? " search-dropdown-closing" : ""}`}
  >
            <div className="search-dropdown-inner">
              {dAnyLoading && !dHasAnything && (
                <div className="dropdown-helper">
                  {tCommon("loading")}
                </div>
              )}

              {/* Historias — fila horizontal de avatares con aro morado de Vibra */}
              {dStories.length > 0 && (
                <section className="dropdown-section">
                  <div className="dropdown-section-header">
                    <h2 className="dropdown-title">Historias</h2>
                    <button type="button" className="section-more" onClick={() => openSearchFor(search, "stories")}>
                      Ver más historias
                    </button>
                  </div>
                  <div className="story-row">
                    {dStories.map((story, i) => {
                      const thumb = storyThumb(story);
                      return (
                        <button
                          key={story.id}
                          type="button"
                          className="story-bubble"
                          onClick={() => setStoryViewerIndex(i)}
                        >
                          <span className="story-ring">
                            <span className="story-ring-inner">
                              {thumb ? (
                                <Image src={thumb} alt={story.creatorName ?? ""} fill sizes="60px" style={{ objectFit: "cover" }} />
                              ) : (
                                <span className="story-emoji">{story.type === "consejo" ? "💡" : "👋"}</span>
                              )}
                            </span>
                          </span>
                          <span className="story-name">{story.creatorName ?? ""}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* Perfiles */}
              {dProfiles.length > 0 && (
                <section className="dropdown-section">
                  <div className="dropdown-section-header">
                    <h2 className="dropdown-title">{tCommon("profiles")}</h2>
                    <button type="button" className="section-more" onClick={() => openSearchFor(search, "profiles")}>
                      Ver más perfiles
                    </button>
                  </div>

                  {dProfiles.map((p) => {
                    const fullName =
                      p.displayName?.trim() ||
                      `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() ||
                      p.handle ||
                      tCommon("user");

                    const hasExperiences = offersExperiences(p);
                    const isFollowing = !!p.uid && !!followMap[p.uid];
                    const isSelf = !!user && p.uid === user.uid;

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
                            <LiveRingAvatar
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
                                {hasExperiences && (
                                  <>
                                    <span className="result-name-dot">·</span>
                                    <span className="result-name-experiences">Ofrece experiencias</span>
                                  </>
                                )}
                              </h3>
                              <div className="result-handle">@{p.handle}</div>
                            </div>
                          </div>

                          {!isSelf && (
                            <div className="actions-wrap" onClick={(e) => e.stopPropagation()}>
                              {isFollowing ? (
                                <span className="member-state" style={{ cursor: "default" }}>
                                  Siguiendo
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  className="primary-btn"
                                  disabled={!!followBusy[p.uid]}
                                  onClick={() => void handleFollow(p.uid)}
                                >
                                  Seguir
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </section>
              )}

              {/* Comunidades */}
              {dCommunities.length > 0 && (
                <section className="dropdown-section">
                  <div className="dropdown-section-header">
                    <h2 className="dropdown-title">{tGroups("title")}</h2>
                    <button type="button" className="section-more" onClick={() => openSearchFor(search, "groups")}>
                      Ver más comunidades
                    </button>
                  </div>

                  {dCommunities.map((g) => {
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
    ? tGroups("publicLabel")
    : g.visibility === "private"
      ? tGroups("privateLabel")
      : tGroups("hiddenLabel");
                    const hasExperiences = offersExperiences(g);

                    return (
                      <div
                        key={g.id}
                        className="result-item"
                        onClick={() => {
                          const entry: SearchHistoryEntry = { kind: "entity", entityType: "community", id: g.id, name: g.name ?? tGroups("title"), avatarUrl: g.avatarUrl ?? null, href: `/groups/${g.id}`, ts: Date.now() };
                          setHistory((h) => pushToHistory(h, entry));
                          handleNavigateAndClose(`/groups/${g.id}`);
                        }}
                      >
                        <div className="result-grid">
                          <div className="result-main-mobile">
                            <LiveRingAvatar
                              entityId={g.id}
                              entityType="group"
                              currentUserId={user?.uid ?? null}
                              photoURL={g.avatarUrl ?? null}
                              displayName={g.name ?? tGroups("title")}
                              size={42}
                              onClick={(e) => {
                                e.stopPropagation();
                                const entry: SearchHistoryEntry = { kind: "entity", entityType: "community", id: g.id, name: g.name ?? tGroups("title"), avatarUrl: g.avatarUrl ?? null, href: `/groups/${g.id}`, ts: Date.now() };
                                setHistory((h) => pushToHistory(h, entry));
                                handleNavigateAndClose(`/groups/${g.id}`);
                              }}
                            />

                            <div className="result-content">
<h3 className="result-name result-name-with-meta">
  <span className="result-name-text">
    {g.name ?? tGroups("title")}
  </span>
  {/* Desktop: · Pública/Privada · Ofrece experiencias en la línea del nombre */}
  <span className="result-name-dot visibility-desktop">·</span>
  <span className="result-name-visibility visibility-desktop">{visLabel}</span>
  {hasExperiences && (
    <>
      <span className="result-name-dot visibility-desktop">·</span>
      <span className="result-name-experiences visibility-desktop">Ofrece experiencias</span>
    </>
  )}
</h3>

{/* Desktop: descripción en una sola línea con puntos suspensivos */}
{getDescriptionPreview(g.description) ? (
  <p className="result-description-preview">
    {getDescriptionPreview(g.description)}
  </p>
) : null}

{/* Móvil: Pública/Privada · Ofrece experiencias debajo del nombre */}
<div className="result-meta-mobile">
  <span className="mobile-visibility-label">{visLabel}</span>
  {hasExperiences && (
    <>
      <span className="mobile-service-separator">·</span>
      <span className="mobile-experiences-label">Ofrece experiencias</span>
    </>
  )}
</div>

<div className="result-meta">

                                {!isOwner && isBlocked && (
                                  <span className="meta-inline meta-danger">
                                    ({membershipStatusKey(membershipStatus) ? tGroups(membershipStatusKey(membershipStatus)) : ""})
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
                                {tGroups("join")}
                              </button>
                            )}

                            {!isOwner && !isMember && !isBlocked && paidPrivate && (
<button
  onClick={() => handleOpenSubscription(g.id)}
  className="primary-btn subscribe-btn"
  type="button"
>
  💎 {tGroups("subscribe")}
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
                                      className="primary-btn"
                                      type="button"
                                    >
                                      {tGroups("requestAccess")}
                                    </button>
                                  ) : (
<button
  onClick={() => void handleCancelRequest(g.id)}
  className="secondary-btn"
  type="button"
>
  {tCommon("cancel")}
</button>
                                  )}
                                </>
                              )}

                            {isMember && !isOwner && (
                              membershipStatus === "subscribed" ? (
                                <button
                                  type="button"
                                  className="member-state"
                                  onClick={() => handleOpenSubscription(g.id)}
                                >
                                  Suscrito
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="member-state"
                                  onClick={() => void handleLeave(g.id, g.ownerId)}
                                >
                                  Ya perteneces
                                </button>
                              )
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </section>
              )}

              {/* Publicaciones */}
              {dPosts.length > 0 && (
                <section className="dropdown-section">
                  <div className="dropdown-section-header">
                    <h2 className="dropdown-title">Publicaciones</h2>
                    <button type="button" className="section-more" onClick={() => openSearchFor(search, "posts")}>
                      Ver más publicaciones
                    </button>
                  </div>

                  {dPosts.map((post) => {
                    const badge = postBadge(post);
                    const authorName = post.authorName ?? post.authorUsername ?? tCommon("user");
                    return (
                      <div
                        key={post.id}
                        className="result-item"
                        onClick={() => openSearchFor(search, "posts", post.id)}
                      >
                        <div className="post-row">
                          <LiveRingAvatar
                            entityId={post.authorId}
                            entityType="profile"
                            currentUserId={user?.uid ?? null}
                            photoURL={post.authorAvatarUrl ?? null}
                            displayName={authorName}
                            size={42}
                            onClick={(e) => {
                              e.stopPropagation();
                              openSearchFor(search, "posts", post.id);
                            }}
                          />
                          <span className="post-body">
                            <span className="post-author-row">
                              <span className="post-author">{authorName}</span>
                              {badge && (
                                <>
                                  <span className="post-badge-dot">·</span>
                                  <span className={`post-badge${badge.live ? " post-badge-live" : ""}`}>
                                    {badge.label}{badge.ticket ? " 🎫" : ""}
                                  </span>
                                </>
                              )}
                            </span>
                            <span className="post-text">{post.text}</span>
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </section>
              )}
            </div>

          </div>
        )}

        {storyViewerIndex !== null && previewStories[storyViewerIndex] && (
          <StoryViewer
            stories={previewStories}
            initialIndex={storyViewerIndex}
            onClose={() => setStoryViewerIndex(null)}
          />
        )}

        <VibraToast toast={searchToast} />
      </div>
    </>
  );
}