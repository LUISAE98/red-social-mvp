"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  recordStoryView,
  setProfileStoryCover,
  setProfileStoryCoverPhoto,
  subscribeToCreatorStories,
} from "@/lib/stories/storyService";
import type { StoryDoc, StoryGroupKey, StoryType } from "@/lib/stories/types";
import { usePublishableGreetings } from "@/lib/stories/usePublishableGreetings";
import StoryCircle from "./StoryCircle";
import EditTextButton from "@/components/ui/EditTextButton";
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
type PickerGroup = {
  key: StoryGroupKey;
  type: StoryType;
  role: "creator" | "buyer" | "both";
} | null;

export default function StoryCircles({ creatorId, currentUserId }: Props) {
  const [stories, setStories] = useState<StoryDoc[]>([]);
  const [viewerState, setViewerState] = useState<ViewerState>(null);
  const [viewerSourceRect, setViewerSourceRect] = useState<DOMRect | null>(null);
  const [pickerGroup, setPickerGroup] = useState<PickerGroup>(null);
  const [storyCovers, setStoryCovers] = useState<Partial<Record<string, string>>>({});
  const [storyCoverPhoto, setStoryCoverPhoto] = useState<Partial<Record<string, string>>>({});

  const tCommon = useTranslations("common");
  const isOwner = !!currentUserId && currentUserId === creatorId;

  // Cuánto hay publicable de cada tipo, para decidir si sale el círculo con `+`.
  // Solo se consulta si eres el dueño; a un visitante no le incumbe.
  const { items: publishableSaludos } = usePublishableGreetings({
    uid: currentUserId,
    type: "saludo",
    scope: { kind: "profile" },
    enabled: isOwner,
  });
  const { items: publishableConsejos } = usePublishableGreetings({
    uid: currentUserId,
    type: "consejo",
    scope: { kind: "profile" },
    enabled: isOwner,
  });

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
    { key: "saludo_sent", list: saludosEnviados, type: "saludo", sublabel: tCommon("storySent"), role: "creator" },
    { key: "consejo_sent", list: consejosEnviados, type: "consejo", sublabel: tCommon("storySent"), role: "creator" },
    { key: "saludo_received", list: saludosRecibidos, type: "saludo", sublabel: tCommon("storyReceived"), role: "buyer" },
    { key: "consejo_received", list: consejosRecibidos, type: "consejo", sublabel: tCommon("storyReceived"), role: "buyer" },
  ];
  // Lo publicable, repartido en los MISMOS cuatro cajones del rail. El hook ya
  // aplica las reglas de cada lado, así que basta con separar por papel:
  //   - "creator" (enviados) solo trae lo que el comprador te autorizó a
  //     publicar. Si vendiste un consejo sin ese permiso, no cae aquí y por
  //     tanto su cajón no aparece.
  //   - "buyer" (recibidos) trae todo lo que compraste. Ese permiso limita al
  //     creador, no a ti, así que lo tuyo siempre lo puedes publicar.
  const publishableFor = (key: StoryGroupKey): number => {
    if (!isOwner) return 0;
    const pool = key.startsWith("saludo") ? publishableSaludos : publishableConsejos;
    const role = key.endsWith("_sent") ? "creator" : "buyer";
    return pool.filter((i) => i.role === role).length;
  };

  // Un cajón sale si ya tiene historias o si tienes algo que publicar en él.
  // Antes había dos botones sueltos de "Agregar historias" que no distinguían
  // enviados de recibidos, así que no había forma de estrenar el cajón que
  // tocaba: ahora cada cajón estrena el suyo.
  const groups = allGroups
    .map((g) => ({ ...g, pending: publishableFor(g.key) }))
    .filter((g) => g.list.length > 0 || g.pending > 0);

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
          // "safe center" y no "center" a secas. Con overflow, centrar de golpe
          // empuja los primeros círculos fuera del borde izquierdo y ya no hay
          // forma de llegar a ellos con el scroll. La variante segura centra
          // mientras quepan y se rinde a la izquierda en cuanto desbordan.
          justifyContent: "safe center",
          gap: 18,
          padding: "10px 16px 6px",
          overflowX: "auto",
          WebkitOverflowScrolling: "touch" as React.CSSProperties["WebkitOverflowScrolling"],
          scrollbarWidth: "none",
        }}
      >
        {groups.map((g, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              flexShrink: 0,
            }}
          >
            <StoryCircle
              type={g.type}
              thumbnailUrl={g.list.length > 0 ? getCoverThumbnail(g.key, g.list) : null}
              sublabel={g.sublabel}
              empty={g.list.length === 0}
              onClick={(e) => {
                // Vacío no hay nada que ver: el clic lleva a publicar.
                if (g.list.length === 0) {
                  setPickerGroup({ key: g.key, type: g.type, role: g.role });
                  return;
                }
                setViewerSourceRect(e.currentTarget.getBoundingClientRect());
                setViewerState({ stories: g.list, type: g.type });
              }}
            />
            {isOwner && (
              <EditTextButton
                ariaLabel={tCommon("storyChangeCover", { label: `${g.type}s ${g.sublabel.toLowerCase()}` })}
                onClick={(e) => { e.stopPropagation(); setPickerGroup({ key: g.key, type: g.type, role: g.role }); }}
                style={{ marginTop: 4 }}
              >
                {tCommon("edit")}
              </EditTextButton>
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
          sourceRect={viewerSourceRect}
        />
      )}

      {pickerGroup && (
        <StoryCoverPicker
          stories={stories.filter(
            (s) =>
              s.type === pickerGroup.type &&
              (pickerGroup.role === "both"
                ? true
                : pickerGroup.role === "buyer"
                  ? !isSent(s)
                  : isSent(s)),
          )}
          type={pickerGroup.type}
          role={pickerGroup.role}
          entityId={creatorId}
          entityType="profile"
          currentUserId={creatorId}
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
