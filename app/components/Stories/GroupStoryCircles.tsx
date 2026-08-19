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
  // `currentUserId` va en las dependencias a propósito: la suscripción se evalúa contra
  // las reglas con la sesión que haya EN ESE INSTANTE. Si arranca antes de que Firebase
  // restaure la sesión, la lectura se deniega y el `onSnapshot` queda MUERTO para siempre
  // (un error de listener es terminal, no reintenta). Al resolverse la sesión cambia esta
  // dependencia y se vuelve a suscribir.
  useEffect(() => {
    if (!groupId || !canView) return;
    return subscribeToGroupStories(groupId, setStories);
  }, [groupId, canView, currentUserId]);

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

  // Igual que en el perfil, un cajón sale si ya tiene historias o si hay algo
  // que publicar en él, y en ese segundo caso se pinta con un "+" dentro del
  // mismo círculo. Aquí solo hay un lado: una comunidad publica lo que su
  // creador grabó dentro, y el hook ya devuelve únicamente eso.
  const pendingSaludos = isOwner ? publishableSaludos.length : 0;
  const pendingConsejos = isOwner ? publishableConsejos.length : 0;

  const showSaludos = saludos.length > 0 || pendingSaludos > 0;
  const showConsejos = consejos.length > 0 || pendingConsejos > 0;

  if (!showSaludos && !showConsejos) return null;

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
          // "safe center" y no "center" a secas. Con overflow, centrar de golpe
          // empuja los primeros círculos fuera del borde izquierdo y ya no hay
          // forma de llegar a ellos con el scroll. La variante segura centra
          // mientras quepan y se rinde a la izquierda en cuanto desbordan.
          justifyContent: "safe center",
          gap: 18,
          padding: "10px 16px 6px",
          overflowX: "auto",
          WebkitOverflowScrolling:
            "touch" as React.CSSProperties["WebkitOverflowScrolling"],
          scrollbarWidth: "none",
        }}
      >
        {showSaludos && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
            <StoryCircle
              type="saludo"
              thumbnailUrl={saludos.length > 0 ? getCoverThumbnail("saludo", saludos) : null}
              empty={saludos.length === 0}
              onClick={(e) => {
                if (saludos.length === 0) { setPickerType("saludo"); return; }
                setViewerSourceRect(e.currentTarget.getBoundingClientRect()); setViewerType("saludo");
              }}
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

        {showConsejos && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
            <StoryCircle
              type="consejo"
              thumbnailUrl={consejos.length > 0 ? getCoverThumbnail("consejo", consejos) : null}
              empty={consejos.length === 0}
              onClick={(e) => {
                if (consejos.length === 0) { setPickerType("consejo"); return; }
                setViewerSourceRect(e.currentTarget.getBoundingClientRect()); setViewerType("consejo");
              }}
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
