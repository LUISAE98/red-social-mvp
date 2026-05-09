"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  type Unsubscribe,
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

  const [communities, setCommunities] = useState<Community[]>([]);
  const [profiles, setProfiles] = useState<PublicUser[]>([]);
  const [memberMap, setMemberMap] = useState<Record<string, CanonicalMemberStatus>>({});
  const [reqMap, setReqMap] = useState<Record<string, boolean>>({});

  const normalizedQuery = useMemo(() => normalizeText(queryText), [queryText]);

  useEffect(() => {
    if (urlTab === "groups" || urlTab === "profiles" || urlTab === "posts") {
      setActiveTab(urlTab);
    }
  }, [urlTab]);

  useEffect(() => {
    const col = collection(db, "groups");
    const unsubscribers: Unsubscribe[] = [];
    const groupsById = new Map<string, Community>();

    function sync() {
      setCommunities(Array.from(groupsById.values()));
    }

    const unsubPublic = onSnapshot(query(col, where("visibility", "==", "public")), (snap) => {
      snap.docs.forEach((d) => {
        groupsById.set(d.id, { id: d.id, ...(d.data() as Record<string, unknown>) });
      });
      sync();
    });

    unsubscribers.push(unsubPublic);

    if (user?.uid) {
      const unsubPrivate = onSnapshot(query(col, where("visibility", "==", "private")), (snap) => {
        snap.docs.forEach((d) => {
          groupsById.set(d.id, { id: d.id, ...(d.data() as Record<string, unknown>) });
        });
        sync();
      });

      unsubscribers.push(unsubPrivate);
    }

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [user?.uid]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "users"), (snap) => {
      const rows: PublicUser[] = snap.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;

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
      });

      setProfiles(rows);
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user?.uid || communities.length === 0) {
      setMemberMap({});
      setReqMap({});
      return;
    }

    const unsubscribers: Unsubscribe[] = [];

    for (const group of communities) {
      const memberRef = doc(db, "groups", group.id, "members", user.uid);
      const requestRef = doc(db, "groups", group.id, "joinRequests", user.uid);

      const unsubMember = onSnapshot(memberRef, (snapshot) => {
        const status = snapshot.exists()
          ? normalizeMemberStatus(
              (snapshot.data() as Record<string, unknown>)?.status ?? "active"
            )
          : null;

        setMemberMap((prev) => ({ ...prev, [group.id]: status }));
      });

      const unsubRequest = onSnapshot(requestRef, (snapshot) => {
        const data = snapshot.data() as Record<string, unknown> | undefined;
        const pending = snapshot.exists() && (data?.status ?? "pending") === "pending";

        setReqMap((prev) => ({ ...prev, [group.id]: pending }));
      });

      unsubscribers.push(unsubMember, unsubRequest);
    }

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [user?.uid, communities]);

  const filteredCommunities = useMemo(() => {
    if (!normalizedQuery) return [];

    return communities
      .filter((group) => {
        if (group.visibility === "hidden") return false;
        if (group.isActive === false) return false;
        if (group.discoverable === false) return false;

        return normalizeText(buildCommunitySearchText(group)).includes(normalizedQuery);
      })
      .map((group) => ({
        ...group,
        searchMatchType: "exact" as const,
        searchScore: 1000,
      }));
  }, [communities, normalizedQuery]);

  const filteredProfiles = useMemo(() => {
    if (!normalizedQuery) return [];

    return profiles.filter((profile) => {
      if (!profile.handle) return false;
      if (user?.uid && profile.uid === user.uid) return false;

      return normalizeText(buildUserSearchText(profile)).includes(normalizedQuery);
    });
  }, [profiles, normalizedQuery, user?.uid]);

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
            communities={filteredCommunities}
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
            profiles={filteredProfiles}
            onNavigate={handleNavigate}
          />
        )}

        {activeTab === "posts" && (
          <SearchPostsResults
            fontStack="inherit"
            search={queryText}
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