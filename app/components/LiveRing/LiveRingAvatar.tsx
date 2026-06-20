"use client";

import Image from "next/image";
import { useCallback, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useLiveRingState } from "@/lib/live/useLiveRingState";
import StoryRingAvatar from "@/app/components/Stories/StoryRingAvatar";
import type { Post } from "@/lib/posts/types";
import dynamic from "next/dynamic";

const LiveViewerModal = dynamic(
  () => import("@/app/components/LiveViewerModal/LiveViewerModal"),
  { ssr: false }
);

const LIVE_RED = "#ef4444";
const GAP_COLOR = "rgb(10,10,14)";
const FONT =
  'inherit';

type Props = {
  entityId: string;
  entityType: "profile" | "group";
  currentUserId?: string | null;
  photoURL?: string | null;
  displayName: string;
  size?: number;
  onClick?: (e: React.MouseEvent) => void;
  style?: React.CSSProperties;
};

export default function LiveRingAvatar({
  entityId,
  entityType,
  currentUserId,
  photoURL,
  displayName,
  size = 40,
  onClick,
  style,
}: Props) {
  const { isLive, livePostId } = useLiveRingState(entityId, entityType);
  const [livePost, setLivePost] = useState<Post | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [fetching, setFetching] = useState(false);

  const handleLiveClick = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!livePostId || fetching) return;
      setFetching(true);
      try {
        const snap = await getDoc(doc(db, "posts", livePostId));
        if (snap.exists()) {
          setLivePost({ id: snap.id, ...snap.data() } as Post);
          setViewerOpen(true);
        }
      } catch {
        // silencioso — el live puede haber terminado justo antes del clic
      } finally {
        setFetching(false);
      }
    },
    [livePostId, fetching]
  );

  // Sin live activo → delegar a StoryRingAvatar (historias o sin anillo)
  if (!isLive) {
    return (
      <StoryRingAvatar
        entityId={entityId}
        entityType={entityType}
        currentUserId={currentUserId}
        photoURL={photoURL}
        displayName={displayName}
        size={size}
        onClick={onClick}
        style={style}
      />
    );
  }

  const padding = 2.5;
  const initials = (() => {
    const parts = displayName.trim().split(/\s+/).filter(Boolean);
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
  })();

  const badgeSize = Math.max(7, Math.round(size * 0.13));
  const badgePad = `1px ${Math.max(3, Math.round(badgeSize * 0.5))}px`;

  return (
    <>
      {/* Wrapper con overflow visible para que el badge no se corte */}
      <div
        style={{
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          width: size,
          height: size,
          ...style,
        }}
      >
        <button
          type="button"
          onClick={handleLiveClick}
          disabled={fetching}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            margin: 0,
            cursor: fetching ? "wait" : "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: size,
            height: size,
            WebkitTapHighlightColor: "transparent",
            flexShrink: 0,
          }}
          aria-label={`Ver live de ${displayName}`}
        >
          {/* Anillo rojo */}
          <div
            style={{
              width: "100%",
              height: "100%",
              borderRadius: "50%",
              background: LIVE_RED,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding,
              boxSizing: "border-box",
            }}
          >
            {/* Avatar */}
            <div
              style={{
                width: "100%",
                height: "100%",
                borderRadius: "50%",
                border: `1.5px solid ${GAP_COLOR}`,
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

        {/* Badge LIVE — etiqueta con esquinas redondeadas, dentro del anillo */}
        <div
          onClick={handleLiveClick}
          style={{
            position: "absolute",
            bottom: Math.max(2, Math.round(size * 0.05)),
            left: "50%",
            transform: "translateX(-50%)",
            background: LIVE_RED,
            color: "#fff",
            fontSize: badgeSize,
            fontWeight: 700,
            letterSpacing: "0.06em",
            padding: badgePad,
            borderRadius: Math.max(2, Math.round(badgeSize * 0.35)),
            lineHeight: 1,
            whiteSpace: "nowrap",
            cursor: fetching ? "wait" : "pointer",
            zIndex: 2,
            fontFamily: FONT,
            pointerEvents: "auto",
          }}
        >
          LIVE
        </div>
      </div>

      {viewerOpen && livePost && (
        <LiveViewerModal
          open={viewerOpen}
          onClose={() => {
            setViewerOpen(false);
            setLivePost(null);
          }}
          post={livePost}
        />
      )}
    </>
  );
}
