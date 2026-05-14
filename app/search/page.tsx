"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";

import { db } from "@/lib/firebase";
import { searchGroups } from "@/lib/groups/searchGroups";
import { searchProfiles } from "@/lib/profile/searchProfiles";
import { useAuth } from "@/app/providers";

import SearchSubnav from "@/app/components/SearchToolbar/SearchSubnav";
import SearchGroupsResults from "@/app/components/SearchToolbar/SearchGroupsResults";
import SearchProfilesResults from "@/app/components/SearchToolbar/SearchProfilesResults";
import SearchPostsResults from "@/app/components/SearchToolbar/SearchPostsResults";

import type {
  CanonicalMemberStatus,
  Community,
  PublicUser,
} from "@/app/components/SearchToolbar/GroupsSearchPanel";

type TabType = "groups" | "profiles" | "posts";

const MIN_SEARCH_LENGTH = 2;
const SEARCH_LIMIT = 30;
const SEARCH_DEBOUNCE_MS = 350;

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
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

function SearchPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();

  const queryText = searchParams.get("q") ?? "";
  const urlTab = searchParams.get("tab") as TabType | null;

  const [activeTab, setActiveTab] = useState<TabType>(
    urlTab === "profiles" || urlTab === "posts" ? urlTab : "groups"
  );

  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [communities, setCommunities] = useState<Community[]>([]);
  const [profiles, setProfiles] = useState<PublicUser[]>([]);
  const [memberMap, setMemberMap] = useState<Record<string, CanonicalMemberStatus>>({});
  const [reqMap, setReqMap] = useState<Record<string, boolean>>({});

  const normalizedQuery = useMemo(
    () => normalizeText(debouncedQuery),
    [debouncedQuery]
  );

  const canSearch = normalizedQuery.length >= MIN_SEARCH_LENGTH;

  useEffect(() => {
    if (urlTab === "groups" || urlTab === "profiles" || urlTab === "posts") {
      setActiveTab(urlTab);
    }
  }, [urlTab]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(queryText);
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
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
}, [activeTab, canSearch, debouncedQuery, user?.uid]);

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
}, [activeTab, canSearch, debouncedQuery, user?.uid]);

  useEffect(() => {
    let cancelled = false;

    async function loadViewerGroupState() {
      if (!user?.uid || communities.length === 0) {
        setMemberMap({});
        setReqMap({});
        return;
      }

      const entries = await Promise.all(
        communities.map(async (group) => {
          const memberRef = doc(db, "groups", group.id, "members", user.uid);
          const requestRef = doc(db, "groups", group.id, "joinRequests", user.uid);

          const [memberSnap, requestSnap] = await Promise.all([
            getDoc(memberRef),
            getDoc(requestRef),
          ]);

          const memberStatus = memberSnap.exists()
            ? normalizeMemberStatus(
                (memberSnap.data() as Record<string, unknown>)?.status ?? "active"
              )
            : null;

          const requestData = requestSnap.data() as Record<string, unknown> | undefined;
          const pending =
            requestSnap.exists() && (requestData?.status ?? "pending") === "pending";

          return {
            groupId: group.id,
            memberStatus,
            pending,
          };
        })
      );

      if (cancelled) return;

      const nextMemberMap: Record<string, CanonicalMemberStatus> = {};
      const nextReqMap: Record<string, boolean> = {};

      for (const entry of entries) {
        nextMemberMap[entry.groupId] = entry.memberStatus;
        nextReqMap[entry.groupId] = entry.pending;
      }

      setMemberMap(nextMemberMap);
      setReqMap(nextReqMap);
    }

    loadViewerGroupState().catch(() => {
      if (!cancelled) {
        setMemberMap({});
        setReqMap({});
      }
    });

    return () => {
      cancelled = true;
    };
  }, [user?.uid, communities]);

  function handleChangeTab(tab: TabType) {
    setActiveTab(tab);

    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);

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
  }

  async function handleRequestPrivate(groupId: string) {
    if (!user?.uid) return;

    const { requestToJoin } = await import("@/lib/groups/joinRequests");
    await requestToJoin(groupId, user.uid);

    setReqMap((prev) => ({ ...prev, [groupId]: true }));
  }

  async function handleCancelRequest(groupId: string) {
    if (!user?.uid) return;

    const { cancelJoinRequest } = await import("@/lib/groups/joinRequests");
    await cancelJoinRequest(groupId, user.uid);

    setReqMap((prev) => ({ ...prev, [groupId]: false }));
  }

  async function handleLeave(groupId: string, ownerId?: string) {
    if (!user?.uid) return;
    if (ownerId && ownerId === user.uid) return;

    const { leaveGroup } = await import("@/lib/groups/membership");
    await leaveGroup(groupId, user.uid);

    setMemberMap((prev) => ({ ...prev, [groupId]: null }));
    setReqMap((prev) => ({ ...prev, [groupId]: false }));
  }

  return (
    <main className="search-page" aria-label="Resultados de búsqueda">
      <SearchSubnav activeTab={activeTab} onChangeTab={handleChangeTab} />

      <section className="search-content">
        <div className="search-query">
          Resultados para: <strong>{queryText.trim() || "—"}</strong>
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
          />
        )}

        {activeTab === "profiles" && (
          <SearchProfilesResults
            fontStack="inherit"
            profiles={profiles}
            onNavigate={handleNavigate}
          />
        )}

        {activeTab === "posts" && (
          <SearchPostsResults
            fontStack="inherit"
            search={debouncedQuery}
            currentUser={user}
            onNavigate={handleNavigate}
          />
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
        }

        .search-content {
          position: relative;
          z-index: 3;
          width: min(100%, 1040px);
          display: grid;
          gap: 14px;
          padding: 0 16px;
          box-sizing: border-box;
        }

        .search-query {
          color: rgba(255, 255, 255, 0.62);
          font-size: 13px;
          line-height: 1.35;
          padding: 0 2px;
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