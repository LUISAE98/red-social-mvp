"use client";

import { useCallback, useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  recordStoryView,
  setGroupStoryCover,
  setGroupStoryCoverPhoto,
  subscribeToGroupStories,
} from "@/lib/stories/storyService";
import type { StoryDoc, StoryType } from "@/lib/stories/types";
import StoryCircle from "./StoryCircle";
import StoryViewer from "./StoryViewer";
import StoryCoverPicker from "./StoryCoverPicker";

type Props = {
  groupId: string;
  canView: boolean;
  currentUserId?: string | null;
  isOwner?: boolean;
};

function resolveThumb(story: StoryDoc | null): string | null {
  if (!story) return null;
  if (story.muxPlaybackId)
    return `https://image.mux.com/${story.muxPlaybackId}/thumbnail.jpg?time=0`;
  return story.thumbnailUrl ?? null;
}

export default function GroupStoryCircles({
  groupId,
  canView,
  currentUserId,
  isOwner = false,
}: Props) {
  const [stories, setStories] = useState<StoryDoc[]>([]);
  const [viewerType, setViewerType] = useState<StoryType | null>(null);
  const [pickerType, setPickerType] = useState<StoryType | null>(null);
  const [storyCovers, setStoryCovers] = useState<Partial<Record<StoryType, string>>>({});
  const [storyCoverPhoto, setStoryCoverPhoto] = useState<Partial<Record<StoryType, string>>>({});

  useEffect(() => {
    if (!groupId || !canView) return;
    return subscribeToGroupStories(groupId, setStories);
  }, [groupId, canView]);

  useEffect(() => {
    if (!groupId) return;
    getDoc(doc(db, "groups", groupId))
      .then((snap) => {
        const data = snap.data();
        const covers = data?.storyCovers as Partial<Record<StoryType, string>> | undefined;
        const photos = data?.storyCoverPhoto as Partial<Record<StoryType, string>> | undefined;
        if (covers) setStoryCovers(covers);
        if (photos) setStoryCoverPhoto(photos);
      })
      .catch(() => {});
  }, [groupId]);

  const handleStoryViewed = useCallback(
    (storyId: string) => {
      if (currentUserId) recordStoryView(currentUserId, storyId).catch(console.error);
    },
    [currentUserId],
  );

  const handleSelectStory = async (type: StoryType, storyId: string | null) => {
    setStoryCovers((prev) => {
      const next = { ...prev };
      if (storyId) next[type] = storyId;
      else delete next[type];
      return next;
    });
    setStoryCoverPhoto((prev) => { const next = { ...prev }; delete next[type]; return next; });
    await setGroupStoryCover(groupId, type, storyId);
    if (storyCoverPhoto[type]) await setGroupStoryCoverPhoto(groupId, type, null);
  };

  const handleUploadPhoto = async (type: StoryType, url: string) => {
    setStoryCoverPhoto((prev) => ({ ...prev, [type]: url }));
    setStoryCovers((prev) => { const next = { ...prev }; delete next[type]; return next; });
    await setGroupStoryCoverPhoto(groupId, type, url);
    if (storyCovers[type]) await setGroupStoryCover(groupId, type, null);
  };

  if (!canView) return null;

  const saludos = stories.filter((s) => s.type === "saludo");
  const consejos = stories.filter((s) => s.type === "consejo");

  if (saludos.length === 0 && consejos.length === 0) return null;

  const getCoverThumbnail = (type: StoryType, list: StoryDoc[]): string | null => {
    if (storyCoverPhoto[type]) return storyCoverPhoto[type]!;
    const coverId = storyCovers[type];
    const story = (coverId ? list.find((s) => s.id === coverId) : null) ?? list[0] ?? null;
    return resolveThumb(story);
  };

  return (
    <>
      <div
        style={{
          display: "flex",
          gap: 18,
          padding: "10px 16px 6px",
          overflowX: "auto",
          WebkitOverflowScrolling:
            "touch" as React.CSSProperties["WebkitOverflowScrolling"],
          scrollbarWidth: "none",
        }}
      >
        {saludos.length > 0 && (
          <div style={{ position: "relative", flexShrink: 0 }}>
            <StoryCircle
              type="saludo"
              thumbnailUrl={getCoverThumbnail("saludo", saludos)}
              onClick={() => setViewerType("saludo")}
            />
            {isOwner && (
              <button
                type="button"
                aria-label="Cambiar portada de saludos"
                onClick={(e) => { e.stopPropagation(); setPickerType("saludo"); }}
                style={gearBtnStyle}
              >
                <GearIcon />
              </button>
            )}
          </div>
        )}

        {consejos.length > 0 && (
          <div style={{ position: "relative", flexShrink: 0 }}>
            <StoryCircle
              type="consejo"
              thumbnailUrl={getCoverThumbnail("consejo", consejos)}
              onClick={() => setViewerType("consejo")}
            />
            {isOwner && (
              <button
                type="button"
                aria-label="Cambiar portada de consejos"
                onClick={(e) => { e.stopPropagation(); setPickerType("consejo"); }}
                style={gearBtnStyle}
              >
                <GearIcon />
              </button>
            )}
          </div>
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

      {pickerType && (
        <StoryCoverPicker
          stories={pickerType === "saludo" ? saludos : consejos}
          type={pickerType}
          entityId={groupId}
          entityType="group"
          currentCoverStoryId={storyCovers[pickerType] ?? null}
          currentCustomPhotoUrl={storyCoverPhoto[pickerType] ?? null}
          uploadStoragePath={`storyCovers/groups/${groupId}/${pickerType}`}
          onSelectStory={(storyId) => handleSelectStory(pickerType, storyId)}
          onUploadPhoto={(url) => handleUploadPhoto(pickerType, url)}
          onClose={() => setPickerType(null)}
        />
      )}
    </>
  );
}

const gearBtnStyle: React.CSSProperties = {
  position: "absolute",
  bottom: 22,
  right: -3,
  width: 20,
  height: 20,
  borderRadius: "50%",
  background: "rgba(14,14,20,0.90)",
  border: "1.5px solid rgba(255,255,255,0.18)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  padding: 0,
  zIndex: 2,
  boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
};

function GearIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
      stroke="rgba(255,255,255,0.75)" strokeWidth="2.2"
      strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
