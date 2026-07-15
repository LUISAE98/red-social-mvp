"use client";

import dynamic from "next/dynamic";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { useTranslations } from "next-intl";

import { db } from "@/lib/firebase";
import { searchGroups } from "@/lib/groups/searchGroups";
import { searchProfiles } from "@/lib/profile/searchProfiles";
import { useAuth } from "@/app/providers";

import SearchSubnav from "@/app/components/SearchToolbar/SearchSubnav";
import SearchGroupsResults from "@/app/components/SearchToolbar/SearchGroupsResults";
import SearchProfilesResults from "@/app/components/SearchToolbar/SearchProfilesResults";
import SearchStoriesResults, {
  type StorySearchFilter,
} from "@/app/components/SearchToolbar/SearchStoriesResults";
import { WalletFilterMenu } from "@/app/(protected)/wallet/components/WalletUi";
import { VibraNavigationIcon } from "@/app/components/VibraServiceIcons/VibraNavigationIcons";

import type {
  CanonicalMemberStatus,
  Community,
  PublicUser,
} from "@/app/components/SearchToolbar/GroupsSearchPanel";

type TabType = "groups" | "profiles" | "posts" | "stories";

type ViewerGroupStateCacheEntry = {
  expiresAt: number;
  memberMap: Record<string, CanonicalMemberStatus>;
  reqMap: Record<string, boolean>;
};

type ViewerGroupStateEntry = {
  groupId: string;
  memberStatus: CanonicalMemberStatus;
  pending: boolean;
};

const SearchPostsResults = dynamic(
  () => import("@/app/components/SearchToolbar/SearchPostsResults"),
  {
    ssr: false,
    loading: () => null,
  }
);

const MIN_SEARCH_LENGTH = 2;
const SEARCH_LIMIT = 20;
const SEARCH_DEBOUNCE_MS = 350;
const VIEWER_GROUP_STATE_TTL_MS = 60_000;

const viewerGroupStateCache = new Map<string, ViewerGroupStateCacheEntry>();

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

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

function getGroupVisibility(group: Community): string | null {
  const visibility = (group as { visibility?: unknown }).visibility;

  return typeof visibility === "string" ? visibility : null;
}

function getViewerGroupStateCacheKey(userId: string, groups: Community[]) {
  return `${userId}:${groups.map((group) => group.id).sort().join("|")}`;
}

function readViewerGroupStateCache(cacheKey: string) {
  const cached = viewerGroupStateCache.get(cacheKey);

  if (!cached || cached.expiresAt <= Date.now()) {
    viewerGroupStateCache.delete(cacheKey);
    return null;
  }

  return cached;
}

function writeViewerGroupStateCache(
  cacheKey: string,
  memberMap: Record<string, CanonicalMemberStatus>,
  reqMap: Record<string, boolean>
) {
  viewerGroupStateCache.set(cacheKey, {
    expiresAt: Date.now() + VIEWER_GROUP_STATE_TTL_MS,
    memberMap,
    reqMap,
  });
}

function patchViewerGroupStateCache(
  userId: string,
  groupId: string,
  memberStatus: CanonicalMemberStatus,
  pending: boolean
) {
  for (const [cacheKey, cached] of viewerGroupStateCache.entries()) {
    if (!cacheKey.startsWith(`${userId}:`)) continue;
    if (!(groupId in cached.memberMap) && !(groupId in cached.reqMap)) continue;

    viewerGroupStateCache.set(cacheKey, {
      ...cached,
      memberMap: {
        ...cached.memberMap,
        [groupId]: memberStatus,
      },
      reqMap: {
        ...cached.reqMap,
        [groupId]: pending,
      },
    });
  }
}

async function readViewerGroupState(
  userId: string,
  group: Community
): Promise<ViewerGroupStateEntry> {
  const groupId = group.id;
  const isOwner = (group as { ownerId?: unknown }).ownerId === userId;
  const visibility = getGroupVisibility(group);

  if (isOwner) {
    return {
      groupId,
      memberStatus: "active",
      pending: false,
    };
  }

  let memberStatus: CanonicalMemberStatus = null;

  try {
    const userMembershipSnap = await getDoc(
      doc(db, "users", userId, "groupMemberships", groupId)
    );

    if (userMembershipSnap.exists()) {
      memberStatus = normalizeMemberStatus(
        (userMembershipSnap.data() as Record<string, unknown>)?.status ?? "active"
      );
    }
  } catch {
    memberStatus = null;
  }

  if (!memberStatus) {
    try {
      const groupMemberSnap = await getDoc(doc(db, "groups", groupId, "members", userId));

      if (groupMemberSnap.exists()) {
        memberStatus = normalizeMemberStatus(
          (groupMemberSnap.data() as Record<string, unknown>)?.status ?? "active"
        );
      }
    } catch {
      memberStatus = null;
    }
  }

  if (memberStatus) {
    return {
      groupId,
      memberStatus,
      pending: false,
    };
  }

  if (visibility !== "private") {
    return {
      groupId,
      memberStatus: null,
      pending: false,
    };
  }

  try {
    const requestSnap = await getDoc(doc(db, "groups", groupId, "joinRequests", userId));
    const requestData = requestSnap.data() as Record<string, unknown> | undefined;

    return {
      groupId,
      memberStatus: null,
      pending: requestSnap.exists() && (requestData?.status ?? "pending") === "pending",
    };
  } catch {
    return {
      groupId,
      memberStatus: null,
      pending: false,
    };
  }
}

function SearchPageContent() {
  const tGroups = useTranslations("groups");
  const tNav = useTranslations("nav");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();

  const queryText = searchParams.get("q") ?? "";
  const urlTab = searchParams.get("tab") as TabType | null;
  // Post seleccionado desde el preview → se muestra primero en los resultados.
  const pinnedPostId = searchParams.get("post");

  const [activeTab, setActiveTab] = useState<TabType>(
    urlTab === "profiles" || urlTab === "posts" || urlTab === "stories"
      ? urlTab
      : "groups"
  );

  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [communities, setCommunities] = useState<Community[]>([]);
  const [profiles, setProfiles] = useState<PublicUser[]>([]);
  const [memberMap, setMemberMap] = useState<Record<string, CanonicalMemberStatus>>({});
  const [reqMap, setReqMap] = useState<Record<string, boolean>>({});
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [storyFilter, setStoryFilter] = useState<StorySearchFilter>("all");
  // Buscador editable en la cabecera de resultados (compartido por las 4 pestañas).
  const [queryInput, setQueryInput] = useState(queryText);

  const storyFilterOptions: Array<{ value: StorySearchFilter; label: string }> = [
    { value: "all", label: tNav("searchStoriesAll") },
    { value: "saludo", label: tNav("searchStoriesGreetings") },
    { value: "consejo", label: tNav("searchStoriesAdvice") },
  ];
  const storyFilterLabel =
    storyFilterOptions.find((o) => o.value === storyFilter)?.label ??
    storyFilterOptions[0].label;

  const normalizedQuery = useMemo(
    () => normalizeText(debouncedQuery),
    [debouncedQuery]
  );

  const canSearch = normalizedQuery.length >= MIN_SEARCH_LENGTH;

    const handleSearchPullRefresh = useCallback(async () => {
    if (user?.uid) {
      for (const cacheKey of viewerGroupStateCache.keys()) {
        if (cacheKey.startsWith(`${user.uid}:`)) {
          viewerGroupStateCache.delete(cacheKey);
        }
      }
    }

    setRefreshNonce((prev) => prev + 1);
  }, [user?.uid]);

  useEffect(() => {
    if (
      urlTab === "groups" ||
      urlTab === "profiles" ||
      urlTab === "posts" ||
      urlTab === "stories"
    ) {
      setActiveTab(urlTab);
    }
  }, [urlTab]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(queryText);
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [queryText]);

  // El input refleja la búsqueda de la URL cuando cambia desde fuera (navegación, etc.).
  useEffect(() => {
    setQueryInput(queryText);
  }, [queryText]);

  useEffect(() => {
    let cancelled = false;

    async function loadGroups() {
      if (activeTab !== "groups" || !canSearch) {
        setCommunities([]);
        return;
      }

      const result = await searchGroups({
        term: debouncedQuery,
        pageSize: SEARCH_LIMIT,
        visibility: ["public", "private"],
      });

      if (cancelled) return;

      setCommunities(result.groups as Community[]);
    }

    loadGroups().catch((error) => {
      console.error("Search groups error:", error);

      if (!cancelled) {
        setCommunities([]);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeTab, canSearch, debouncedQuery, refreshNonce]);

  useEffect(() => {
    let cancelled = false;

    async function loadProfiles() {
      if (activeTab !== "profiles" || !canSearch) {
        setProfiles([]);
        return;
      }

      const result = await searchProfiles({
        db,
        rawQuery: debouncedQuery,
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
        }))
      );
    }

    loadProfiles().catch((error) => {
      console.error("Search profiles error:", error);

      if (!cancelled) {
        setProfiles([]);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeTab, canSearch, debouncedQuery, user?.uid, refreshNonce]);

  useEffect(() => {
    let cancelled = false;

    async function loadViewerGroupState() {
      if (!user?.uid || communities.length === 0) {
        setMemberMap({});
        setReqMap({});
        return;
      }

      const cacheKey = getViewerGroupStateCacheKey(user.uid, communities);
      const cached = readViewerGroupStateCache(cacheKey);

      if (cached) {
        setMemberMap(cached.memberMap);
        setReqMap(cached.reqMap);
        return;
      }

      const entries = await Promise.all(
        communities.map((group) => readViewerGroupState(user.uid, group))
      );

      if (cancelled) return;

      const nextMemberMap: Record<string, CanonicalMemberStatus> = {};
      const nextReqMap: Record<string, boolean> = {};

      for (const entry of entries) {
        nextMemberMap[entry.groupId] = entry.memberStatus;
        nextReqMap[entry.groupId] = entry.pending;
      }

      writeViewerGroupStateCache(cacheKey, nextMemberMap, nextReqMap);
      setMemberMap(nextMemberMap);
      setReqMap(nextReqMap);
    }

    loadViewerGroupState().catch((error) => {
      console.error("Search viewer group state error:", error);

      if (!cancelled) {
        setMemberMap({});
        setReqMap({});
      }
    });

    return () => {
      cancelled = true;
    };
  }, [user?.uid, communities, refreshNonce]);

  function handleChangeTab(tab: TabType) {
    setActiveTab(tab);

    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);

    router.replace(`/search?${params.toString()}`);
  }

  // Envía la nueva búsqueda a la URL (?q=) → todas las pestañas se actualizan.
  function handleSubmitQuery() {
    const next = queryInput.trim();
    const params = new URLSearchParams(searchParams.toString());
    if (next) {
      params.set("q", next);
    } else {
      params.delete("q");
    }
    // Nueva búsqueda: deja de fijar el post seleccionado desde el preview.
    params.delete("post");
    router.replace(`/search?${params.toString()}`);
  }

  function handleNavigate(href: string) {
    router.push(href);
  }

  async function handleJoinPublic(groupId: string) {
    if (!user?.uid) return;

    const { joinGroup } = await import("@/lib/groups/membership");
    await joinGroup(groupId, user.uid);

    setMemberMap((prev) => ({ ...prev, [groupId]: "active" }));
    setReqMap((prev) => ({ ...prev, [groupId]: false }));
    patchViewerGroupStateCache(user.uid, groupId, "active", false);
  }

  async function handleRequestPrivate(groupId: string) {
    if (!user?.uid) return;

    const { requestToJoin } = await import("@/lib/groups/joinRequests");
    await requestToJoin(groupId, user.uid);

    setReqMap((prev) => ({ ...prev, [groupId]: true }));
    patchViewerGroupStateCache(user.uid, groupId, null, true);
  }

  async function handleCancelRequest(groupId: string) {
    if (!user?.uid) return;

    const { cancelJoinRequest } = await import("@/lib/groups/joinRequests");
    await cancelJoinRequest(groupId, user.uid);

    setReqMap((prev) => ({ ...prev, [groupId]: false }));
    patchViewerGroupStateCache(user.uid, groupId, memberMap[groupId] ?? null, false);
  }

  async function handleLeave(groupId: string, ownerId?: string) {
    if (!user?.uid) return;
    if (ownerId && ownerId === user.uid) return;

    const { leaveGroup } = await import("@/lib/groups/membership");
    await leaveGroup(groupId, user.uid);

    setMemberMap((prev) => ({ ...prev, [groupId]: null }));
    setReqMap((prev) => ({ ...prev, [groupId]: false }));
    patchViewerGroupStateCache(user.uid, groupId, null, false);
  }

  return (
    <main className="search-page" aria-label={tGroups("searchResultsTitle")}>
      <SearchSubnav activeTab={activeTab} onChangeTab={handleChangeTab} />

      <section className="search-content">
        <div className="search-query">
          <span className="search-query-text">{tGroups("searchResultsFor")}</span>

          <form
            className="search-query-field"
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmitQuery();
            }}
          >
            <input
              className="search-query-input"
              type="text"
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              placeholder={tCommon("searchPlaceholder")}
              aria-label={tCommon("searchPlaceholder")}
              enterKeyHint="search"
            />
            <button
              type="submit"
              className="search-query-lupa"
              aria-label={tCommon("searchPlaceholder")}
            >
              <VibraNavigationIcon type="search" size={20} strokeWidth={2.2} />
            </button>
          </form>

          {activeTab === "stories" && (
            <WalletFilterMenu
              label={storyFilterLabel}
              menuLabel="Tipo"
              value={[storyFilter]}
              options={storyFilterOptions}
              onChange={(v) => setStoryFilter(v[0] ?? "all")}
              allValue="all"
              singleSelect
            />
          )}
        </div>

        {activeTab === "groups" && (
<SearchGroupsResults
  fontStack="inherit"
  currentUser={user}
  communities={communities}
  memberMap={memberMap}
  reqMap={reqMap}
  onNavigate={handleNavigate}
  onJoinPublic={handleJoinPublic}
  onRequestPrivate={handleRequestPrivate}
  onCancelRequest={handleCancelRequest}
  onLeave={handleLeave}
  onRefresh={handleSearchPullRefresh}
/>
        )}

        {activeTab === "profiles" && (
          <SearchProfilesResults
            fontStack="inherit"
            profiles={profiles}
            onNavigate={handleNavigate}
            currentUserId={user?.uid ?? null}
          />
        )}

        {activeTab === "posts" && (
          <SearchPostsResults
            fontStack="inherit"
            search={debouncedQuery}
            currentUser={user}
            onNavigate={handleNavigate}
            pinnedPostId={pinnedPostId}
          />
        )}

        {activeTab === "stories" && (
          <SearchStoriesResults search={debouncedQuery} filter={storyFilter} />
        )}
      </section>

      <style jsx>{`
.search-page {
  position: relative;
  z-index: 2;
  width: 100%;
  min-height: 100%;
  color: #fff;
  display: grid;
  justify-items: center;
  align-content: start;
  padding: 0 0 96px;
  box-sizing: border-box;
  margin-top: 0;
}

.search-content {
  position: relative;
  z-index: 3;
  width: min(100%, 1040px);
  display: grid;
  gap: 8px;
  padding: 0 16px;
  box-sizing: border-box;
  margin-top: 0;
}

.search-query {
  color: rgba(255, 255, 255, 0.62);
  font-size: 13px;
  line-height: 1.35;
  padding: 0 2px;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
}

.search-query-text {
  flex-shrink: 0;
  white-space: nowrap;
}

/* Buscador editable — estilo de campo Vibra (vibra_style.md). Ocupa el espacio
   entre "Resultados para:" y el botón de filtro, con la lupa dentro al final. */
.search-query-field {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  padding: 8px 10px 8px 12px;
  box-sizing: border-box;
}

.search-query-input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  color: #fff;
  font-size: 13px;
  font-family: inherit;
  line-height: 1.5;
}

.search-query-input::placeholder {
  color: rgba(255, 255, 255, 0.4);
}

.search-query-lupa {
  flex-shrink: 0;
  border: none;
  background: none;
  padding: 0;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.82);
  display: grid;
  place-items: center;
}

@media (max-width: 768px) {
  .search-content {
    width: 100%;
    padding: 0 10px;
    gap: 12px;
  }
}
      `}</style>
    </main>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={null}>
      <SearchPageContent />
    </Suspense>
  );
}
