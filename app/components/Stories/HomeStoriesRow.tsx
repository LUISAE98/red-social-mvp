"use client";

import Image from "next/image";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  collection,
  documentId,
  getDocs,
  limit,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  fetchStoriesFromCreatorIds,
  recordStoryView,
  subscribeToStoriesFromCreators,
  subscribeToStoriesFromGroups,
  subscribeToViewedStories,
} from "@/lib/stories/storyService";
import { fetchRecommendedProfilesForUser } from "@/app/components/GroupRecommendations/recommendation-engine";
import type { StoryDoc } from "@/lib/stories/types";
import StoryViewer from "./StoryViewer";
import HomeStoryCarouselDesktop, { type CarouselGroup } from "./HomeStoryCarouselDesktop";
import LiveRingAvatar from "@/app/components/LiveRing/LiveRingAvatar";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

const VIBRA_GRADIENT = "linear-gradient(135deg, #ec4899 0%, #9333ea 52%, #3b82f6 100%)";
const SEEN_COLOR = "rgba(255,255,255,0.28)";

type DisplayInfo = {
  displayName: string | null;
  photoURL: string | null;
};

type StoryGroup = {
  key: string;
  source: "profile" | "group";
  stories: StoryDoc[];    // viewed (24h) first, then unviewed — viewer order
  startIndex: number;     // index of first unviewed story
  hasUnviewed: boolean;
  thumbnailUrl: string | null; // thumbnail of latest unviewed (or latest viewed)
  info: DisplayInfo;
};

type Props = {
  currentUserId: string;
};

const fontStack =
  'inherit';

export default function HomeStoriesRow({ currentUserId }: Props) {
  const [creatorIds, setCreatorIds] = useState<string[]>([]);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  // entityId → livePostId, real-time
  const [profileLives, setProfileLives] = useState<Map<string, string>>(new Map());
  const [groupLives, setGroupLives] = useState<Map<string, string>>(new Map());
  const [profileStories, setProfileStories] = useState<StoryDoc[]>([]);
  const [groupStories, setGroupStories] = useState<StoryDoc[]>([]);
  const [recommendedStories, setRecommendedStories] = useState<StoryDoc[]>([]);
  const [viewedMap, setViewedMap] = useState<Map<string, number>>(new Map());
  const [displayInfoMap, setDisplayInfoMap] = useState<Map<string, DisplayInfo>>(new Map());
  const [activeGroup, setActiveGroup] = useState<StoryGroup | null>(null);
  const [mobileSourceRect, setMobileSourceRect] = useState<DOMRect | null>(null);
  // Desktop-only carousel: snapshot of groups at click time + initial index
  const [desktopOpen, setDesktopOpen] = useState<{ groups: CarouselGroup[]; initialIdx: number } | null>(null);
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches,
  );

  const fetchedInfoKeys = useRef<Set<string>>(new Set());
  // Refs so the mobile "group finished" callback always sees the latest data without stale closures
  const storyGroupsRef = useRef<StoryGroup[]>([]);
  const activeGroupRef = useRef<StoryGroup | null>(null);

  // Sync isDesktop with media query changes (e.g. connecting/disconnecting a mouse)
  useEffect(() => {
    const mql = window.matchMedia("(pointer: fine)");
    const h = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener("change", h);
    return () => mql.removeEventListener("change", h);
  }, []);

  // 1. Load followed creator IDs + member group IDs
  useEffect(() => {
    if (!currentUserId) return;
    async function load() {
      try {
        const followingSnap = await getDocs(
          query(collection(db, "users", currentUserId, "following"), limit(29)),
        );
        const ids: string[] = followingSnap.docs.map(
          (d) => (d.data().targetUserId as string) ?? d.id,
        );
        if (!ids.includes(currentUserId)) ids.unshift(currentUserId);
        setCreatorIds(ids);

        const membershipsSnap = await getDocs(
          collection(db, "users", currentUserId, "groupMemberships"),
        );
        const gids: string[] = membershipsSnap.docs
          .filter((d) => {
            const s = d.data().status as string;
            return s === "active" || s === "subscribed";
          })
          .map((d) => d.id)
          .slice(0, 30);
        setGroupIds(gids);
      } catch (err) {
        console.error("[HomeStoriesRow] load", err);
      }
    }
    void load();
  }, [currentUserId]);

  // 2. Subscribe to profile stories
  useEffect(() => {
    if (creatorIds.length === 0) return;
    return subscribeToStoriesFromCreators(creatorIds, setProfileStories);
  }, [creatorIds]);

  // 3. Subscribe to group stories
  useEffect(() => {
    if (groupIds.length === 0) return;
    return subscribeToStoriesFromGroups(groupIds, setGroupStories);
  }, [groupIds]);

  // 4. Subscribe to viewed story map (storyId → viewedAt ms)
  useEffect(() => {
    if (!currentUserId) return;
    return subscribeToViewedStories(currentUserId, setViewedMap);
  }, [currentUserId]);

  // 4b. One-shot fetch of recommended creator stories (refreshes on every mount / page navigation)
  useEffect(() => {
    if (!currentUserId) return;
    let cancelled = false;
    async function load() {
      try {
        const profiles = await fetchRecommendedProfilesForUser(currentUserId, { skipMarkShown: true });
        if (cancelled || profiles.length === 0) return;
        const uids = profiles.map((p) => p.uid);
        const cutoff = Date.now() - TWENTY_FOUR_HOURS_MS;
        const stories = await fetchStoriesFromCreatorIds(uids, cutoff);
        if (!cancelled) setRecommendedStories(stories);
      } catch (err) {
        console.error("[HomeStoriesRow] loadRecommended", err);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [currentUserId]);

  // 5a. Subscribe to live status of followed profiles (real-time)
  useEffect(() => {
    const others = creatorIds.filter((id) => id !== currentUserId);
    if (others.length === 0) { setProfileLives(new Map()); return; }
    const localMap = new Map<string, string>();
    const batches = chunk(others, 30);
    const unsubs = batches.map((batch) => {
      const q = query(collection(db, "users"), where(documentId(), "in", batch));
      return onSnapshot(q, (snap) => {
        for (const d of snap.docs) {
          const lid = d.data().activeLivePostId as string | undefined;
          if (lid) localMap.set(d.id, lid);
          else localMap.delete(d.id);
        }
        setProfileLives(new Map(localMap));
      });
    });
    return () => unsubs.forEach((u) => u());
  }, [creatorIds, currentUserId]);

  // 5b. Subscribe to live status of member groups (real-time)
  useEffect(() => {
    if (groupIds.length === 0) { setGroupLives(new Map()); return; }
    const localMap = new Map<string, string>();
    const batches = chunk(groupIds, 30);
    const unsubs = batches.map((batch) => {
      const q = query(collection(db, "groups"), where(documentId(), "in", batch));
      return onSnapshot(q, (snap) => {
        for (const d of snap.docs) {
          const lid = d.data().activeLivePostId as string | undefined;
          if (lid) localMap.set(d.id, lid);
          else localMap.delete(d.id);
        }
        setGroupLives(new Map(localMap));
      });
    });
    return () => unsubs.forEach((u) => u());
  }, [groupIds]);

  // 5c. Fetch display info for live entities not yet in the map
  useEffect(() => {
    const missingProfiles = [...profileLives.keys()].filter((id) => !fetchedInfoKeys.current.has(id));
    const missingGroups = [...groupLives.keys()].filter((id) => !fetchedInfoKeys.current.has(id));
    if (missingProfiles.length === 0 && missingGroups.length === 0) return;
    async function fetchLiveInfo() {
      const updates = new Map<string, DisplayInfo>();
      for (const batch of chunk(missingProfiles, 30)) {
        try {
          const snap = await getDocs(query(collection(db, "users"), where(documentId(), "in", batch)));
          for (const d of snap.docs) {
            const data = d.data();
            updates.set(d.id, {
              displayName: (data.displayName as string | null) ?? (data.username as string | null) ?? null,
              photoURL: (data.photoURL as string | null) ?? null,
            });
            fetchedInfoKeys.current.add(d.id);
          }
        } catch (err) { console.error("[HomeStoriesRow] fetchLiveUsers", err); }
      }
      for (const batch of chunk(missingGroups, 30)) {
        try {
          const snap = await getDocs(query(collection(db, "groups"), where(documentId(), "in", batch)));
          for (const d of snap.docs) {
            const data = d.data();
            updates.set(d.id, {
              displayName: (data.name as string | null) ?? null,
              photoURL: (data.avatarUrl as string | null) ?? (data.imageUrl as string | null) ?? null,
            });
            fetchedInfoKeys.current.add(d.id);
          }
        } catch (err) { console.error("[HomeStoriesRow] fetchLiveGroups", err); }
      }
      if (updates.size > 0) {
        setDisplayInfoMap((prev) => {
          const next = new Map(prev);
          for (const [k, v] of updates) next.set(k, v);
          return next;
        });
      }
    }
    void fetchLiveInfo();
  }, [profileLives, groupLives]);

  // 5. Batch-fetch display info for creators/groups (including recommended)
  useEffect(() => {
    const newCreatorIds = [...new Set(
      [...profileStories, ...recommendedStories]
        .map((s) => s.creatorId)
        .filter((id) => !fetchedInfoKeys.current.has(id)),
    )];
    const newGroupIds = [...new Set(
      groupStories
        .map((s) => s.groupId)
        .filter((id): id is string => !!id && !fetchedInfoKeys.current.has(id)),
    )];
    if (newCreatorIds.length === 0 && newGroupIds.length === 0) return;

    async function fetchInfo() {
      const updates = new Map<string, DisplayInfo>();
      if (newCreatorIds.length > 0) {
        for (const batch of chunk(newCreatorIds, 30)) {
          try {
            const snap = await getDocs(
              query(collection(db, "users"), where(documentId(), "in", batch)),
            );
            for (const d of snap.docs) {
              const data = d.data();
              updates.set(d.id, {
                displayName:
                  (data.displayName as string | null) ??
                  (data.username as string | null) ??
                  null,
                photoURL: (data.photoURL as string | null) ?? null,
              });
              fetchedInfoKeys.current.add(d.id);
            }
          } catch (err) {
            console.error("[HomeStoriesRow] fetchUsers", err);
          }
        }
      }
      if (newGroupIds.length > 0) {
        for (const batch of chunk(newGroupIds, 30)) {
          try {
            const snap = await getDocs(
              query(collection(db, "groups"), where(documentId(), "in", batch)),
            );
            for (const d of snap.docs) {
              const data = d.data();
              updates.set(d.id, {
                displayName: (data.name as string | null) ?? null,
                photoURL:
                  (data.avatarUrl as string | null) ??
                  (data.imageUrl as string | null) ??
                  null,
              });
              fetchedInfoKeys.current.add(d.id);
            }
          } catch (err) {
            console.error("[HomeStoriesRow] fetchGroups", err);
          }
        }
      }
      if (updates.size > 0) {
        setDisplayInfoMap((prev) => {
          const next = new Map(prev);
          for (const [k, v] of updates) next.set(k, v);
          return next;
        });
      }
    }
    void fetchInfo();
  }, [profileStories, groupStories, recommendedStories]);

  const handleStoryViewed = useCallback(
    (storyId: string) => {
      recordStoryView(currentUserId, storyId).catch(console.error);
    },
    [currentUserId],
  );

  const storyGroups = buildStoryGroups(profileStories, groupStories, viewedMap, displayInfoMap);
  const recommendedStoryGroups = buildStoryGroups(recommendedStories, [], viewedMap, displayInfoMap);
  const allGroups = [...storyGroups, ...recommendedStoryGroups];
  // Keep refs in sync after every render so mobile callbacks always see current data
  useLayoutEffect(() => {
    storyGroupsRef.current = allGroups;
    activeGroupRef.current = activeGroup;
  });

  // Lives: profiles + groups currently broadcasting (excluding self)
  type LiveEntity = { entityId: string; entityType: "profile" | "group" };
  const liveEntities: LiveEntity[] = [
    ...[...profileLives.keys()].map((id) => ({ entityId: id, entityType: "profile" as const })),
    ...[...groupLives.keys()].map((id) => ({ entityId: id, entityType: "group" as const })),
  ];

  // Current user's story goes first; live entities second; others third
  const myStoryGroup = storyGroups.find((g) => g.key === currentUserId);
  const otherStoryGroups = storyGroups.filter((g) => g.key !== currentUserId);

  // Mobile: when the last story in a group is exhausted (or swipe-left), advance to next unread group
  function handleMobileGroupFinished() {
    const groups = storyGroupsRef.current;
    const currentKey = activeGroupRef.current?.key;
    const currentIdx = currentKey ? groups.findIndex((g) => g.key === currentKey) : -1;
    const next = currentIdx >= 0 && currentIdx < groups.length - 1 ? groups[currentIdx + 1] : null;
    setActiveGroup(next ?? null);
  }

  // Mobile: swipe-right or tap-left on first story → go to previous group
  function handleMobileGroupBack() {
    const groups = storyGroupsRef.current;
    const currentKey = activeGroupRef.current?.key;
    const currentIdx = currentKey ? groups.findIndex((g) => g.key === currentKey) : -1;
    if (currentIdx > 0) {
      setActiveGroup(groups[currentIdx - 1]);
    }
  }

  if (allGroups.length === 0 && liveEntities.length === 0) return null;

  function renderLiveBubble({ entityId, entityType }: LiveEntity) {
    const info = displayInfoMap.get(entityId);
    const name = info?.displayName ?? (entityType === "group" ? "Comunidad" : "Usuario");
    return (
      <div
        key={`live-${entityId}`}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 5,
          flexShrink: 0,
        }}
      >
        <LiveRingAvatar
          entityId={entityId}
          entityType={entityType}
          size={80}
          photoURL={info?.photoURL ?? null}
          displayName={name}
          currentUserId={currentUserId}
        />
        <span
          style={{
            color: "rgba(255,255,255,0.72)",
            fontSize: 11,
            fontWeight: 500,
            lineHeight: 1.4,
            letterSpacing: "-0.01em",
            fontFamily: fontStack,
            maxWidth: 88,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name}
        </span>
      </div>
    );
  }

  function renderBubble(group: StoryGroup) {
    const isGrp = group.source === "group";
    const emoji = isGrp ? "🏘️" : "👤";
    const name = group.info.displayName ?? (isGrp ? "Comunidad" : "Usuario");
    const ring = group.hasUnviewed ? VIBRA_GRADIENT : SEEN_COLOR;
    return (
      <button
        key={group.key}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (isDesktop) {
            const idx = allGroups.findIndex((g) => g.key === group.key);
            setDesktopOpen({ groups: allGroups, initialIdx: idx >= 0 ? idx : 0 });
          } else {
            setMobileSourceRect(e.currentTarget.getBoundingClientRect());
            setActiveGroup(group);
          }
        }}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 5,
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          WebkitTapHighlightColor: "transparent",
          flexShrink: 0,
          position: "relative",
        }}
      >
        <div
          style={{
            width: 80,
            height: 80,
            borderRadius: "50%",
            background: ring,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 2.5,
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              width: "100%",
              height: "100%",
              borderRadius: "50%",
              border: "2px solid rgb(10,10,14)",
              overflow: "hidden",
              background: "#1a1a2e",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxSizing: "border-box",
              position: "relative",
            }}
          >
            {group.thumbnailUrl ? (
              <Image
                src={group.thumbnailUrl}
                alt={name}
                fill
                style={{ objectFit: "cover" }}
              />
            ) : (
              <span style={{ fontSize: 22, lineHeight: 1 }}>{emoji}</span>
            )}
          </div>
        </div>
        <span
          style={{
            color: "rgba(255,255,255,0.72)",
            fontSize: 11,
            fontWeight: 500,
            lineHeight: 1.4,
            letterSpacing: "-0.01em",
            fontFamily: fontStack,
            maxWidth: 88,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name}
        </span>
      </button>
    );
  }

  return (
    <>
      <div
        style={{
          display: "flex",
          gap: 16,
          padding: "12px 16px 8px",
          overflowX: "auto",
          scrollbarWidth: "none",
          WebkitOverflowScrolling: "touch" as React.CSSProperties["WebkitOverflowScrolling"],
          marginBottom: 14,
          alignItems: "flex-start",
        }}
      >
        {myStoryGroup && renderBubble(myStoryGroup)}
        {liveEntities.map((e) => renderLiveBubble(e))}
        {otherStoryGroups.map((group) => renderBubble(group))}

        {recommendedStoryGroups.length > 0 && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              flexShrink: 0,
              gap: 0,
            }}
          >
            <span
              style={{
                fontSize: 10,
                color: "rgba(255,255,255,0.38)",
                fontFamily: fontStack,
                fontWeight: 500,
                letterSpacing: "-0.01em",
                paddingLeft: 2,
                paddingBottom: 6,
              }}
            >
              Recomendados
            </span>
            <div style={{ display: "flex", gap: 16 }}>
              {recommendedStoryGroups.map((group) => renderBubble(group))}
            </div>
          </div>
        )}
      </div>

      {/* Desktop: carousel with next-group preview */}
      {desktopOpen && (
        <HomeStoryCarouselDesktop
          groups={desktopOpen.groups}
          initialGroupIndex={desktopOpen.initialIdx}
          onClose={() => setDesktopOpen(null)}
          onStoryViewed={handleStoryViewed}
        />
      )}

      {/* Mobile: tap navigates within group; swipe or exhaustion changes group; swipe-down closes */}
      {activeGroup && (
        <StoryViewer
          key={activeGroup.key}
          stories={activeGroup.stories}
          initialIndex={activeGroup.startIndex}
          onClose={() => setActiveGroup(null)}
          onGroupFinished={handleMobileGroupFinished}
          onPrevGroup={handleMobileGroupBack}
          onStoryViewed={handleStoryViewed}
          sourceRect={mobileSourceRect}
        />
      )}
    </>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function resolveThumb(story: StoryDoc): string | null {
  if (story.muxPlaybackId) return `https://image.mux.com/${story.muxPlaybackId}/thumbnail.jpg?time=0`;
  if (story.thumbnailUrl) return story.thumbnailUrl;
  return null;
}

function buildStoryGroups(
  profileStories: StoryDoc[],
  groupStories: StoryDoc[],
  viewedMap: Map<string, number>,
  infoMap: Map<string, DisplayInfo>,
): StoryGroup[] {
  const now = Date.now();

  type Cat = "unviewed" | "recent" | "expired";
  function categorize(story: StoryDoc): Cat {
    const viewedAt = viewedMap.get(story.id);
    if (viewedAt === undefined) return "unviewed";
    if (now - viewedAt < TWENTY_FOUR_HOURS_MS) return "recent";
    return "expired";
  }

  type Acc = {
    key: string;
    source: "profile" | "group";
    unviewed: StoryDoc[];
    recent: StoryDoc[];
    info: DisplayInfo;
  };

  const map = new Map<string, Acc>();

  function add(story: StoryDoc, key: string, source: "profile" | "group") {
    const cat = categorize(story);
    if (cat === "expired") return;
    if (!map.has(key)) {
      map.set(key, {
        key, source, unviewed: [], recent: [],
        info: infoMap.get(key) ?? { displayName: null, photoURL: null },
      });
    }
    const g = map.get(key)!;
    if (cat === "unviewed") g.unviewed.push(story);
    else g.recent.push(story);
  }

  for (const s of profileStories) add(s, s.creatorId, "profile");
  for (const s of groupStories) { if (s.groupId) add(s, s.groupId, "group"); }

  const active: Array<StoryGroup & { _sort: number }> = [];
  const seen: Array<StoryGroup & { _sort: number }> = [];

  for (const g of map.values()) {
    if (g.unviewed.length === 0 && g.recent.length === 0) continue;

    const hasUnviewed = g.unviewed.length > 0;

    // Viewed stories: newest-viewed right before start index (so going left shows most recent)
    const sortedRecent = [...g.recent].sort(
      (a, b) => (viewedMap.get(b.id) ?? 0) - (viewedMap.get(a.id) ?? 0),
    );
    // Unviewed stories: oldest first (progress forward in time going right)
    const sortedUnviewed = [...g.unviewed].sort(
      (a, b) => (a.createdAt?.toMillis() ?? 0) - (b.createdAt?.toMillis() ?? 0),
    );

    // Array order: [...viewed, ...unviewed] — going left from start reaches viewed
    const stories = [...sortedRecent, ...sortedUnviewed];
    const startIndex = hasUnviewed ? sortedRecent.length : 0;

    // Thumbnail from newest unviewed; fallback to most recently viewed
    const thumbSource = hasUnviewed
      ? sortedUnviewed[sortedUnviewed.length - 1]  // newest unviewed
      : sortedRecent[0];                            // most recently viewed
    const thumbnailUrl = thumbSource ? resolveThumb(thumbSource) : null;

    const group: StoryGroup & { _sort: number } = {
      key: g.key,
      source: g.source,
      stories,
      startIndex,
      hasUnviewed,
      thumbnailUrl,
      info: g.info,
      _sort: 0,
    };

    if (hasUnviewed) {
      group._sort = Math.max(...g.unviewed.map((s) => s.createdAt?.toMillis() ?? 0));
      active.push(group);
    } else {
      group._sort = Math.max(...g.recent.map((s) => viewedMap.get(s.id) ?? 0));
      seen.push(group);
    }
  }

  active.sort((a, b) => b._sort - a._sort);
  seen.sort((a, b) => b._sort - a._sort);

  // Strip _sort before returning
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return [...active, ...seen].map(({ _sort, ...g }) => g);
}
