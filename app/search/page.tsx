"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";

import { db } from "@/lib/firebase";
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

function buildCommunitySearchText(group: Community) {
  return [group.name ?? "", group.description ?? "", group.visibility ?? ""]
    .join(" ")
    .toLowerCase();
}

function buildUserSearchText(user: PublicUser) {
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

  const normalizedQuery = useMemo(() => normalizeText(debouncedQuery), [debouncedQuery]);
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
      if (!canSearch) {
        setCommunities([]);
        return;
      }

      const groupsRef = collection(db, "groups");
      const queriesToRun = [
        query(groupsRef, where("visibility", "==", "public"), limit(SEARCH_LIMIT)),
      ];

      if (user?.uid) {
        queriesToRun.push(
          query(groupsRef, where("visibility", "==", "private"), limit(SEARCH_LIMIT))
        );
      }

      const snapshots = await Promise.all(queriesToRun.map((q) => getDocs(q)));
      if (cancelled) return;

      const groupsById = new Map<string, Community>();

      for (const snap of snapshots) {
        for (const d of snap.docs) {
          const group = {
            id: d.id,
            ...(d.data() as Record<string, unknown>),
          } as Community;

          if (group.visibility === "hidden") continue;
          if (group.isActive === false) continue;
          if (group.discoverable === false) continue;

          if (normalizeText(buildCommunitySearchText(group)).includes(normalizedQuery)) {
            groupsById.set(group.id, {
              ...group,
              searchMatchType: "exact",
              searchScore: 1000,
            });
          }
        }
      }

      setCommunities(Array.from(groupsById.values()).slice(0, SEARCH_LIMIT));
    }

    loadGroups().catch(() => {
      if (!cancelled) setCommunities([]);
    });

    return () => {
      cancelled = true;
    };
  }, [canSearch, normalizedQuery, user?.uid]);

   useEffect(() => {
    let cancelled = false;

    function mapUserDoc(d: { id: string; data: () => Record<string, unknown> }): PublicUser {
      const data = d.data();

      return {
        uid: typeof data.uid === "string" ? data.uid : d.id,
        handle: typeof data.handle === "string" ? data.handle : "",
        displayName: typeof data.displayName === "string" ? data.displayName : "",
        firstName: typeof data.firstName === "string" ? data.firstName : "",
        lastName: typeof data.lastName === "string" ? data.lastName : "",
        photoURL: typeof data.photoURL === "string" ? data.photoURL : null,
        offerings:
          Array.isArray(data.offerings) ||
          (typeof data.offerings === "object" && data.offerings !== null)
            ? (data.offerings as Array<Record<string, any>> | Record<string, any>)
            : undefined,
        donation:
          typeof data.donation === "object" && data.donation !== null
            ? (data.donation as Record<string, any>)
            : undefined,
        monetization:
          typeof data.monetization === "object" && data.monetization !== null
            ? (data.monetization as Record<string, any>)
            : undefined,
      };
    }

    async function loadProfiles() {
      if (!canSearch) {
        setProfiles([]);
        return;
      }

      const rawQuery = debouncedQuery.trim();
      const lowerQuery = normalizeText(rawQuery);
      const usersRef = collection(db, "users");

      const usersById = new Map<string, PublicUser>();

      const handleSnap = await getDoc(doc(db, "handles", lowerQuery));

      if (handleSnap.exists()) {
        const handleData = handleSnap.data() as Record<string, unknown>;
        const uid = typeof handleData.uid === "string" ? handleData.uid : null;

        if (uid) {
          const userSnap = await getDoc(doc(db, "users", uid));

          if (userSnap.exists()) {
            const profile = mapUserDoc({
              id: userSnap.id,
              data: () => userSnap.data() as Record<string, unknown>,
            });

            if (profile.handle && (!user?.uid || profile.uid !== user.uid)) {
              usersById.set(profile.uid, profile);
            }
          }
        }
      }

      const queryResults = await Promise.allSettled([
        getDocs(
          query(
            usersRef,
            orderBy("handle"),
            where("handle", ">=", lowerQuery),
            where("handle", "<=", `${lowerQuery}\uf8ff`),
            limit(SEARCH_LIMIT)
          )
        ),
        getDocs(
          query(
            usersRef,
            orderBy("displayName"),
            limit(100)
          )
        ),
      ]);

      if (cancelled) return;

      for (const result of queryResults) {
        if (result.status !== "fulfilled") continue;

        for (const d of result.value.docs) {
          const profile = mapUserDoc(d);

          if (!profile.handle) continue;
          if (user?.uid && profile.uid === user.uid) continue;

          const searchable = normalizeText(buildUserSearchText(profile));
          if (!searchable.includes(lowerQuery)) continue;

          usersById.set(profile.uid, profile);
        }
      }

      setProfiles(Array.from(usersById.values()).slice(0, SEARCH_LIMIT));
    }

    loadProfiles().catch((error) => {
      console.error("Search profiles error:", error);
      if (!cancelled) setProfiles([]);
    });

    return () => {
      cancelled = true;
    };
  }, [canSearch, debouncedQuery, user?.uid]);

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