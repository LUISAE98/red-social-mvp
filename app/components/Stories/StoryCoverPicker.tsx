"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { collection, getDocs, query, where } from "firebase/firestore";
import { storage, db } from "@/lib/firebase";
import { addStoryFromGreeting, deleteStory } from "@/lib/stories/storyService";
import type { StoryDoc, StoryType } from "@/lib/stories/types";

const fontStack =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", sans-serif';

type GreetingItem = {
  id: string;
  toName: string;
  instructions: string;
  muxPlaybackId: string | null;
  videoDuration: number | null;
  creatorId: string;
  groupId: string | null;
};

type Props = {
  stories: StoryDoc[];
  type: StoryType;
  entityId: string;
  entityType: "profile" | "group";
  /** "creator" = fetch greetings where creatorId === entityId (enviados); "buyer" = buyerId === entityId (recibidos) */
  role?: "creator" | "buyer";
  currentCoverStoryId: string | null;
  currentCustomPhotoUrl: string | null;
  uploadStoragePath: string;
  onSelectStory: (storyId: string | null) => Promise<void>;
  onUploadPhoto: (url: string) => Promise<void>;
  onClose: () => void;
};

function storyThumb(story: StoryDoc): string | null {
  if (story.muxPlaybackId)
    return `https://image.mux.com/${story.muxPlaybackId}/thumbnail.jpg?time=0`;
  return story.thumbnailUrl ?? null;
}

const CIRCLE_SIZE = 60;
const RING_SIZE = CIRCLE_SIZE + 5; // 2.5px ring padding each side
const VIBRA_GRADIENT =
  "linear-gradient(135deg, #ec4899 0%, #9333ea 52%, #3b82f6 100%)";

// Outer wrapper — provides the colored ring via background + padding
const ringWrap = (selected: boolean): React.CSSProperties => ({
  width: RING_SIZE,
  height: RING_SIZE,
  borderRadius: "50%",
  background: selected ? VIBRA_GRADIENT : "rgba(255,255,255,0.18)",
  padding: 2.5,
  boxSizing: "border-box",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
});

// Inner button — the actual circle content
const innerBtn: React.CSSProperties = {
  width: "100%",
  height: "100%",
  borderRadius: "50%",
  border: "2px solid rgb(14,14,20)",
  overflow: "hidden",
  background: "#111118",
  cursor: "pointer",
  padding: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexDirection: "column",
  boxSizing: "border-box",
};

const arrowBtnStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: "50%",
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.15)",
  color: "rgba(255,255,255,0.8)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 20,
  flexShrink: 0,
  padding: 0,
  lineHeight: "1",
  fontFamily: fontStack,
};

const actionBtnStyle: React.CSSProperties = {
  flexShrink: 0,
  padding: "5px 10px",
  borderRadius: 8,
  fontSize: 12,
  fontFamily: fontStack,
  fontWeight: 500,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

export default function StoryCoverPicker({
  stories,
  type,
  entityId,
  entityType,
  role = "creator",
  currentCoverStoryId,
  currentCustomPhotoUrl,
  uploadStoragePath,
  onSelectStory,
  onUploadPhoto,
  onClose,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [greetingList, setGreetingList] = useState<GreetingItem[]>([]);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { setMounted(true); }, []);

  // Detect mouse-capable device (desktop)
  useEffect(() => {
    const mql = window.matchMedia("(pointer: fine)");
    setIsDesktop(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  // Fetch delivered greetings that have story permission
  useEffect(() => {
    const constraint =
      entityType === "group"
        ? where("groupId", "==", entityId)
        : role === "buyer"
          ? where("buyerId", "==", entityId)
          : where("creatorId", "==", entityId);
    getDocs(query(collection(db, "greetingRequests"), constraint))
      .then((snap) => {
        const items: GreetingItem[] = [];
        for (const d of snap.docs) {
          const g = d.data();
          const hasPermission =
            role === "buyer" ? true : g.allowCreatorStory !== false;
          if (
            g.type === type &&
            g.status === "delivered" &&
            hasPermission &&
            g.muxPlaybackId
          ) {
            items.push({
              id: d.id,
              toName: g.toName ?? "",
              instructions: g.instructions ?? "",
              muxPlaybackId: g.muxPlaybackId ?? null,
              videoDuration: g.videoDuration ?? null,
              creatorId: g.creatorId ?? entityId,
              groupId: g.groupId ?? null,
            });
          }
        }
        setGreetingList(items);
      })
      .catch(console.error);
  }, [entityId, entityType, role, type]);

  const updateScrollState = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 1);
  };

  // Re-evaluate arrow visibility after panel mounts or story list changes
  useEffect(() => {
    if (mounted) updateScrollState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, stories]);

  const dirLabel = role === "buyer" ? "recibidos" : "enviados";
  const title =
    type === "saludo"
      ? `Portada de Saludos ${dirLabel}`
      : `Portada de Consejos ${dirLabel}`;
  const emoji = type === "saludo" ? "👋" : "💡";
  const typeLabel = type === "saludo" ? "saludos" : "consejos";

  const isCustomSelected = !!currentCustomPhotoUrl && !currentCoverStoryId;

  const handleSelectStory = async (storyId: string | null) => {
    if (saving || uploading) return;
    setSaving(true);
    try { await onSelectStory(storyId); }
    finally { setSaving(false); }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // file.type can be empty on iOS/Android — guess from extension so Storage rules pass
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const extMap: Record<string, string> = {
      jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
      webp: "image/webp", gif: "image/gif", heic: "image/heic", heif: "image/heif",
    };
    const contentType = file.type || extMap[ext] || "image/jpeg";
    setUploading(true);
    try {
      const storageRef = ref(storage, uploadStoragePath);
      await uploadBytes(storageRef, file, { contentType });
      const url = await getDownloadURL(storageRef);
      await onUploadPhoto(url);
    } catch (err) {
      console.error("[StoryCoverPicker upload]", err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleShare = async (item: GreetingItem) => {
    setProcessingId(item.id);
    try {
      await addStoryFromGreeting({
        // buyer publishes as themselves; creator publishes as themselves (item.creatorId === entityId)
        creatorId: role === "buyer" ? entityId : item.creatorId,
        greetingCreatorId: item.creatorId,
        instructions: item.instructions || undefined,
        type,
        muxPlaybackId: item.muxPlaybackId,
        thumbnailUrl: item.muxPlaybackId
          ? `https://image.mux.com/${item.muxPlaybackId}/thumbnail.jpg?time=0`
          : null,
        videoDuration: item.videoDuration,
        greetingRequestId: item.id,
        source: entityType === "profile" ? "profile" : "group",
        groupId: entityType === "group" ? entityId : null,
      });
    } finally {
      setProcessingId(null);
    }
  };

  const handleRemove = async (storyId: string, greetingId: string) => {
    setProcessingId(greetingId);
    try { await deleteStory(storyId); }
    finally { setProcessingId(null); }
  };

  if (!mounted) return null;

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 20px",
      }}
    >
      {/* Backdrop */}
      <div
        style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.72)" }}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        style={{
          position: "relative",
          background: "rgb(14,14,20)",
          borderRadius: 18,
          width: "100%",
          maxWidth: 360,
          maxHeight: "82vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 8px 40px rgba(0,0,0,0.6)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "16px 16px 10px",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              flex: 1,
              color: "#fff",
              fontWeight: 700,
              fontSize: 17,
              fontFamily: fontStack,
            }}
          >
            {title}
          </span>
          <button
            onClick={onClose}
            style={{
              background: "rgba(255,255,255,0.08)",
              border: "none",
              color: "rgba(255,255,255,0.55)",
              cursor: "pointer",
              width: 28,
              height: 28,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 14,
              fontFamily: fontStack,
            }}
          >
            ✕
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: "auto", paddingBottom: 20 }}>
          {/* Hint */}
          <p
            style={{
              margin: "0 16px 12px",
              color: "rgba(255,255,255,0.38)",
              fontSize: 11.5,
              fontFamily: fontStack,
              lineHeight: 1.4,
            }}
          >
            Elige la portada de {typeLabel} que se verá en tu perfil y comunidades.
          </p>

          {/* Cover row: [←] [horizontal scroll] [→] */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "0 16px 4px",
            }}
          >
            {/* Left arrow — desktop only */}
            {isDesktop && (
              <button
                type="button"
                disabled={!canScrollLeft}
                onClick={() =>
                  scrollRef.current?.scrollBy({
                    left: -(CIRCLE_SIZE + 10) * 2,
                    behavior: "smooth",
                  })
                }
                style={{
                  ...arrowBtnStyle,
                  opacity: canScrollLeft ? 1 : 0.25,
                  cursor: canScrollLeft ? "pointer" : "default",
                }}
              >
                ‹
              </button>
            )}

            {/* Horizontal scroll */}
            <div
              ref={scrollRef}
              onScroll={updateScrollState}
              style={{
                flex: 1,
                display: "flex",
                gap: 10,
                overflowX: "auto",
                scrollbarWidth: "none",
                WebkitOverflowScrolling:
                  "touch" as React.CSSProperties["WebkitOverflowScrolling"],
                padding: "4px 2px",
                alignItems: "flex-start",
              }}
            >
              {/* Slot: Subir foto */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 4,
                  flexShrink: 0,
                }}
              >
                <div style={ringWrap(isCustomSelected)}>
                  <button
                    type="button"
                    disabled={uploading || saving}
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                      ...innerBtn,
                      cursor: uploading ? "default" : "pointer",
                      opacity: uploading ? 0.7 : 1,
                      position: "relative",
                    }}
                  >
                    {currentCustomPhotoUrl ? (
                      <Image
                        src={currentCustomPhotoUrl}
                        alt=""
                        fill
                        style={{ objectFit: "cover" }}
                      />
                    ) : (
                      <CameraIcon />
                    )}
                    {uploading && (
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          background: "rgba(0,0,0,0.55)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <span style={{ color: "#fff", fontSize: 10 }}>...</span>
                      </div>
                    )}
                  </button>
                </div>
                <span
                  style={{
                    color: "rgba(255,255,255,0.45)",
                    fontSize: 9,
                    fontFamily: fontStack,
                    textAlign: "center",
                  }}
                >
                  {currentCustomPhotoUrl ? "Cambiar" : "Subir foto"}
                </span>
              </div>

              {/* Slot: Más reciente */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 4,
                  flexShrink: 0,
                }}
              >
                <div style={ringWrap(!currentCoverStoryId && !currentCustomPhotoUrl)}>
                  <button
                    type="button"
                    disabled={saving || uploading}
                    onClick={() => handleSelectStory(null)}
                    style={innerBtn}
                  >
                    <span style={{ fontSize: 22 }}>{emoji}</span>
                  </button>
                </div>
                <span
                  style={{
                    color: "rgba(255,255,255,0.45)",
                    fontSize: 9,
                    fontFamily: fontStack,
                  }}
                >
                  Reciente
                </span>
              </div>

              {/* Published story circles */}
              {stories.map((story) => {
                const thumb = storyThumb(story);
                const isSelected = story.id === currentCoverStoryId;
                return (
                  <div
                    key={story.id}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 4,
                      flexShrink: 0,
                    }}
                  >
                    <div style={ringWrap(isSelected)}>
                      <button
                        type="button"
                        disabled={saving || uploading}
                        onClick={() => handleSelectStory(story.id)}
                        style={innerBtn}
                      >
                        {thumb ? (
                          <Image
                            src={thumb}
                            alt=""
                            width={60}
                            height={60}
                            style={{ objectFit: "cover", width: "100%", height: "100%" }}
                          />
                        ) : (
                          <span style={{ fontSize: 22 }}>{emoji}</span>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Right arrow — desktop only */}
            {isDesktop && (
              <button
                type="button"
                disabled={!canScrollRight}
                onClick={() =>
                  scrollRef.current?.scrollBy({
                    left: (CIRCLE_SIZE + 10) * 2,
                    behavior: "smooth",
                  })
                }
                style={{
                  ...arrowBtnStyle,
                  opacity: canScrollRight ? 1 : 0.25,
                  cursor: canScrollRight ? "pointer" : "default",
                }}
              >
                ›
              </button>
            )}
          </div>

          {/* Greeting list */}
          {greetingList.length > 0 && (
            <>
              <div
                style={{
                  margin: "14px 16px 0",
                  height: 1,
                  background: "rgba(255,255,255,0.07)",
                }}
              />
              <p
                style={{
                  margin: "12px 16px 6px",
                  color: "rgba(255,255,255,0.45)",
                  fontSize: 11,
                  fontFamily: fontStack,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                Mis {typeLabel}
              </p>

              {greetingList.map((item) => {
                const publishedStory = stories.find(
                  (s) => s.greetingRequestId === item.id,
                );
                const isProcessing = processingId === item.id;
                const thumb = item.muxPlaybackId
                  ? `https://image.mux.com/${item.muxPlaybackId}/thumbnail.jpg?time=0`
                  : null;

                return (
                  <div
                    key={item.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "8px 16px",
                    }}
                  >
                    {/* Thumbnail */}
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: "50%",
                        overflow: "hidden",
                        flexShrink: 0,
                        background: "#111118",
                        border: "1.5px solid rgba(255,255,255,0.10)",
                      }}
                    >
                      {thumb ? (
                        <Image
                          src={thumb}
                          alt=""
                          width={44}
                          height={44}
                          style={{ objectFit: "cover", width: "100%", height: "100%" }}
                        />
                      ) : (
                        <div
                          style={{
                            width: "100%",
                            height: "100%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <span style={{ fontSize: 18 }}>{emoji}</span>
                        </div>
                      )}
                    </div>

                    {/* Text */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          color: "#fff",
                          fontSize: 13.5,
                          fontFamily: fontStack,
                          fontWeight: 500,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        Para {item.toName}
                      </div>
                      {item.instructions ? (
                        <div
                          style={{
                            color: "rgba(255,255,255,0.38)",
                            fontSize: 11.5,
                            fontFamily: fontStack,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            marginTop: 1,
                          }}
                        >
                          {item.instructions}
                        </div>
                      ) : null}
                    </div>

                    {/* Action button */}
                    {publishedStory ? (
                      <button
                        type="button"
                        disabled={isProcessing}
                        onClick={() => handleRemove(publishedStory.id, item.id)}
                        style={{
                          ...actionBtnStyle,
                          background: "rgba(239,68,68,0.12)",
                          border: "1px solid rgba(239,68,68,0.40)",
                          color: "#f87171",
                          opacity: isProcessing ? 0.6 : 1,
                        }}
                      >
                        {isProcessing ? "..." : "Quitar"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={isProcessing}
                        onClick={() => handleShare(item)}
                        style={{
                          ...actionBtnStyle,
                          background: "rgba(168,85,247,0.12)",
                          border: "1px solid rgba(168,85,247,0.40)",
                          color: "#c084fc",
                          opacity: isProcessing ? 0.6 : 1,
                        }}
                      >
                        {isProcessing ? "..." : "Compartir"}
                      </button>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={handleFileChange}
      />
    </div>,
    document.body,
  );
}

function CameraIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="rgba(255,255,255,0.45)"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}
