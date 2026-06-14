"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { StoryDoc, StoryType } from "@/lib/stories/types";
import { createGreetingRequest } from "@/lib/greetings/greetingRequests";
import CreatorServiceModals from "@/components/services/CreatorServiceModals";

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
  const [greetingAuthorUid, setGreetingAuthorUid] = useState<string | null>(null);
  const [greetingAuthorName, setGreetingAuthorName] = useState<string | null>(null);
  const [greetOpen, setGreetOpen] = useState(false);
  const [greetToName, setGreetToName] = useState("");
  const [greetInstructions, setGreetInstructions] = useState("");
  const [greetAllowStory, setGreetAllowStory] = useState(false);
  const [greetSubmitting, setGreetSubmitting] = useState(false);
  const [greetError, setGreetError] = useState<string | null>(null);
  const [greetSuccess, setGreetSuccess] = useState<string | null>(null);
  const [muted, setMuted] = useState(() =>
    typeof window !== "undefined" && localStorage.getItem("vibra_stories_muted") === "1"
  );
  const [dragY, setDragY] = useState(0);
  const [isClosing, setIsClosing] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [instructions, setInstructions] = useState<string | null>(null);
  const [speechState, setSpeechState] = useState<"idle" | "playing" | "paused">("idle");
  const [speechHighlight, setSpeechHighlight] = useState<{ start: number; length: number } | null>(null);
  const contextDragStartY = useRef<number | null>(null);
  const speechOffsetRef = useRef(0);
  const speechGenRef = useRef(0);
  const speechTextRef = useRef<HTMLParagraphElement>(null);
  const speechCursorRef = useRef<HTMLSpanElement>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const progressRafRef = useRef<number | null>(null);
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const viewedInSessionRef = useRef<Set<string>>(new Set());
  const viewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdingRef = useRef(false);

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

  // Read instructions — from story doc (new stories) or greetingRequest fallback (A/B only)
  useEffect(() => {
    if (story?.instructions) { setInstructions(story.instructions); return; }
    if (!story?.greetingRequestId) { setInstructions(null); return; }
    setInstructions(null);
    getDoc(doc(db, "greetingRequests", story.greetingRequestId))
      .then((snap) => {
        const instr = snap.data()?.instructions;
        if (typeof instr === "string" && instr) setInstructions(instr);
      })
      .catch(() => {});
  }, [story?.instructions, story?.greetingRequestId]);

  // Resolve the actual greeting creator (A) from the story doc itself (no greetingRequests read needed)
  useEffect(() => {
    const authorId = story?.greetingCreatorId ?? story?.creatorId ?? null;
    if (!authorId) { setGreetingAuthorUid(null); setGreetingAuthorName(null); return; }
    setGreetingAuthorUid(authorId);
    getDoc(doc(db, "users", authorId)).then((snap) => {
      const name = snap.data()?.displayName;
      if (typeof name === "string") setGreetingAuthorName(name);
    }).catch(() => {});
  }, [story?.greetingCreatorId, story?.creatorId]);

  const startSpeechFrom = useCallback((charIndex: number) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const text = instructions ?? "Sin contexto disponible.";
    window.speechSynthesis.cancel();
    speechOffsetRef.current = charIndex;
    const gen = ++speechGenRef.current;
    // Pre-bold everything before the seek point
    setSpeechHighlight(charIndex > 0 ? { start: charIndex, length: 0 } : null);
    const utterance = new SpeechSynthesisUtterance(text.slice(charIndex));
    utterance.lang = "es-MX";
    utterance.rate = 1.5;
    utterance.pitch = 1;
    utterance.onboundary = (e) => {
      if (speechGenRef.current !== gen) return;
      if (e.name !== "word") return;
      const absIndex = charIndex + e.charIndex;
      const fromIndex = text.slice(absIndex);
      const spaceAt = fromIndex.search(/[\s\n]/);
      const length = e.charLength ?? (spaceAt === -1 ? fromIndex.length : spaceAt);
      setSpeechHighlight({ start: absIndex, length });
    };
    utterance.onend = () => {
      if (speechGenRef.current !== gen) return;
      setSpeechState("idle");
      setSpeechHighlight(null);
      setContextOpen(false);
    };
    utterance.onerror = () => {
      if (speechGenRef.current !== gen) return;
      setSpeechState("idle");
      setSpeechHighlight(null);
    };
    window.speechSynthesis.speak(utterance);
    setSpeechState("playing");
  }, [instructions]);

  const handleToggleSpeech = useCallback(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    if (speechState === "playing") {
      window.speechSynthesis.pause();
      setSpeechState("paused");
      return;
    }
    if (speechState === "paused") {
      window.speechSynthesis.resume();
      setSpeechState("playing");
      return;
    }
    startSpeechFrom(0);
  }, [speechState, startSpeechFrom]);

  const handleTextSeek = useCallback((e: React.MouseEvent<HTMLParagraphElement>) => {
    e.stopPropagation();
    const x = e.clientX;
    const y = e.clientY;
    let charIndex = 0;
    const el = speechTextRef.current;
    if (el) {
      try {
        let range: Range | null = null;
        if ("caretRangeFromPoint" in document) {
          range = (document as Document & { caretRangeFromPoint(x: number, y: number): Range | null }).caretRangeFromPoint(x, y);
        } else if ("caretPositionFromPoint" in document) {
          const d = document as Document & { caretPositionFromPoint(x: number, y: number): { offsetNode: Node; offset: number } | null };
          const pos = d.caretPositionFromPoint(x, y);
          if (pos) { range = d.createRange(); range.setStart(pos.offsetNode, pos.offset); }
        }
        if (range) {
          const pre = document.createRange();
          pre.selectNodeContents(el);
          pre.setEnd(range.startContainer, range.startOffset);
          charIndex = pre.toString().length;
        }
      } catch { /* unsupported */ }
    }
    startSpeechFrom(charIndex);
  }, [startSpeechFrom]);

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
    setContextOpen(false);
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    speechGenRef.current++;
    setSpeechState("idle");
    setSpeechHighlight(null);
    if (videoRef.current) videoRef.current.currentTime = 0;
  }, [index, clearViewTimer]);

  // Cancel speech when panel closes or component unmounts
  useEffect(() => {
    if (!contextOpen && typeof window !== "undefined") {
      window.speechSynthesis?.cancel();
      speechGenRef.current++;
      setSpeechState("idle");
      setSpeechHighlight(null);
    }
  }, [contextOpen]);
  useEffect(() => () => { speechGenRef.current++; window.speechSynthesis?.cancel(); }, []);

  useEffect(() => {
    const cursor = speechCursorRef.current;
    // The <p> itself isn't scrollable — its parent div has overflowY: auto
    const container = speechTextRef.current?.parentElement ?? null;
    if (!cursor || !container || !speechHighlight) return;
    const containerRect = container.getBoundingClientRect();
    const cursorRect = cursor.getBoundingClientRect();
    const cursorBottom = cursorRect.bottom - containerRect.top + container.scrollTop;
    const cursorTop = cursorRect.top - containerRect.top + container.scrollTop;
    if (cursorBottom > container.scrollTop + container.clientHeight) {
      container.scrollTop = cursorBottom - container.clientHeight + 8;
    } else if (cursorTop < container.scrollTop) {
      container.scrollTop = cursorTop - 8;
    }
  }, [speechHighlight]);

  useEffect(() => () => clearViewTimer(), [clearViewTimer]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (greetOpen || contextOpen) { video.pause(); } else { video.play().catch(() => {}); }
  }, [greetOpen, contextOpen]);


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
    if (!greetOpen && videoRef.current) {
      holdingRef.current = true;
      videoRef.current.pause();
    }
  }, [greetOpen]);

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
        holdingRef.current = false;
        setIsClosing(true);
        setDragY(window.innerHeight);
        setTimeout(onClose, 280);
        return;
      }
      setDragY(0);
      // Horizontal swipe (dx dominant, >50px) → change group directly
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
        holdingRef.current = false;
        if (dx < 0) {
          if (onGroupFinished) onGroupFinished(); else onClose();
        } else {
          onPrevGroup?.();
        }
        return;
      }
      // Tap or lift with no swipe → resume video
      if (holdingRef.current) {
        holdingRef.current = false;
        if (!greetOpen && videoRef.current) {
          videoRef.current.play().catch(() => {});
        }
      }
    },
    [onClose, onGroupFinished, onPrevGroup, contained, greetOpen],
  );

  if (!mounted || !story) return null;

  const effectiveType = type ?? story.type;

  function handleWantGreeting() {
    setGreetToName("");
    setGreetInstructions("");
    setGreetAllowStory(false);
    setGreetError(null);
    setGreetSuccess(null);
    setGreetOpen(true);
  }

  function resetGreetModal() {
    setGreetOpen(false);
    setGreetSubmitting(false);
    setGreetError(null);
    setGreetSuccess(null);
  }

  async function handleSubmitGreeting() {
    if (greetSubmitting || !greetToName.trim() || !greetInstructions.trim()) return;
    setGreetSubmitting(true);
    setGreetError(null);
    try {
      await createGreetingRequest({
        creatorId: greetingAuthorUid,
        profileUserId: greetingAuthorUid,
        type: effectiveType,
        toName: greetToName.trim(),
        instructions: greetInstructions.trim(),
        source: story.source === "group" ? "group" : "profile",
        groupId: story.source === "group" ? story.groupId : null,
        allowCreatorStory: greetAllowStory,
      });
      setGreetSuccess("¡Solicitud enviada! El creador la revisará pronto.");
    } catch (err: unknown) {
      setGreetError(err instanceof Error ? err.message : "Error al enviar la solicitud.");
    } finally {
      setGreetSubmitting(false);
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
      {/* Prevent long-press text selection and iOS callout on the story viewer */}
      <style>{`
        .story-viewer-root, .story-viewer-root * {
          -webkit-touch-callout: none;
          -webkit-user-select: none;
          user-select: none;
        }
      `}</style>
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

      {/* Creator header — clickable link to profile when handle is available */}
      {(() => {
        const profileHref = creator?.handle ? `/u/${creator.handle}` : null;
        const headerStyle: React.CSSProperties = {
          position: "absolute",
          top: typeof safeTop === "number" ? safeTop + 36 : `calc(${safeTop} + 36px)`,
          left: 12,
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          gap: isDesktop ? 6 : 8,
          textDecoration: "none",
          WebkitTapHighlightColor: "transparent",
          cursor: profileHref ? "pointer" : "default",
        };
        const inner = (
          <>
            {avatarRing}
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <span style={{ color: "#fff", fontSize: isDesktop ? 13 : 17, fontWeight: 600, lineHeight: "1.2", fontFamily: FONT }}>{creator?.name ?? ""}</span>
              <span style={{ color: "rgba(255,255,255,0.75)", fontSize: isDesktop ? 11 : 13, fontWeight: 500, lineHeight: "1.2", fontFamily: FONT }}>{label}</span>
            </div>
          </>
        );
        return profileHref
          ? <Link href={profileHref} onClick={(e) => e.stopPropagation()} style={headerStyle}>{inner}</Link>
          : <div style={headerStyle}>{inner}</div>;
      })()}

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

      {/* Bottom: floating context panel + floating buttons */}
      {(() => {
        const btnPadBottom = typeof safeBottom === "string"
          ? `max(8px, ${safeBottom})`
          : "8px";
        return (
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              display: "flex",
              flexDirection: "column",
              zIndex: 10,
            }}
          >
            {/* Floating context panel — above buttons */}
            <div
              style={{
                margin: `0 14px ${contextOpen ? 8 : 0}px`,
                borderRadius: 16,
                overflow: "hidden",
                maxHeight: contextOpen ? "50vh" : "0px",
                transition: "max-height 0.28s cubic-bezier(0.4,0,0.2,1), margin-bottom 0.28s",
                boxShadow: contextOpen ? "0 8px 32px rgba(0,0,0,0.5)" : "none",
                backdropFilter: "blur(14px) saturate(1.2)",
                WebkitBackdropFilter: "blur(14px) saturate(1.2)",
              }}
              onTouchStart={(e) => {
                e.stopPropagation();
                contextDragStartY.current = e.touches[0]?.clientY ?? null;
              }}
              onTouchMove={(e) => e.stopPropagation()}
              onTouchEnd={(e) => {
                e.stopPropagation();
                const startY = contextDragStartY.current;
                contextDragStartY.current = null;
                if (startY === null) return;
                const dy = (e.changedTouches[0]?.clientY ?? startY) - startY;
                if (dy > 40) setContextOpen(false);
              }}
            >
              <div
                style={{
                  background: "rgba(37,99,235,0.62)",
                  border: "1px solid rgba(255,255,255,0.18)",
                  borderRadius: 16,
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                {/* Header row: play/stop + close — always visible */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "8px 10px 4px", flexShrink: 0 }}>
                  <button
                    type="button"
                    aria-label={speechState === "playing" ? "Pausar lectura" : speechState === "paused" ? "Reanudar lectura" : "Leer contexto"}
                    onTouchStart={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); handleToggleSpeech(); }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.85)", padding: 4, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginRight: 6, transition: "color 0.15s" }}
                  >
                    {speechState === "playing" ? (
                      <svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor">
                        <rect x="5" y="4" width="4" height="16" rx="1"/>
                        <rect x="15" y="4" width="4" height="16" rx="1"/>
                      </svg>
                    ) : (
                      <svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="5,3 19,12 5,21"/>
                      </svg>
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label="Cerrar contexto"
                    onTouchStart={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); setContextOpen(false); }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.75)", padding: 4, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                  >
                    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                </div>
                {/* Scrollable text area */}
                <div style={{ overflowY: "auto", maxHeight: "calc(50vh - 44px)" }}>
                  <p
                    ref={speechTextRef}
                    onClick={handleTextSeek}
                    style={{
                      margin: "4px 18px 14px",
                      color: "rgba(255,255,255,0.88)",
                      fontSize: isDesktop ? 13 : 15,
                      fontFamily: FONT,
                      lineHeight: 1.55,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      cursor: "text",
                      userSelect: "none",
                    }}
                  >
                    {(() => {
                      const text = instructions ?? "Sin contexto disponible.";
                      if (speechState === "idle" || !speechHighlight) return text;
                      const { start, length } = speechHighlight;
                      return (
                        <>
                          <strong style={{ color: "#fff", fontWeight: 700 }}>{text.slice(0, start + length)}</strong>
                          <span ref={speechCursorRef} />
                          {text.slice(start + length)}
                        </>
                      );
                    })()}
                  </p>
                </div>
              </div>
            </div>

            {/* Buttons row */}
            <div style={{ display: "flex", gap: 10, padding: `0 14px`, paddingBottom: btnPadBottom }}>
              <button
                type="button"
                onTouchStart={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); setContextOpen((v) => !v); }}
                style={{
                  flex: 1,
                  padding: isDesktop ? "8px 10px" : "11px 10px",
                  borderRadius: 10,
                  border: "none",
                  background: contextOpen ? "#3b82f6" : "#60a5fa",
                  color: "#fff",
                  fontSize: isDesktop ? 12 : 14,
                  fontWeight: 600,
                  fontFamily: FONT,
                  cursor: "pointer",
                  letterSpacing: "-0.01em",
                  transition: "background 0.15s",
                }}
              >
                Contexto
              </button>
              <button
                type="button"
                onTouchStart={(e) => e.stopPropagation()}
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
          </div>
        );
      })()}

    </>
  );

  // ── Shared: greeting purchase modal (renders above everything via its own portal) ──
  const greetModal = (
    <CreatorServiceModals
      greetOpen={greetOpen}
      greetSubmitting={greetSubmitting}
      greetType={effectiveType}
      creatorName={greetingAuthorName ?? undefined}
      toName={greetToName}
      instructions={greetInstructions}
      greetError={greetError}
      greetSuccess={greetSuccess}
      onCloseGreeting={resetGreetModal}
      onSubmitGreeting={handleSubmitGreeting}
      onChangeToName={setGreetToName}
      onChangeInstructions={setGreetInstructions}
      allowCreatorStory={greetAllowStory}
      onChangeAllowCreatorStory={setGreetAllowStory}
      meetGreetOpen={false}
      meetGreetSubmitting={false}
      meetGreetMessage=""
      meetGreetError={null}
      meetGreetPriceLabel=""
      meetGreetDurationLabel=""
      onCloseMeetGreet={() => {}}
      onSubmitMeetGreet={() => {}}
      onChangeMeetGreetMessage={() => {}}
      exclusiveSessionOpen={false}
      exclusiveSessionSubmitting={false}
      exclusiveSessionMessage=""
      exclusiveSessionError={null}
      exclusiveSessionPriceLabel=""
      exclusiveSessionDurationLabel=""
      onCloseExclusiveSession={() => {}}
      onSubmitExclusiveSession={() => {}}
      onChangeExclusiveSessionMessage={() => {}}
      serviceToast={null}
      subtitleStyle={{ fontSize: 16, fontWeight: 600, lineHeight: 1.2, color: "#fff", fontFamily: FONT }}
      textStyle={{ fontSize: 12, fontWeight: 400, lineHeight: 1.4, color: "rgba(255,255,255,0.70)", fontFamily: FONT }}
      microText={{ fontSize: 12, fontWeight: 400, lineHeight: 1.4, color: "rgba(255,255,255,0.70)", fontFamily: FONT }}
      labelStyle={{ fontSize: 12, fontWeight: 500, lineHeight: 1.3, color: "#fff", fontFamily: FONT }}
      primaryButton={{ padding: "10px 16px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.24)", background: "#fff", color: "#000", cursor: "pointer", fontWeight: 600, fontSize: 14, lineHeight: 1.2, fontFamily: FONT }}
      secondaryButton={{ padding: "10px 16px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.07)", color: "#fff", cursor: "pointer", fontWeight: 600, fontSize: 14, lineHeight: 1.2, fontFamily: FONT }}
      panelStyle={{ borderRadius: 16, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)", padding: 14 }}
      inputStyle={{ width: "100%", borderRadius: 10, border: "1px solid rgba(255,255,255,0.16)", background: "rgba(255,255,255,0.06)", color: "#fff", padding: "10px 12px", fontSize: 14, fontFamily: FONT, boxSizing: "border-box" }}
      messageBox={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.05)", color: "#fff", fontSize: 12, lineHeight: 1.45, fontFamily: FONT }}
      serviceModalBackdropStyle={{ position: "fixed", inset: 0, zIndex: 100001, background: "rgba(0,0,0,0.80)", display: "grid", placeItems: "center", padding: 14, fontFamily: FONT }}
      serviceModalCardStyle={{ width: "min(720px, calc(100vw - 28px))", maxHeight: "calc(100dvh - 28px)", overflowY: "auto", background: "linear-gradient(180deg, rgba(18,18,18,0.98), rgba(8,8,8,0.98))", border: "1px solid rgba(255,255,255,0.16)", borderRadius: 18, overflow: "hidden", boxShadow: "0 24px 80px rgba(0,0,0,0.72)", color: "#fff" }}
      serviceToastStyle={{ position: "fixed", left: "50%", bottom: "calc(24px + env(safe-area-inset-bottom))", transform: "translateX(-50%)", zIndex: 100002, maxWidth: "min(520px, calc(100vw - 28px))", padding: "10px 12px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.16)", background: "rgba(12,12,12,0.94)", color: "#fff", fontSize: 13, fontWeight: 600, fontFamily: FONT }}
    />
  );

  // ── Contained mode (used by HomeStoryCarousel) ────────────────────────────
  if (contained) {
    return (
      <>
        <div
          className="story-viewer-root"
          style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", background: "#000", userSelect: "none", WebkitUserSelect: "none" } as React.CSSProperties}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onContextMenu={(e) => e.preventDefault()}
        >
          {renderPanelContent(12, false)}
        </div>
        {greetModal}
      </>
    );
  }

  // ── Desktop: centered modal ───────────────────────────────────────────────
  if (isDesktop) {
    const { width: panelW, height: panelH } = desktopPanelSize();
    return (
      <>
        {createPortal(
          <div style={{ position: "fixed", inset: 0, zIndex: 99999, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
            <div style={{ position: "relative", width: panelW, height: panelH, borderRadius: 18, overflow: "hidden", background: "#000", flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
              {renderPanelContent(12, true)}
            </div>
          </div>,
          document.body,
        )}
        {greetModal}
      </>
    );
  }

  // ── Mobile: fullscreen, swipe down to close ───────────────────────────────
  return (
    <>
      {createPortal(
        <div
          className="story-viewer-root"
          style={{ position: "fixed", inset: 0, zIndex: 99999, background: "#000", display: "flex", flexDirection: "column", touchAction: "none", userSelect: "none", WebkitUserSelect: "none", transform: `translateY(${dragY}px)`, transition: !isClosing && dragY > 0 ? "none" : "transform 0.28s ease, opacity 0.28s ease", opacity: 1 - Math.min(1, dragY / 300) } as React.CSSProperties}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onContextMenu={(e) => e.preventDefault()}
        >
          {renderPanelContent("env(safe-area-inset-top, 0px)", true, "env(safe-area-inset-bottom, 0px)")}
        </div>,
        document.body,
      )}
      {greetModal}
    </>
  );
}
