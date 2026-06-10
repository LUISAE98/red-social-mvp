"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { StoryDoc, StoryType } from "@/lib/stories/types";

const LABELS: Record<StoryType, string> = {
  saludo: "Saludo",
  consejo: "Consejo",
};

const GRADIENTS: Record<StoryType, string> = {
  saludo: "linear-gradient(135deg, #a855f7 0%, #ec4899 60%, #f97316 100%)",
  consejo: "linear-gradient(135deg, #f59e0b 0%, #f97316 60%, #ef4444 100%)",
};

const VIEW_THRESHOLD_MS = 15_000;

type Props = {
  stories: StoryDoc[];
  type?: StoryType; // optional — falls back to story.type per story
  onClose: () => void;
  onStoryViewed?: (storyId: string) => void;
  initialIndex?: number; // open at this story index (default 0)
};

function formatRelativeDate(ts: StoryDoc["createdAt"]): string {
  if (!ts) return "";
  try {
    const date = ts.toDate();
    const diffMs = Date.now() - date.getTime();
    const diffH = Math.floor(diffMs / 3600000);
    const diffD = Math.floor(diffH / 24);
    if (diffD >= 1) return `Hace ${diffD} ${diffD === 1 ? "día" : "días"}`;
    if (diffH >= 1) return `Hace ${diffH} ${diffH === 1 ? "hora" : "horas"}`;
    return "Hace un momento";
  } catch {
    return "";
  }
}

export default function StoryViewer({ stories, type, onClose, onStoryViewed, initialIndex = 0 }: Props) {
  const [index, setIndex] = useState(initialIndex);
  const [progress, setProgress] = useState(0);
  const [videoReady, setVideoReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const progressRafRef = useRef<number | null>(null);
  const touchStartXRef = useRef<number | null>(null);
  const [mounted, setMounted] = useState(false);
  const [resolvedPlaybackId, setResolvedPlaybackId] = useState<string | null>(null);

  // View tracking — per-session set of already-recorded story IDs
  const viewedInSessionRef = useRef<Set<string>>(new Set());
  const viewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setMounted(true); }, []);

  const story = stories[index];

  const clearViewTimer = useCallback(() => {
    if (viewTimerRef.current !== null) {
      clearTimeout(viewTimerRef.current);
      viewTimerRef.current = null;
    }
  }, []);

  const markCurrentViewed = useCallback(() => {
    if (!story || viewedInSessionRef.current.has(story.id)) return;
    viewedInSessionRef.current.add(story.id);
    onStoryViewed?.(story.id);
  }, [story, onStoryViewed]);

  // If current story has no muxPlaybackId yet, listen to its greetingRequest doc
  useEffect(() => {
    const pid = story?.muxPlaybackId ?? null;
    if (pid) {
      setResolvedPlaybackId(pid);
      return;
    }
    if (!story?.greetingRequestId) {
      setResolvedPlaybackId(null);
      return;
    }
    setResolvedPlaybackId(null);
    const unsub = onSnapshot(
      doc(db, "greetingRequests", story.greetingRequestId),
      (snap) => {
        const data = snap.data();
        const id = data?.muxPlaybackId as string | null | undefined;
        if (id) setResolvedPlaybackId(id);
      },
    );
    return unsub;
  }, [story?.greetingRequestId, story?.muxPlaybackId]);

  const goTo = useCallback(
    (nextIndex: number) => {
      if (nextIndex >= stories.length) {
        onClose();
        return;
      }
      if (nextIndex < 0) return;
      clearViewTimer();
      setIndex(nextIndex);
      setProgress(0);
      setVideoReady(false);
    },
    [stories.length, onClose, clearViewTimer],
  );

  // Reset when story changes
  useEffect(() => {
    clearViewTimer();
    setProgress(0);
    setVideoReady(false);
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
    }
  }, [index, clearViewTimer]);

  // Cleanup timer on unmount
  useEffect(() => () => clearViewTimer(), [clearViewTimer]);

  // Progress animation driven by video currentTime
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoReady) return;

    const tick = () => {
      if (!video) return;
      const dur = video.duration;
      if (dur > 0) {
        setProgress(video.currentTime / dur);
      }
      progressRafRef.current = requestAnimationFrame(tick);
    };

    progressRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (progressRafRef.current !== null) {
        cancelAnimationFrame(progressRafRef.current);
      }
    };
  }, [videoReady, index]);

  // Start view timer when video begins playing
  const handleVideoPlay = useCallback(() => {
    if (!story || viewedInSessionRef.current.has(story.id)) return;
    clearViewTimer();
    // If video is short (< 15s), handled by onEnded instead
    const knownDuration = story.videoDuration ?? (videoRef.current?.duration ?? null);
    if (knownDuration !== null && knownDuration < VIEW_THRESHOLD_MS / 1000) return;
    viewTimerRef.current = setTimeout(markCurrentViewed, VIEW_THRESHOLD_MS);
  }, [story, clearViewTimer, markCurrentViewed]);

  // Advance to next when video ends; also mark short videos as viewed
  const handleVideoEnded = useCallback(() => {
    clearViewTimer();
    const dur = videoRef.current?.duration ?? Infinity;
    if (dur < VIEW_THRESHOLD_MS / 1000) {
      markCurrentViewed();
    }
    setProgress(1);
    setTimeout(() => goTo(index + 1), 120);
  }, [index, goTo, clearViewTimer, markCurrentViewed]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") goTo(index + 1);
      if (e.key === "ArrowLeft") goTo(index - 1);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [index, goTo, onClose]);

  if (!mounted || !story) return null;

  const effectiveType = type ?? story.type;
  const videoProcessing = !resolvedPlaybackId;
  const videoUrl = resolvedPlaybackId
    ? `https://stream.mux.com/${resolvedPlaybackId}/high.mp4`
    : null;
  const gradient = GRADIENTS[effectiveType];
  const label = LABELS[effectiveType];

  const content = (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        background: "#000",
        display: "flex",
        flexDirection: "column",
        touchAction: "none",
      }}
      onTouchStart={(e) => {
        touchStartXRef.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        const startX = touchStartXRef.current;
        if (startX === null) return;
        const endX = e.changedTouches[0]?.clientX ?? startX;
        const dx = endX - startX;
        if (Math.abs(dx) > 40) {
          goTo(dx < 0 ? index + 1 : index - 1);
        }
        touchStartXRef.current = null;
      }}
    >
      {/* Progress bars */}
      <div
        style={{
          position: "absolute",
          top: "env(safe-area-inset-top, 12px)",
          left: 0,
          right: 0,
          paddingTop: 12,
          paddingLeft: 10,
          paddingRight: 10,
          display: "flex",
          gap: 4,
          zIndex: 10,
        }}
      >
        {stories.map((_, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: 3,
              borderRadius: 2,
              background: "rgba(255,255,255,0.3)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                borderRadius: 2,
                background: "#fff",
                width:
                  i < index
                    ? "100%"
                    : i === index
                      ? `${Math.round(progress * 100)}%`
                      : "0%",
                transition: i === index ? "none" : undefined,
              }}
            />
          </div>
        ))}
      </div>

      {/* Video — only rendered once muxPlaybackId is resolved */}
      {videoUrl ? (
        <video
          ref={videoRef}
          src={videoUrl}
          autoPlay
          playsInline
          onLoadedData={() => setVideoReady(true)}
          onCanPlay={() => setVideoReady(true)}
          onPlay={handleVideoPlay}
          onEnded={handleVideoEnded}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "contain",
            background: "#000",
          }}
        />
      ) : null}

      {/* Processing overlay — shown while Mux is still encoding */}
      {videoProcessing && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 14,
            background: "#0a0a0e",
            zIndex: 3,
          }}
        >
          <style>{`
            @keyframes storySpinner {
              to { transform: rotate(360deg); }
            }
          `}</style>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              border: "3px solid rgba(255,255,255,0.12)",
              borderTopColor: "#a855f7",
              animation: "storySpinner 0.8s linear infinite",
            }}
          />
          <span
            style={{
              color: "rgba(255,255,255,0.55)",
              fontSize: 13,
              fontFamily:
                '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
            }}
          >
            Procesando video...
          </span>
        </div>
      )}

      {/* Type badge */}
      <div
        style={{
          position: "absolute",
          top: "calc(env(safe-area-inset-top, 0px) + 32px)",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 10,
          background: "rgba(0,0,0,0.5)",
          backdropFilter: "blur(8px)",
          borderRadius: 20,
          padding: "4px 12px",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: gradient,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            color: "#fff",
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: "-0.01em",
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
          }}
        >
          {label}
        </span>
        <span
          style={{
            color: "rgba(255,255,255,0.5)",
            fontSize: 11,
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
          }}
        >
          {formatRelativeDate(story.createdAt)}
        </span>
      </div>

      {/* Tap zones */}
      <button
        type="button"
        aria-label="Historia anterior"
        onClick={() => goTo(index - 1)}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "35%",
          height: "100%",
          background: "none",
          border: "none",
          cursor: index > 0 ? "w-resize" : "default",
          zIndex: 5,
        }}
      />
      <button
        type="button"
        aria-label="Historia siguiente"
        onClick={() => goTo(index + 1)}
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          width: "65%",
          height: "100%",
          background: "none",
          border: "none",
          cursor: "e-resize",
          zIndex: 5,
        }}
      />

      {/* Close */}
      <button
        type="button"
        aria-label="Cerrar"
        onClick={onClose}
        style={{
          position: "absolute",
          top: "calc(env(safe-area-inset-top, 0px) + 30px)",
          right: 14,
          width: 32,
          height: 32,
          borderRadius: "50%",
          background: "rgba(0,0,0,0.5)",
          border: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          zIndex: 11,
          color: "#fff",
          fontSize: 18,
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  );

  return createPortal(content, document.body);
}
