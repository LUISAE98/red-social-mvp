"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { StoryDoc, StoryType } from "@/lib/stories/types";

const LABELS: Record<StoryType, string> = {
  saludo: "Saludo",
  consejo: "Consejo",
};

const VIBRA_RING = "linear-gradient(135deg, #ec4899 0%, #9333ea 52%, #3b82f6 100%)";
const VIEW_THRESHOLD_MS = 15_000;
const FONT =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';

type Props = {
  stories: StoryDoc[];
  type?: StoryType;
  onClose: () => void;
  /** Called when the last story is exhausted (tap-next or video ended). Separate from user-initiated close (swipe-down). Falls back to onClose if not provided. */
  onGroupFinished?: () => void;
  onStoryViewed?: (storyId: string) => void;
  initialIndex?: number;
  /** Render inline (no portal/backdrop). Parent provides sizing. */
  contained?: boolean;
  /** Called when user tries to navigate before the first story. */
  onPrevGroup?: () => void;
  /** When provided, renders a close button inside the panel calling this handler (used by carousel so the button animates with the panel). */
  onCloseCarousel?: () => void;
};

export function desktopPanelSize(): { width: number; height: number } {
  if (typeof window === "undefined") return { width: 380, height: 675 };
  const h = Math.min(Math.round(window.innerHeight * 0.86), 720);
  return { width: Math.round(h * 9 / 16), height: h };
}

export default function StoryViewer({
  stories,
  type,
  onClose,
  onGroupFinished,
  onStoryViewed,
  initialIndex = 0,
  contained = false,
  onPrevGroup,
  onCloseCarousel,
}: Props) {
  const [index, setIndex] = useState(initialIndex);
  const [progress, setProgress] = useState(0);
  const [videoReady, setVideoReady] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [resolvedPlaybackId, setResolvedPlaybackId] = useState<string | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);
  const [videoAspect, setVideoAspect] = useState<{ w: number; h: number } | null>(null);
  const [creator, setCreator] = useState<{ name: string | null; photo: string | null; handle: string | null } | null>(null);
  const [greetingAuthorHandle, setGreetingAuthorHandle] = useState<string | null>(null);
  const [muted, setMuted] = useState(() =>
    typeof window !== "undefined" && localStorage.getItem("vibra_stories_muted") === "1"
  );
  const [dragY, setDragY] = useState(0);
  const [isClosing, setIsClosing] = useState(false);

  const router = useRouter();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const progressRafRef = useRef<number | null>(null);
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const viewedInSessionRef = useRef<Set<string>>(new Set());
  const viewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const mql = window.matchMedia("(pointer: fine)");
    setIsDesktop(mql.matches);
    const h = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener("change", h);
    return () => mql.removeEventListener("change", h);
  }, []);

  useEffect(() => {
    const creatorId = stories[index]?.creatorId;
    if (!creatorId) return;
    getDoc(doc(db, "users", creatorId)).then((snap) => {
      const d = snap.data();
      setCreator({
        name: typeof d?.displayName === "string" ? d.displayName : null,
        photo: typeof d?.photoURL === "string" ? d.photoURL : null,
        handle: typeof d?.handle === "string" ? d.handle : null,
      });
    }).catch(() => {});
  }, [stories, index]);

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

  useEffect(() => {
    const pid = story?.muxPlaybackId ?? null;
    if (pid) { setResolvedPlaybackId(pid); return; }
    if (!story?.greetingRequestId) { setResolvedPlaybackId(null); return; }
    setResolvedPlaybackId(null);
    return onSnapshot(
      doc(db, "greetingRequests", story.greetingRequestId),
      (snap) => {
        const id = snap.data()?.muxPlaybackId as string | null | undefined;
        if (id) setResolvedPlaybackId(id);
      },
    );
  }, [story?.greetingRequestId, story?.muxPlaybackId]);

  // Resolve the handle of the greeting author (always the creator A, even when buyer B shared the story)
  useEffect(() => {
    const reqId = story?.greetingRequestId;
    if (!reqId) { setGreetingAuthorHandle(null); return; }
    setGreetingAuthorHandle(null);
    getDoc(doc(db, "greetingRequests", reqId)).then((reqSnap) => {
      const authorId = reqSnap.data()?.creatorId as string | undefined;
      if (!authorId) return;
      getDoc(doc(db, "users", authorId)).then((userSnap) => {
        const h = userSnap.data()?.handle;
        if (typeof h === "string") setGreetingAuthorHandle(h);
      }).catch(() => {});
    }).catch(() => {});
  }, [story?.greetingRequestId]);

  const goTo = useCallback(
    (nextIndex: number) => {
      if (nextIndex >= stories.length) { onGroupFinished ? onGroupFinished() : onClose(); return; }
      if (nextIndex < 0) { onPrevGroup?.(); return; }
      clearViewTimer();
      setIndex(nextIndex);
      setProgress(0);
      setVideoReady(false);
      setVideoAspect(null);
    },
    [stories.length, onClose, onGroupFinished, onPrevGroup, clearViewTimer],
  );

  useEffect(() => {
    clearViewTimer();
    setProgress(0);
    setVideoReady(false);
    if (videoRef.current) videoRef.current.currentTime = 0;
  }, [index, clearViewTimer]);

  useEffect(() => () => clearViewTimer(), [clearViewTimer]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoReady) return;
    const tick = () => {
      if (!video) return;
      const dur = video.duration;
      if (dur > 0) setProgress(video.currentTime / dur);
      progressRafRef.current = requestAnimationFrame(tick);
    };
    progressRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (progressRafRef.current !== null)
        cancelAnimationFrame(progressRafRef.current);
    };
  }, [videoReady, index]);

  const handleVideoPlay = useCallback(() => {
    if (!story || viewedInSessionRef.current.has(story.id)) return;
    clearViewTimer();
    const knownDur = story.videoDuration ?? (videoRef.current?.duration ?? null);
    if (knownDur !== null && knownDur < VIEW_THRESHOLD_MS / 1000) return;
    viewTimerRef.current = setTimeout(markCurrentViewed, VIEW_THRESHOLD_MS);
  }, [story, clearViewTimer, markCurrentViewed]);

  const handleVideoEnded = useCallback(() => {
    clearViewTimer();
    if ((videoRef.current?.duration ?? Infinity) < VIEW_THRESHOLD_MS / 1000)
      markCurrentViewed();
    setProgress(1);
    setTimeout(() => goTo(index + 1), 120);
  }, [index, goTo, clearViewTimer, markCurrentViewed]);

  useEffect(() => {
    if (contained) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") goTo(index + 1);
      if (e.key === "ArrowLeft") goTo(index - 1);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [index, goTo, onClose, contained]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0]?.clientX ?? null;
    touchStartYRef.current = e.touches[0]?.clientY ?? null;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (contained || touchStartYRef.current === null) return;
    const dy = (e.touches[0]?.clientY ?? touchStartYRef.current) - touchStartYRef.current;
    if (dy > 0) setDragY(dy);
  }, [contained]);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const startX = touchStartXRef.current;
      const startY = touchStartYRef.current;
      touchStartXRef.current = null;
      touchStartYRef.current = null;
      const endX = e.changedTouches[0]?.clientX ?? startX ?? 0;
      const endY = e.changedTouches[0]?.clientY ?? startY ?? 0;
      const dx = endX - (startX ?? endX);
      const dy = endY - (startY ?? endY);

      if (!contained && dy > 80 && dy > Math.abs(dx)) {
        setIsClosing(true);
        setDragY(window.innerHeight);
        setTimeout(onClose, 280);
        return;
      }
      setDragY(0);
      // Horizontal swipe (dx dominant, >50px) → change group directly
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
        if (dx < 0) {
          if (onGroupFinished) onGroupFinished(); else onClose();
        } else {
          onPrevGroup?.();
        }
        return;
      }
    },
    [onClose, onGroupFinished, onPrevGroup, contained],
  );

  if (!mounted || !story) return null;

  const effectiveType = type ?? story.type;

  function handleWantGreeting() {
    const closer = onCloseCarousel ?? onClose;
    // For group stories, open the group's purchase panel
    if (story.source === "group" && story.groupId) {
      closer();
      router.push(`/groups/${story.groupId}?service=${effectiveType}`);
    } else if (greetingAuthorHandle) {
      // Always navigate to the actual greeting creator (A), even if a buyer (B) shared the story
      closer();
      router.push(`/u/${greetingAuthorHandle}?service=${effectiveType}`);
    }
  }

  const videoProcessing = !resolvedPlaybackId;
  const videoUrl = resolvedPlaybackId
    ? `https://stream.mux.com/${resolvedPlaybackId}/high.mp4`
    : null;
  const label = LABELS[effectiveType];
  const isLandscape = !!videoAspect && videoAspect.w > videoAspect.h;
  const thumbUrl = resolvedPlaybackId
    ? `https://image.mux.com/${resolvedPlaybackId}/thumbnail.jpg?time=0`
    : null;

  // ── Shared avatar ring (desktop + mobile) ────────────────────────────────
  const avatarSz = isDesktop ? 40 : 54;
  const avatarInset = isDesktop ? 5 : 6;
  const avatarRing = (
    <div style={{ position: "relative", width: avatarSz, height: avatarSz, flexShrink: 0 }}>
      <div style={{ position: "absolute", inset: avatarInset, borderRadius: "50%", overflow: "hidden", background: "rgba(255,255,255,0.1)" }}>
        {creator?.photo
          ? <img src={creator.photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : <div style={{ width: "100%", height: "100%", background: "rgba(255,255,255,0.15)" }} />
        }
      </div>
      <div style={{
        position: "absolute", inset: 0, borderRadius: "50%",
        background: VIBRA_RING,
        WebkitMaskImage: "radial-gradient(farthest-side, transparent calc(100% - 2.5px), white calc(100% - 2.5px))",
        maskImage: "radial-gradient(farthest-side, transparent calc(100% - 2.5px), white calc(100% - 2.5px))",
      }} />
    </div>
  );

  // ── Shared panel content ──────────────────────────────────────────────────
  const renderPanelContent = (safeTop: string | number = 12, showClose = false, safeBottom: string | number = 0) => (
    <>
      {isLandscape && thumbUrl && (
        <div style={{
          position: "absolute", inset: 0,
          backgroundImage: `url(${thumbUrl})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          filter: "blur(28px) saturate(1.4) brightness(0.55)",
          transform: "scale(1.08)",
          zIndex: 0,
        }} />
      )}
      {videoUrl && (
        <video
          ref={videoRef}
          src={videoUrl}
          poster={thumbUrl ?? undefined}
          autoPlay
          playsInline
          muted={muted}
          onLoadedMetadata={() => {
            const v = videoRef.current;
            if (v && v.videoWidth > 0 && v.videoHeight > 0)
              setVideoAspect({ w: v.videoWidth, h: v.videoHeight });
          }}
          onLoadedData={() => setVideoReady(true)}
          onCanPlay={() => setVideoReady(true)}
          onPlay={handleVideoPlay}
          onEnded={handleVideoEnded}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: isLandscape ? "contain" : "cover", zIndex: 1 }}
        />
      )}

      {videoProcessing && (
        <div style={{ position: "absolute", inset: 0, zIndex: 3, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, background: "#0a0a0e" }}>
          <style>{`@keyframes storySpinner { to { transform: rotate(360deg); } }`}</style>
          <div style={{ width: 36, height: 36, borderRadius: "50%", border: "3px solid rgba(255,255,255,0.12)", borderTopColor: "#a855f7", animation: "storySpinner 0.8s linear infinite" }} />
          <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 13, fontFamily: FONT }}>Procesando video...</span>
        </div>
      )}

      {/* Progress bars */}
      <div style={{ position: "absolute", top: safeTop, left: 0, right: 0, paddingTop: 12, paddingLeft: 10, paddingRight: 10, display: "flex", gap: 4, zIndex: 10 }}>
        {stories.map((_, i) => (
          <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: "rgba(255,255,255,0.3)", overflow: "hidden" }}>
            <div style={{ height: "100%", borderRadius: 2, background: "#fff", width: i < index ? "100%" : i === index ? `${Math.round(progress * 100)}%` : "0%", transition: i === index ? "none" : undefined }} />
          </div>
        ))}
      </div>

      {/* Creator header */}
      <div style={{ position: "absolute", top: typeof safeTop === "number" ? safeTop + 36 : `calc(${safeTop} + 36px)`, left: 12, zIndex: 10, display: "flex", alignItems: "center", gap: isDesktop ? 6 : 8 }}>
        {avatarRing}
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={{ color: "#fff", fontSize: isDesktop ? 13 : 17, fontWeight: 600, lineHeight: "1.2", fontFamily: FONT }}>{creator?.name ?? ""}</span>
          <span style={{ color: "rgba(255,255,255,0.75)", fontSize: isDesktop ? 11 : 13, fontWeight: 500, lineHeight: "1.2", fontFamily: FONT }}>{label}</span>
        </div>
      </div>

      {/* Tap zones */}
      <button type="button" aria-label="Historia anterior" onClick={() => goTo(index - 1)} style={{ position: "absolute", top: 0, left: 0, width: "35%", height: "100%", background: "none", border: "none", cursor: index > 0 ? "w-resize" : "default", zIndex: 5 }} />
      <button type="button" aria-label="Historia siguiente" onClick={() => goTo(index + 1)} style={{ position: "absolute", top: 0, right: 0, width: "65%", height: "100%", background: "none", border: "none", cursor: "e-resize", zIndex: 5 }} />

      {(showClose || onCloseCarousel) && (
        <div
          style={{
            position: "absolute",
            top: typeof safeTop === "number"
              ? safeTop + 28 + avatarSz / 2
              : `calc(${safeTop} + ${28 + avatarSz / 2}px)`,
            right: 10,
            transform: "translateY(-50%)",
            display: "flex",
            alignItems: "center",
            gap: 4,
            zIndex: 11,
          }}
        >
          {/* Mute / unmute */}
          <button
            type="button"
            aria-label={muted ? "Activar sonido" : "Silenciar"}
            onClick={(e) => {
              e.stopPropagation();
              setMuted((m) => {
                const next = !m;
                localStorage.setItem("vibra_stories_muted", next ? "1" : "0");
                return next;
              });
            }}
            style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.9)", padding: "0 5px", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            {muted ? (
              <svg width={isDesktop ? 20 : 24} height={isDesktop ? 20 : 24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                <line x1="23" y1="9" x2="17" y2="15"/>
                <line x1="17" y1="9" x2="23" y2="15"/>
              </svg>
            ) : (
              <svg width={isDesktop ? 20 : 24} height={isDesktop ? 20 : 24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
              </svg>
            )}
          </button>
          {/* Close */}
          <button
            type="button"
            aria-label="Cerrar"
            onClick={onCloseCarousel ?? onClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.9)", padding: "0 5px", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <svg width={isDesktop ? 20 : 24} height={isDesktop ? 20 : 24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      )}

      {/* Bottom action buttons */}
      <div
        style={{
          position: "absolute",
          left: 14,
          right: 14,
          bottom: typeof safeBottom === "number"
            ? safeBottom + 20
            : `calc(${safeBottom} + 20px)`,
          display: "flex",
          gap: 10,
          zIndex: 10,
        }}
      >
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          style={{
            flex: 1,
            padding: isDesktop ? "8px 10px" : "11px 10px",
            borderRadius: 10,
            border: "none",
            background: "#60a5fa",
            color: "#fff",
            fontSize: isDesktop ? 12 : 14,
            fontWeight: 600,
            fontFamily: FONT,
            cursor: "pointer",
            letterSpacing: "-0.01em",
          }}
        >
          Contexto
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); handleWantGreeting(); }}
          style={{
            flex: 1,
            padding: isDesktop ? "8px 10px" : "11px 10px",
            borderRadius: 10,
            border: "none",
            background: "linear-gradient(135deg, #f472b6 0%, #a855f7 100%)",
            color: "#fff",
            fontSize: isDesktop ? 12 : 14,
            fontWeight: 600,
            fontFamily: FONT,
            cursor: "pointer",
            letterSpacing: "-0.01em",
          }}
        >
          {effectiveType === "saludo" ? "Quiero mi saludo" : "Quiero mi consejo"}
        </button>
      </div>
    </>
  );

  // ── Contained mode (used by HomeStoryCarousel) ────────────────────────────
  if (contained) {
    return (
      <div
        style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", background: "#000" }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {renderPanelContent(12, false)}
      </div>
    );
  }

  // ── Desktop: centered modal ───────────────────────────────────────────────
  if (isDesktop) {
    const { width: panelW, height: panelH } = desktopPanelSize();
    return createPortal(
      <div style={{ position: "fixed", inset: 0, zIndex: 99999, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
        <div style={{ position: "relative", width: panelW, height: panelH, borderRadius: 18, overflow: "hidden", background: "#000", flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
          {renderPanelContent(12, true)}
        </div>
      </div>,
      document.body,
    );
  }

  // ── Mobile: fullscreen, swipe down to close ───────────────────────────────
  return createPortal(
    <div
      style={{ position: "fixed", inset: 0, zIndex: 99999, background: "#000", display: "flex", flexDirection: "column", touchAction: "none", transform: `translateY(${dragY}px)`, transition: !isClosing && dragY > 0 ? "none" : "transform 0.28s ease, opacity 0.28s ease", opacity: 1 - Math.min(1, dragY / 300) }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {renderPanelContent("env(safe-area-inset-top, 0px)", true, "env(safe-area-inset-bottom, 0px)")}
    </div>,
    document.body,
  );
}
