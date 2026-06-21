"use client";

import { useCallback, useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  recordStoryView,
  setProfileStoryCover,
  setProfileStoryCoverPhoto,
  subscribeToCreatorStories,
} from "@/lib/stories/storyService";
import type { StoryDoc, StoryGroupKey, StoryType } from "@/lib/stories/types";
import StoryCircle from "./StoryCircle";
import StoryViewer from "./StoryViewer";
import StoryCoverPicker from "./StoryCoverPicker";

type Props = {
  creatorId: string;
  currentUserId?: string | null;
};

function resolveThumb(story: StoryDoc | null): string | null {
  if (!story) return null;
  if (story.muxPlaybackId)
    return `https://image.mux.com/${story.muxPlaybackId}/thumbnail.jpg?time=0`;
  return story.thumbnailUrl ?? null;
}

type ViewerState = { stories: StoryDoc[]; type: StoryType } | null;
type PickerGroup = { key: StoryGroupKey; type: StoryType; role: "creator" | "buyer" } | null;

export default function StoryCircles({ creatorId, currentUserId }: Props) {
  const [stories, setStories] = useState<StoryDoc[]>([]);
  const [viewerState, setViewerState] = useState<ViewerState>(null);
  const [pickerGroup, setPickerGroup] = useState<PickerGroup>(null);
  const [storyCovers, setStoryCovers] = useState<Partial<Record<string, string>>>({});
  const [storyCoverPhoto, setStoryCoverPhoto] = useState<Partial<Record<string, string>>>({});

  const isOwner = !!currentUserId && currentUserId === creatorId;

  useEffect(() => {
    if (!creatorId) return;
    return subscribeToCreatorStories(creatorId, setStories);
  }, [creatorId]);

  useEffect(() => {
    if (!creatorId) return;
    getDoc(doc(db, "users", creatorId))
      .then((snap) => {
        const data = snap.data();
        const covers = data?.storyCovers as Partial<Record<string, string>> | undefined;
        const photos = data?.storyCoverPhoto as Partial<Record<string, string>> | undefined;
        if (covers) setStoryCovers(covers);
        if (photos) setStoryCoverPhoto(photos);
      })
      .catch(() => {});
  }, [creatorId]);

  const handleStoryViewed = useCallback(
    (storyId: string) => {
      if (currentUserId) recordStoryView(currentUserId, storyId).catch(console.error);
    },
    [currentUserId],
  );

  const handleSelectStory = async (key: string, storyId: string | null) => {
    setStoryCovers((prev) => {
      const next = { ...prev };
      if (storyId) next[key] = storyId;
      else delete next[key];
      return next;
    });
    setStoryCoverPhoto((prev) => { const next = { ...prev }; delete next[key]; return next; });
    await setProfileStoryCover(creatorId, key, storyId);
    if (storyCoverPhoto[key]) await setProfileStoryCoverPhoto(creatorId, key, null);
  };

  const handleUploadPhoto = async (key: string, url: string) => {
    setStoryCoverPhoto((prev) => ({ ...prev, [key]: url }));
    setStoryCovers((prev) => { const next = { ...prev }; delete next[key]; return next; });
    await setProfileStoryCoverPhoto(creatorId, key, url);
    if (storyCovers[key]) await setProfileStoryCover(creatorId, key, null);
  };

  // Sent = I created this greeting; Received = someone else created it for me
  const isSent = (s: StoryDoc) =>
    s.greetingCreatorId ? s.greetingCreatorId === creatorId : true;

  const saludosEnviados = stories.filter((s) => s.type === "saludo" && isSent(s));
  const consejosEnviados = stories.filter((s) => s.type === "consejo" && isSent(s));
  const saludosRecibidos = stories.filter((s) => s.type === "saludo" && !isSent(s));
  const consejosRecibidos = stories.filter((s) => s.type === "consejo" && !isSent(s));

  const allGroups: { key: StoryGroupKey; list: StoryDoc[]; type: StoryType; sublabel: string; role: "creator" | "buyer" }[] = [
    { key: "saludo_sent", list: saludosEnviados, type: "saludo", sublabel: "Enviados", role: "creator" },
    { key: "consejo_sent", list: consejosEnviados, type: "consejo", sublabel: "Enviados", role: "creator" },
    { key: "saludo_received", list: saludosRecibidos, type: "saludo", sublabel: "Recibidos", role: "buyer" },
    { key: "consejo_received", list: consejosRecibidos, type: "consejo", sublabel: "Recibidos", role: "buyer" },
  ];
  const groups = allGroups.filter((g) => g.list.length > 0);

  if (groups.length === 0) return null;

  const getCoverThumbnail = (key: string, list: StoryDoc[]): string | null => {
    if (storyCoverPhoto[key]) return storyCoverPhoto[key]!;
    const coverId = storyCovers[key];
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
          WebkitOverflowScrolling: "touch" as React.CSSProperties["WebkitOverflowScrolling"],
          scrollbarWidth: "none",
        }}
      >
        {groups.map((g, i) => (
          <div key={i} style={{ position: "relative", flexShrink: 0 }}>
            <StoryCircle
              type={g.type}
              thumbnailUrl={getCoverThumbnail(g.key, g.list)}
              sublabel={g.sublabel}
              onClick={() => setViewerState({ stories: g.list, type: g.type })}
            />
            {isOwner && (
              <button
                type="button"
                aria-label={`Cambiar portada de ${g.type}s ${g.sublabel.toLowerCase()}`}
                onClick={(e) => { e.stopPropagation(); setPickerGroup({ key: g.key, type: g.type, role: g.role }); }}
                style={gearBtnStyle}
              >
                <GearIcon />
              </button>
            )}
          </div>
        ))}
      </div>

      {viewerState && (
        <StoryViewer
          stories={viewerState.stories}
          type={viewerState.type}
          onClose={() => setViewerState(null)}
          onStoryViewed={handleStoryViewed}
        />
      )}

      {pickerGroup && (
        <StoryCoverPicker
          stories={stories.filter((s) =>
            s.type === pickerGroup.type &&
            (pickerGroup.role === "buyer" ? !isSent(s) : isSent(s))
          )}
          type={pickerGroup.type}
          role={pickerGroup.role}
          entityId={creatorId}
          entityType="profile"
          currentCoverStoryId={storyCovers[pickerGroup.key] ?? null}
          currentCustomPhotoUrl={storyCoverPhoto[pickerGroup.key] ?? null}
          uploadStoragePath={`storyCovers/users/${creatorId}/${pickerGroup.key}`}
          onSelectStory={(storyId) => handleSelectStory(pickerGroup.key, storyId)}
          onUploadPhoto={(url) => handleUploadPhoto(pickerGroup.key, url)}
          onClose={() => setPickerGroup(null)}
        />
      )}
    </>
  );
}

const gearBtnStyle: React.CSSProperties = {
  position: "absolute",
  bottom: 22,
  right: -4,
  width: 22,
  height: 22,
  borderRadius: "50%",
  background: "rgba(10,10,16,0.96)",
  border: "1.5px solid rgba(255,255,255,0.14)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  padding: 0,
  zIndex: 2,
  boxShadow: "0 2px 8px rgba(0,0,0,0.5)",
  WebkitTapHighlightColor: "transparent",
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
