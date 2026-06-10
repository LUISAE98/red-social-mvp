"use client";

import { useCallback, useEffect, useState } from "react";
import { recordStoryView, subscribeToGroupStories } from "@/lib/stories/storyService";
import type { StoryDoc, StoryType } from "@/lib/stories/types";
import StoryCircle from "./StoryCircle";
import StoryViewer from "./StoryViewer";

type Props = {
  groupId: string;
  canView: boolean;
  currentUserId?: string | null;
};

export default function GroupStoryCircles({ groupId, canView, currentUserId }: Props) {
  const [stories, setStories] = useState<StoryDoc[]>([]);
  const [viewerType, setViewerType] = useState<StoryType | null>(null);

  useEffect(() => {
    if (!groupId || !canView) return;
    return subscribeToGroupStories(groupId, setStories);
  }, [groupId, canView]);

  const handleStoryViewed = useCallback(
    (storyId: string) => {
      if (currentUserId) recordStoryView(currentUserId, storyId).catch(console.error);
    },
    [currentUserId],
  );

  if (!canView) return null;

  const saludos = stories.filter((s) => s.type === "saludo");
  const consejos = stories.filter((s) => s.type === "consejo");

  if (saludos.length === 0 && consejos.length === 0) return null;

  const latestSaludo = saludos[0] ?? null;
  const latestConsejo = consejos[0] ?? null;

  const resolveThumb = (s: typeof latestSaludo) =>
    s?.thumbnailUrl ?? (s?.muxPlaybackId ? `https://image.mux.com/${s.muxPlaybackId}/thumbnail.jpg` : null);

  return (
    <>
      <div
        style={{
          display: "flex",
          gap: 18,
          padding: "10px 16px 6px",
          overflowX: "auto",
          WebkitOverflowScrolling: "touch" as React.CSSProperties["WebkitOverflowScrolling"],
          scrollbarWidth: "none",
        }}
      >
        {saludos.length > 0 && (
          <StoryCircle
            type="saludo"
            thumbnailUrl={resolveThumb(latestSaludo)}
            onClick={() => setViewerType("saludo")}
          />
        )}
        {consejos.length > 0 && (
          <StoryCircle
            type="consejo"
            thumbnailUrl={resolveThumb(latestConsejo)}
            onClick={() => setViewerType("consejo")}
          />
        )}
      </div>

      {viewerType && (
        <StoryViewer
          stories={viewerType === "saludo" ? saludos : consejos}
          type={viewerType}
          onClose={() => setViewerType(null)}
          onStoryViewed={handleStoryViewed}
        />
      )}
    </>
  );
}
