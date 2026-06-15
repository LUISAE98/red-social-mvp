"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  collection,
  documentId,
  getDocs,
  limit,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  recordStoryView,
  subscribeToStoriesFromCreators,
  subscribeToStoriesFromGroups,
  subscribeToViewedStories,
} from "@/lib/stories/storyService";
import type { StoryDoc } from "@/lib/stories/types";
import StoryViewer from "./StoryViewer";
import HomeStoryCarouselDesktop, { type CarouselGroup } from "./HomeStoryCarouselDesktop";

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
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", Roboto, "Helvetica Neue", sans-serif';

export default function HomeStoriesRow({ currentUserId }: Props) {
  const [creatorIds, setCreatorIds] = useState<string[]>([]);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [profileStories, setProfileStories] = useState<StoryDoc[]>([]);
  const [groupStories, setGroupStories] = useState<StoryDoc[]>([]);
  const [viewedMap, setViewedMap] = useState<Map<string, number>>(new Map());
  const [displayInfoMap, setDisplayInfoMap] = useState<Map<string, DisplayInfo>>(new Map());
  const [activeGroup, setActiveGroup] = useState<StoryGroup | null>(null);
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

  // 5. Batch-fetch display info for creators/groups
  useEffect(() => {
    const newCreatorIds = [...new Set(
      profileStories
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
  }, [profileStories, groupStories]);

  const handleStoryViewed = useCallback(
    (storyId: string) => {
      recordStoryView(currentUserId, storyId).catch(console.error);
    },
    [currentUserId],
  );

  const storyGroups = buildStoryGroups(profileStories, groupStories, viewedMap, displayInfoMap);
  // Keep refs in sync so callbacks always see current data
  storyGroupsRef.current = storyGroups;
  activeGroupRef.current = activeGroup;

  // Mobile: when the last story in a group is exhausted (or swipe-left), advance to next unread group
  const handleMobileGroupFinished = useCallback(() => {
    const groups = storyGroupsRef.current;
    const currentKey = activeGroupRef.current?.key;
    const currentIdx = currentKey ? groups.findIndex((g) => g.key === currentKey) : -1;
    const next = currentIdx >= 0 && currentIdx < groups.length - 1 ? groups[currentIdx + 1] : null;
    setActiveGroup(next ?? null);
  }, []);

  // Mobile: swipe-right or tap-left on first story → go to previous group
  const handleMobileGroupBack = useCallback(() => {
    const groups = storyGroupsRef.current;
    const currentKey = activeGroupRef.current?.key;
    const currentIdx = currentKey ? groups.findIndex((g) => g.key === currentKey) : -1;
    if (currentIdx > 0) {
      setActiveGroup(groups[currentIdx - 1]);
    }
  }, []);

  if (storyGroups.length === 0) return null;

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
        }}
      >
        {storyGroups.map((group) => {
          const isGroup = group.source === "group";
          const emoji = isGroup ? "🏘️" : "👤";
          const name = group.info.displayName ?? (isGroup ? "Comunidad" : "Usuario");
          const ring = group.hasUnviewed ? VIBRA_GRADIENT : SEEN_COLOR;

          return (
            <button
              key={group.key}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (isDesktop) {
                  const idx = storyGroups.findIndex((g) => g.key === group.key);
                  setDesktopOpen({ groups: storyGroups, initialIdx: idx >= 0 ? idx : 0 });
                } else {
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
              {/* Ring */}
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
                  }}
                >
                  {group.thumbnailUrl ? (
                    <img
                      src={group.thumbnailUrl}
                      alt={name}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  ) : (
                    <span style={{ fontSize: 22, lineHeight: 1 }}>{emoji}</span>
                  )}
                </div>
              </div>
              {/* Name */}
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
        })}
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
  return [...active, ...seen].map(({ _sort: _, ...g }) => g);
}
