"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  recordStoryView,
  setGroupStoryCover,
  setGroupStoryCoverPhoto,
  subscribeToGroupStories,
} from "@/lib/stories/storyService";
import type { StoryDoc, StoryType } from "@/lib/stories/types";
import { usePublishableGreetings } from "@/lib/stories/usePublishableGreetings";
import StoryCircle from "./StoryCircle";
import AddStoryCircle from "./AddStoryCircle";
import EditTextButton from "@/components/ui/EditTextButton";
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
  const tCommon = useTranslations("common");
  const [stories, setStories] = useState<StoryDoc[]>([]);
  const [viewerType, setViewerType] = useState<StoryType | null>(null);
  const [viewerSourceRect, setViewerSourceRect] = useState<DOMRect | null>(null);
  const [pickerType, setPickerType] = useState<StoryType | null>(null);
  const [storyCovers, setStoryCovers] = useState<Partial<Record<StoryType, string>>>({});
  const [storyCoverPhoto, setStoryCoverPhoto] = useState<Partial<Record<StoryType, string>>>({});

  // Solo lo que el dueño grabó DENTRO de esta comunidad y con permiso del
  // comprador. Se consulta únicamente si es el dueño.
  const { items: publishableSaludos } = usePublishableGreetings({
    uid: currentUserId,
    type: "saludo",
    scope: { kind: "group", groupId },
    enabled: isOwner,
  });
  const { items: publishableConsejos } = usePublishableGreetings({
    uid: currentUserId,
    type: "consejo",
    scope: { kind: "group", groupId },
    enabled: isOwner,
  });

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

  // Igual que en el perfil, el rail ya no exige historias YA publicadas. Si el
  // dueño tiene algo publicable en esta comunidad, sale el círculo con `+`.
  const addCircles = [
    { type: "saludo" as StoryType, count: publishableSaludos.length },
    { type: "consejo" as StoryType, count: publishableConsejos.length },
  ].filter((c) => c.count > 0);

  if (saludos.length === 0 && consejos.length === 0 && addCircles.length === 0) return null;

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
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
            <StoryCircle
              type="saludo"
              thumbnailUrl={getCoverThumbnail("saludo", saludos)}
              onClick={(e) => { setViewerSourceRect(e.currentTarget.getBoundingClientRect()); setViewerType("saludo"); }}
            />
            {isOwner && (
              <EditTextButton
                ariaLabel={tCommon("storyChangeCover", { label: tCommon("storySaludos").toLowerCase() })}
                onClick={(e) => { e.stopPropagation(); setPickerType("saludo"); }}
                style={{ marginTop: 4 }}
              >
                {tCommon("edit")}
              </EditTextButton>
            )}
          </div>
        )}

        {consejos.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
            <StoryCircle
              type="consejo"
              thumbnailUrl={getCoverThumbnail("consejo", consejos)}
              onClick={(e) => { setViewerSourceRect(e.currentTarget.getBoundingClientRect()); setViewerType("consejo"); }}
            />
            {isOwner && (
              <EditTextButton
                ariaLabel={tCommon("storyChangeCover", { label: tCommon("storyConsejos").toLowerCase() })}
                onClick={(e) => { e.stopPropagation(); setPickerType("consejo"); }}
                style={{ marginTop: 4 }}
              >
                {tCommon("edit")}
              </EditTextButton>
            )}
          </div>
        )}

        {addCircles.map((c) => (
          <AddStoryCircle
            key={`add-${c.type}`}
            type={c.type}
            label={tCommon("storyAddStories")}
            ariaLabel={tCommon("storyAddStories")}
            onClick={() => setPickerType(c.type)}
          />
        ))}
      </div>

      {viewerType && (
        <StoryViewer
          stories={viewerType === "saludo" ? saludos : consejos}
          type={viewerType}
          onClose={() => setViewerType(null)}
          onStoryViewed={handleStoryViewed}
          sourceRect={viewerSourceRect}
        />
      )}

      {pickerType && (
        <StoryCoverPicker
          stories={pickerType === "saludo" ? saludos : consejos}
          type={pickerType}
          entityId={groupId}
          entityType="group"
          currentUserId={currentUserId ?? ""}
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
