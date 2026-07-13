"use client";

import { useEffect, useState } from "react";
import {
  subscribeToCreatorStories,
  subscribeToGroupStories,
  subscribeToViewedStories,
} from "./storyService";
import type { StoryDoc } from "./types";

export type RingState = "vibra" | "seen" | "none";

export type StoryRingStateResult = {
  ring: RingState;
  stories: StoryDoc[];
  startIndex: number;
};

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export function useStoryRingState(
  entityId: string | null | undefined,
  entityType: "profile" | "group",
  currentUserId?: string | null,
): StoryRingStateResult {
  const [stories, setStories] = useState<StoryDoc[]>([]);
  const [viewedMap, setViewedMap] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    if (!entityId) return;
    if (entityType === "profile") {
      return subscribeToCreatorStories(entityId, setStories);
    }
    return subscribeToGroupStories(entityId, setStories);
  }, [entityId, entityType]);

  useEffect(() => {
    if (!currentUserId) return;
    return subscribeToViewedStories(currentUserId, setViewedMap);
  }, [currentUserId]);

  if (stories.length === 0) {
    return { ring: "none", stories: [], startIndex: 0 };
  }

  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const unviewed: StoryDoc[] = [];
  const recent: StoryDoc[] = [];

  for (const story of stories) {
    const viewedAt = viewedMap.get(story.id);
    if (viewedAt === undefined) {
      unviewed.push(story);
    } else if (now - viewedAt < TWENTY_FOUR_HOURS_MS) {
      recent.push(story);
    }
  }

  if (unviewed.length === 0 && recent.length === 0) {
    return { ring: "none", stories: [], startIndex: 0 };
  }

  const hasUnviewed = unviewed.length > 0;

  const sortedRecent = [...recent].sort(
    (a, b) => (viewedMap.get(b.id) ?? 0) - (viewedMap.get(a.id) ?? 0),
  );
  const sortedUnviewed = [...unviewed].sort(
    (a, b) => (a.createdAt?.toMillis() ?? 0) - (b.createdAt?.toMillis() ?? 0),
  );

  const orderedStories = [...sortedRecent, ...sortedUnviewed];
  const startIndex = hasUnviewed ? sortedRecent.length : 0;

  return {
    ring: hasUnviewed ? "vibra" : "seen",
    stories: orderedStories,
    startIndex,
  };
}
