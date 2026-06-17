"use client";

import Image from "next/image";
import { useCallback, useRef, useState } from "react";
import { recordStoryView } from "@/lib/stories/storyService";
import { useStoryRingState } from "@/lib/stories/useStoryRingState";
import StoryViewer from "./StoryViewer";

const VIBRA_GRADIENT =
  "linear-gradient(135deg, #ec4899 0%, #9333ea 52%, #3b82f6 100%)";
const SEEN_COLOR = "rgba(255,255,255,0.28)";
const GAP_COLOR = "rgb(10,10,14)";

type Props = {
  entityId: string;
  entityType: "profile" | "group";
  currentUserId?: string | null;
  photoURL?: string | null;
  displayName: string;
  /** Outer container size in px. Avatar image fills this when no ring; shrinks slightly when ring shows. */
  size?: number;
  /** Called when clicked and there are no stories (e.g. navigate to profile). */
  onClick?: (e: React.MouseEvent) => void;
  style?: React.CSSProperties;
};

export default function StoryRingAvatar({
  entityId,
  entityType,
  currentUserId,
  photoURL,
  displayName,
  size = 40,
  onClick,
  style,
}: Props) {
  const { ring, stories, startIndex } = useStoryRingState(
    entityId,
    entityType,
    currentUserId,
  );
  const [viewerOpen, setViewerOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (ring !== "none" && stories.length > 0) {
        e.stopPropagation();
        setViewerOpen(true);
      } else {
        onClick?.(e);
      }
    },
    [ring, stories.length, onClick],
  );

  const handleStoryViewed = useCallback(
    (storyId: string) => {
      if (currentUserId) recordStoryView(currentUserId, storyId).catch(console.error);
    },
    [currentUserId],
  );

  const hasStories = ring !== "none" && stories.length > 0;
  const ringBg = ring === "vibra" ? VIBRA_GRADIENT : ring === "seen" ? SEEN_COLOR : "transparent";
  const padding = ring !== "none" ? 2 : 0;
  const innerBorder = ring !== "none" ? `1.5px solid ${GAP_COLOR}` : "none";

  const initials = (() => {
    const parts = displayName.trim().split(/\s+/).filter(Boolean);
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
  })();

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleClick}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          margin: 0,
          cursor: hasStories || onClick ? "pointer" : "default",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          WebkitTapHighlightColor: "transparent",
          flexShrink: 0,
          width: size,
          height: size,
          ...style,
        }}
        aria-label={hasStories ? `Ver historias de ${displayName}` : displayName}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            borderRadius: "50%",
            background: ringBg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding,
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              width: "100%",
              height: "100%",
              borderRadius: "50%",
              border: innerBorder,
              overflow: "hidden",
              background: "#1a1a2e",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxSizing: "border-box",
              position: "relative",
            }}
          >
            {photoURL ? (
              <Image
                src={photoURL}
                alt={displayName}
                fill
                style={{ objectFit: "cover" }}
              />
            ) : (
              <span
                style={{
                  color: "#fff",
                  fontSize: Math.max(10, Math.floor(size * 0.32)),
                  fontWeight: 600,
                  lineHeight: 1,
                  userSelect: "none",
                }}
              >
                {initials}
              </span>
            )}
          </div>
        </div>
      </button>

      {viewerOpen && (
        <StoryViewer
          stories={stories}
          initialIndex={startIndex}
          onClose={() => setViewerOpen(false)}
          onStoryViewed={handleStoryViewed}
        />
      )}
    </>
  );
}
