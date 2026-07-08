"use client";

import Image from "next/image";
import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";

import { VibraNavigationIcon } from "@/app/components/VibraServiceIcons/VibraNavigationIcons";
import ComposerPremiumPanel from "./ComposerPremiumPanel";
import type { useComposerPremium } from "./useComposerPremium";
import { useTranslations } from "next-intl";

type SelectedMediaItem = {
  id: string;
  type: "image" | "video";
  file: File;
  previewUrl: string;
  durationSeconds: number | null;
  coverFile?: File | null;
  coverPreviewUrl?: string | null;
  autoCoverUrl?: string | null;
  autoCoverFile?: File | null;
  coverStatus?: "loading" | "ready" | "error";
  locked?: boolean;
};

type PostComposerMobileOverlayProps = {
  open: boolean;
  onClose: () => void;

  text: string;
  setText: Dispatch<SetStateAction<string>>;

  contextType?: "group" | "profile";
  currentUserName: string;
  currentUserAvatar: string | null;
  currentUserHref: string;

  creating: boolean;
  isPreparingImages: boolean;
  hasContent: boolean;
  localError: string | null;
  hasVideos: boolean;
  premiumComposer: ReturnType<typeof useComposerPremium>;

  selectedMediaItems: SelectedMediaItem[];
  processingImageSlots: number;
  processingVideoSlots: number;
  canAddMoreMedia: boolean;

  previewScrollerRef: RefObject<HTMLDivElement | null>;
  draggingPreviewIndex: number | null;
  dragOverPreviewIndex: number | null;
  isReorderingPreview: boolean;

  isEditMode?: boolean;

  onSubmit: () => void | Promise<void>;
  onOpenMediaPicker: () => void;
  onLiveClick?: () => void;
  onRemoveMedia: (index: number) => void;
  onChooseVideoCover: (videoId: string) => void;

  onPreviewPointerDown: (
    index: number,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => void;
  onPreviewPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPreviewPointerUp: () => void;
};

type PublishVisualState = "idle" | "loading" | "success";

const fontStack =
  'inherit';

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return "U";
  return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

function formatVideoDuration(durationSeconds: number | null) {
  if (
    !Number.isFinite(durationSeconds ?? Number.NaN) ||
    durationSeconds === null
  ) {
    return "0:00";
  }

  const totalSeconds = Math.max(0, Math.floor(durationSeconds));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function Avatar({
  name,
  avatarUrl,
  size = 44,
}: {
  name: string;
  avatarUrl?: string | null;
  size?: number;
}) {
  if (avatarUrl) {
    return (
      <Image
        src={avatarUrl}
        alt={name}
        width={size} height={size}
        style={{
          borderRadius: "50%",
          objectFit: "cover",
          display: "block",
          border: "1px solid rgba(255,255,255,0.1)",
          background: "rgba(255,255,255,0.05)",
          flexShrink: 0,
        }}
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        display: "grid",
        placeItems: "center",
        background: "rgba(255,255,255,0.08)",
        border: "1px solid rgba(255,255,255,0.1)",
        color: "#fff",
        fontSize: Math.max(12, Math.floor(size * 0.32)),
        fontWeight: 700,
        letterSpacing: "-0.03em",
        flexShrink: 0,
      }}
    >
      {getInitials(name)}
    </div>
  );
}

export default function PostComposerMobileOverlay({
  open,
  onClose,
  text,
  setText,
  contextType = "group",
  currentUserName,
  currentUserAvatar,
  currentUserHref,
  creating,
  isPreparingImages,
  hasContent,
  localError,
  hasVideos,
  premiumComposer,
  selectedMediaItems,
  processingImageSlots,
  processingVideoSlots,
  canAddMoreMedia,
  previewScrollerRef,
  draggingPreviewIndex,
  dragOverPreviewIndex,
  isReorderingPreview,
  isEditMode = false,
  onSubmit,
  onOpenMediaPicker,
  onLiveClick,
  onRemoveMedia,
  onChooseVideoCover,
  onPreviewPointerDown,
  onPreviewPointerMove,
  onPreviewPointerUp,
}: PostComposerMobileOverlayProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const tCommon = useTranslations("common");
  const dragStartYRef = useRef(0);
  const dragStartOffsetYRef = useRef(0);
  const publishSuccessTimerRef = useRef<number | null>(null);
  const publishWasRequestedRef = useRef(false);
  const onCloseRef = useRef(onClose);

  const [mounted, setMounted] = useState(false);
  const [shouldRender, setShouldRender] = useState(open);
  const [panelOffsetY, setPanelOffsetY] = useState(() =>
    open ? 0 : typeof window === "undefined" ? 900 : window.innerHeight,
  );
  const [isPanelDragging, setIsPanelDragging] = useState(false);
  const textareaHeight = 58;
  const [publishVisualState, setPublishVisualState] =
    useState<PublishVisualState>("idle");

  const PANEL_RESTING_OFFSET = 0;
  const PANEL_CLOSE_THRESHOLD = 130;
  const panelCloseOffsetRef = useRef(
    typeof window === "undefined" ? 900 : window.innerHeight,
  );
  const TEXTAREA_MIN_HEIGHT = 58;
  const TEXTAREA_MAX_HEIGHT = 180;

  useEffect(() => {
    setMounted(true);

    return () => {
      if (publishSuccessTimerRef.current !== null) {
        window.clearTimeout(publishSuccessTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (open) {
      setShouldRender(true);
      setIsPanelDragging(false);
      setPanelOffsetY(panelCloseOffsetRef.current);

      const frameOne = window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          setPanelOffsetY(PANEL_RESTING_OFFSET);
        });
      });

      return () => window.cancelAnimationFrame(frameOne);
    }

    setIsPanelDragging(false);
    setPanelOffsetY(panelCloseOffsetRef.current);

    const timer = window.setTimeout(() => {
      setShouldRender(false);
    }, 260);

    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const timer = window.setTimeout(() => {
      textareaRef.current?.focus();
    }, 180);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCloseRef.current();
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (open) return;

    publishWasRequestedRef.current = false;
    setPublishVisualState("idle");

    if (publishSuccessTimerRef.current !== null) {
      window.clearTimeout(publishSuccessTimerRef.current);
      publishSuccessTimerRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    if (creating || isPreparingImages) {
      if (publishWasRequestedRef.current || creating) {
        setPublishVisualState("loading");
      }

      return;
    }

    if (!publishWasRequestedRef.current) return;

    if (localError) {
      publishWasRequestedRef.current = false;
      setPublishVisualState("idle");
      return;
    }

    setPublishVisualState("success");

    if (publishSuccessTimerRef.current !== null) {
      window.clearTimeout(publishSuccessTimerRef.current);
    }

    publishSuccessTimerRef.current = window.setTimeout(() => {
      publishWasRequestedRef.current = false;
      setPublishVisualState("idle");
      publishSuccessTimerRef.current = null;
    }, 900);
  }, [creating, isPreparingImages, localError]);

  function handlePublishClick() {
    if (disabledPublish || publishVisualState === "loading") return;

    publishWasRequestedRef.current = true;
    setPublishVisualState("loading");

    void onSubmit();
  }

  function clampPanelOffset(value: number) {
    return Math.min(panelCloseOffsetRef.current, Math.max(PANEL_RESTING_OFFSET, value));
  }

  function handlePanelPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;

    const target = event.target as HTMLElement | null;

    if (target?.closest("button")) {
      return;
    }

    dragStartYRef.current = event.clientY;
    dragStartOffsetYRef.current = panelOffsetY;

    setIsPanelDragging(true);

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {}

    event.preventDefault();
  }

  function handlePanelPointerMove(event: ReactPointerEvent<HTMLElement>) {
    if (!isPanelDragging) return;

    const deltaY = event.clientY - dragStartYRef.current;
    const nextOffset = clampPanelOffset(dragStartOffsetYRef.current + deltaY);

    setPanelOffsetY(nextOffset);
  }

  function handlePanelPointerUp() {
    if (!isPanelDragging) return;

    setIsPanelDragging(false);

    if (panelOffsetY >= PANEL_CLOSE_THRESHOLD) {
      setPanelOffsetY(panelCloseOffsetRef.current);
      onClose();
      return;
    }

    setPanelOffsetY(PANEL_RESTING_OFFSET);
  }

  if (!shouldRender || !mounted) return null;

  const disabledPublish =
    creating ||
    isPreparingImages ||
    !hasContent ||
    (premiumComposer.premiumEnabled && !premiumComposer.validation.valid);

  const isPublishLoading =
    creating || isPreparingImages || publishVisualState === "loading";
  const isPublishSuccess = publishVisualState === "success";
  const isPublishIconState = isPublishLoading || isPublishSuccess;

  const hasVisibleMedia =
    selectedMediaItems.length > 0 ||
    processingImageSlots > 0 ||
    processingVideoSlots > 0;

  const mediaPreviewWrapStyle: CSSProperties = {
    width: 104,
    height: 104,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.1)",
    overflow: "hidden",
    background: "rgba(255,255,255,0.045)",
    position: "relative",
    flex: "0 0 auto",
  };

  const removeMediaButtonStyle: CSSProperties = {
    position: "absolute",
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    border: "none",
    background: "transparent",
    color: "#fff",
    cursor: "pointer",
    fontSize: 24,
    fontWeight: 300,
    lineHeight: 1,
    zIndex: 4,
    textShadow: "0 2px 8px rgba(0,0,0,0.95)",
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Crear publicación"
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        zIndex: 999999,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        padding: 0,
        background: "rgba(0,0,0,0.52)",
        backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
        fontFamily: fontStack,
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <style>
        {`
          @keyframes vibraComposerMobileIn {
            from {
              opacity: 1;
              transform: translateY(100%);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }

          @keyframes vibraComposerMobileOut {
            from {
              opacity: 1;
              transform: translateY(0);
            }
            to {
              opacity: 1;
              transform: translateY(100%);
            }
          }

          .vibra-composer-mobile-scroll::-webkit-scrollbar {
            width: 7px;
            height: 7px;
          }

          .vibra-composer-mobile-scroll::-webkit-scrollbar-track {
            background: transparent;
          }

          .vibra-composer-mobile-scroll::-webkit-scrollbar-thumb {
            background: rgba(255,255,255,0.18);
            border-radius: 999px;
          }

          @keyframes post-preview-loading-pulse {
            0% { opacity: 0.42; }
            50% { opacity: 0.78; }
            100% { opacity: 0.42; }
          }

          @keyframes post-preview-video-cover-loading {
            0% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
            100% { background-position: 0% 50%; }
          }

          @keyframes vibra-publish-spinner-spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }

          @keyframes vibra-publish-success-pop {
            0% {
              transform: scale(0.72);
              opacity: 0;
            }
            62% {
              transform: scale(1.12);
              opacity: 1;
            }
            100% {
              transform: scale(1);
              opacity: 1;
            }
          }

          .vibra-publish-spinner {
            width: 22px;
            height: 22px;
            border-radius: 999px;
            border: 2px solid rgba(168,85,255,0.22);
            border-top-color: #a855ff;
            border-right-color: #a855ff;
            animation: vibra-publish-spinner-spin 760ms linear infinite;
            box-sizing: border-box;
          }

          .vibra-publish-success-check {
            color: #fff;
            font-size: 20px;
            font-weight: 800;
            line-height: 1;
            transform-origin: center;
            animation: vibra-publish-success-pop 360ms cubic-bezier(0.22, 1, 0.36, 1);
          }
        `}
      </style>

<section
  style={{
    width: "100%",
    height: "calc(100vh - 72px)",
    maxHeight: "calc(100vh - 72px)",
    borderRadius: "22px 22px 0 0",
    border: "1px solid transparent",
    borderBottom: "1px solid transparent",
    background: "rgba(8,9,11,0.96)",
    boxShadow: "0 -24px 80px rgba(0,0,0,0.56)",
    color: "#fff",
    overflow: "hidden",
    transform: open
      ? `translateY(${panelOffsetY}px)`
      : "translateY(100%)",
    transition: isPanelDragging
      ? "none"
      : "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
    willChange: "transform",
  }}
>
  <header
    onPointerDown={handlePanelPointerDown}
    onPointerMove={handlePanelPointerMove}
    onPointerUp={handlePanelPointerUp}
    onPointerCancel={handlePanelPointerUp}
    style={{
      height: 56,
      display: "grid",
      gridTemplateColumns: "72px 1fr 72px",
      alignItems: "center",
      padding: "0 12px",
      borderBottom: "1px solid transparent",
      touchAction: "none",
      userSelect: "none",
      WebkitUserSelect: "none",
    }}
  >
    <button
      type="button"
      onClick={onClose}
      aria-label={tCommon("closeAriaLabel")}
      style={{
        width: 40,
        height: 40,
        border: "none",
        background: "transparent",
        color: "rgba(255,255,255,0.86)",
        cursor: "pointer",
        display: "grid",
        placeItems: "center",
        fontSize: 32,
        fontWeight: 300,
        lineHeight: 1,
        justifySelf: "start",
      }}
    >
      ×
    </button>

    <h2
      style={{
        margin: 0,
        textAlign: "center",
        fontSize: 17,
        fontWeight: 500,
        letterSpacing: "-0.02em",
        lineHeight: 1.2,
        color: "#fff",
      }}
    >
      {isEditMode ? "Editar publicación" : "Crear publicación"}
    </h2>

    <button
      type="button"
      onClick={handlePublishClick}
      disabled={disabledPublish || isPublishIconState}
      aria-label={
        isPublishSuccess
          ? tCommon("done")
          : isPublishLoading
            ? tCommon("publishing")
            : tCommon("publish")
      }
      style={{
        width: isPublishIconState ? 38 : undefined,
        height: 38,
        padding: isPublishIconState ? 0 : "0 14px",
        borderRadius: isPublishIconState ? 999 : 11,
        border: isPublishLoading
          ? "2px solid rgba(168,85,255,0.18)"
          : "none",
        background: isPublishSuccess
          ? "#22c55e"
          : isPublishLoading
            ? "transparent"
            : disabledPublish
              ? "rgba(255,255,255,0.1)"
              : "#a855ff",
        color:
          disabledPublish && !isPublishIconState
            ? "rgba(255,255,255,0.36)"
            : "rgba(255,255,255,0.98)",
        fontSize: 16,
        fontWeight: 550,
        fontFamily: fontStack,
        cursor:
          disabledPublish || isPublishIconState
            ? "not-allowed"
            : "pointer",
        letterSpacing: "-0.02em",
        justifySelf: "end",
        display: "inline-grid",
        placeItems: "center",
        boxSizing: "border-box",
        overflow: "hidden",
        transition:
          "width 220ms cubic-bezier(0.22, 1, 0.36, 1), padding 220ms cubic-bezier(0.22, 1, 0.36, 1), border-radius 220ms cubic-bezier(0.22, 1, 0.36, 1), background-color 180ms ease, border-color 180ms ease, transform 180ms ease",
      }}
    >
      {isPublishSuccess ? (
        <span className="vibra-publish-success-check" aria-hidden="true">
          ✓
        </span>
      ) : isPublishLoading ? (
        <span className="vibra-publish-spinner" aria-hidden="true" />
      ) : premiumComposer.premiumEnabled ? (
        <VibraNavigationIcon type="premiumCrown" size={22} />
      ) : (
        isEditMode ? tCommon("save") : tCommon("publish")
      )}
    </button>
  </header>

        <div
          className="vibra-composer-mobile-scroll"
          style={{
            height: "calc(100% - 56px)",
            maxHeight: "calc(100% - 56px)",
            overflowY: "auto",
          }}
        >
          <div style={{ padding: "18px 20px 8px" }}>
            <div
              style={
                premiumComposer.premiumEnabled
                  ? {
                      position: "relative",
                      border: "1.5px solid #a855f7",
                      borderRadius: 8,
                      background:
                        "linear-gradient(160deg, rgba(79,70,255,0.06), rgba(168,85,255,0.04) 55%, rgba(255,47,179,0.03))",
                      boxShadow:
                        "0 0 0 1px rgba(168,85,255,0.06), 0 4px 28px rgba(168,85,255,0.1)",
                      padding: "14px 14px 12px",
                    }
                  : undefined
              }
            >
              {premiumComposer.premiumEnabled ? (
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    right: 14,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    background: "linear-gradient(180deg, #a855f7 0%, #d946b8 100%)",
                    borderTopLeftRadius: 0,
                    borderTopRightRadius: 0,
                    borderBottomLeftRadius: 6,
                    borderBottomRightRadius: 6,
                    padding: "3px 8px 3px 6px",
                    fontSize: 8.5,
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                    color: "#fff",
                    whiteSpace: "nowrap",
                    fontFamily: fontStack,
                    textTransform: "uppercase" as const,
                  }}
                >
                  <VibraNavigationIcon type="premiumCrown" size={14} />
                  Publicación Premium
                </div>
              ) : null}

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                marginBottom: 16,
              }}
            >
              <Link
                href={currentUserHref}
                style={{
                  display: "inline-flex",
                  flexShrink: 0,
                  textDecoration: "none",
                }}
              >
                <Avatar
                  name={currentUserName}
                  avatarUrl={currentUserAvatar}
                  size={42}
                />
              </Link>

              <div style={{ minWidth: 0, paddingTop: 2 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    lineHeight: 1.35,
                    letterSpacing: "-0.02em",
                    color: "#fff",
                  }}
                >
                  {currentUserName}
                </div>
              </div>
            </div>

            <textarea
              ref={textareaRef}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={
                contextType === "profile"
                  ? "Comparte algo en tu perfil..."
                  : "Comparte algo en esta comunidad..."
              }
              style={{
                width: "100%",
                height: textareaHeight,
                minHeight: TEXTAREA_MIN_HEIGHT,
                maxHeight: TEXTAREA_MAX_HEIGHT,
                resize: "none",
                border: "none",
                outline: "none",
                background: "transparent",
                color: "#fff",
                fontFamily: fontStack,
                fontSize: 15,
                fontWeight: 300,
                lineHeight: "23px",
                letterSpacing: "-0.02em",
                padding: 0,
                overflowY:
                  textareaHeight >= TEXTAREA_MAX_HEIGHT ? "auto" : "hidden",
                scrollbarWidth: "none",
                WebkitAppearance: "none",
                transition:
                  "height 180ms cubic-bezier(0.22, 1, 0.36, 1)",
              }}
            />

            <div
              style={{
                marginTop: 2,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
                <button
                  type="button"
                  onClick={onOpenMediaPicker}
                  disabled={creating || isPreparingImages}
                  title="Agregar fotos o videos"
                  aria-label="Agregar fotos o videos"
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 0,
                    border: "none",
                    background: "transparent",
                    color: "#a855ff",
                    display: "grid",
                    placeItems: "center",
                    cursor: creating || isPreparingImages ? "not-allowed" : "pointer",
                    opacity: creating || isPreparingImages ? 0.45 : 1,
                    padding: 0,
                  }}
                >
                  <VibraNavigationIcon
                    type="attachMedia"
                    size={30}
                    strokeWidth={2.1}
                  />
                </button>

                {onLiveClick && !isEditMode && (
                  <button
                    type="button"
                    onClick={onLiveClick}
                    disabled={creating}
                    title="Programar live"
                    aria-label="Programar live"
                    style={{
                      width: 32,
                      height: 42,
                      borderRadius: 0,
                      border: "none",
                      background: "transparent",
                      color: "#a855ff",
                      display: "grid",
                      placeItems: "center",
                      cursor: creating ? "not-allowed" : "pointer",
                      opacity: creating ? 0.45 : 1,
                      padding: 0,
                    }}
                  >
                    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                      <circle cx="11" cy="11" r="10" stroke="#ef4444" strokeWidth="1.4" fill="none" />
                      <circle cx="11" cy="11" r="6" fill="#ef4444" />
                    </svg>
                  </button>
                )}
              </div>

              <div>
                {premiumComposer.canEnablePremium && !isEditMode ? (
                  <button
                    type="button"
                    onClick={premiumComposer.togglePremiumEnabled}
                    disabled={creating || isPreparingImages}
                    style={{
                      height: 34,
                      border: "none",
                      borderRadius: 5,
                      padding: "0 13px",
                      background: "linear-gradient(135deg, #4f46ff, #a855ff, #ff2fb3)",
                      color: "#fff",
                      fontSize: 13,
                      fontWeight: 500,
                      cursor:
                        creating || isPreparingImages
                          ? "not-allowed"
                          : "pointer",
                      opacity:
                        creating || isPreparingImages
                          ? 0.55
                          : 1,
                      fontFamily: fontStack,
                      boxShadow: "0 8px 20px rgba(168,85,247,0.24)",
                      whiteSpace: "nowrap",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    {!premiumComposer.premiumEnabled ? (
                      <VibraNavigationIcon type="premiumCrown" size={20} />
                    ) : null}
                    {premiumComposer.premiumEnabled ? "Quitar Premium" : "Monetizar Video"}
                  </button>
                ) : null}
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateRows: hasVisibleMedia ? "1fr" : "0fr",
                opacity: hasVisibleMedia ? 1 : 0,
                marginTop: hasVisibleMedia ? 8 : 0,
                transition:
                  "grid-template-rows 260ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease, margin-top 260ms cubic-bezier(0.22, 1, 0.36, 1)",
              }}
            >
              <div style={{ overflow: "hidden" }}>
                <div
                  ref={previewScrollerRef}
                  className="vibra-composer-mobile-scroll"
                  style={{
                    display: "flex",
                    gap: 10,
                    maxWidth: "100%",
                    overflowX: "auto",
                    overflowY: "hidden",
                    paddingBottom: 10,
                    cursor: isReorderingPreview ? "grabbing" : "grab",
                  }}
                >
                  {selectedMediaItems.map((item, index) => {
                    const videoCoverPreviewUrl =
                      item.type === "video"
                        ? item.coverPreviewUrl || item.autoCoverUrl || null
                        : null;

                    const isVideoCoverLoading =
                      item.type === "video" &&
                      !videoCoverPreviewUrl &&
                      item.coverStatus !== "error";

                    const hasManualCover =
                      item.type === "video" && Boolean(item.coverPreviewUrl);

                    return (
                      <div
                        key={item.id}
                        style={{
                          width: 104,
                          flex: "0 0 auto",
                          display: "grid",
                          gap: 8,
                        }}
                      >
                        <div
                          data-preview-index={index}
                          onDragStart={(event) => event.preventDefault()}
                          onPointerDown={(event) =>
                            onPreviewPointerDown(index, event)
                          }
                          onPointerMove={onPreviewPointerMove}
                          onPointerUp={onPreviewPointerUp}
                          onPointerCancel={onPreviewPointerUp}
                          style={{
                            ...mediaPreviewWrapStyle,
                            opacity: draggingPreviewIndex === index ? 0.62 : 1,
                            transform:
                              draggingPreviewIndex === index
                                ? "scale(0.96)"
                                : dragOverPreviewIndex === index
                                  ? "scale(1.035)"
                                  : "scale(1)",
                            outline:
                              dragOverPreviewIndex === index
                                ? "2px solid rgba(255,255,255,0.42)"
                                : "none",
                            transition:
                              "transform 140ms ease, opacity 140ms ease, outline 140ms ease",
                            touchAction: "none",
                            cursor: isReorderingPreview ? "grabbing" : "grab",
                          }}
                        >
                          {item.type === "image" ? (
                            <Image
                              src={item.previewUrl}
                              alt={`Vista previa de imagen ${index + 1}`}
                              fill
                              style={{ objectFit: "cover", userSelect: "none" }}
                              draggable={false}
                            />
                          ) : (
                            <>
                              {videoCoverPreviewUrl ? (
                                <Image
                                  src={videoCoverPreviewUrl}
                                  alt={`Portada del video ${index + 1}`}
                                  fill
                                  style={{ objectFit: "cover", userSelect: "none" }}
                                  draggable={false}
                                />
                              ) : (
                                <div
                                  aria-hidden="true"
                                  style={{
                                    position: "absolute",
                                    inset: 0,
                                    display: "grid",
                                    placeItems: "center",
                                    background:
                                      "linear-gradient(135deg, rgba(76,29,149,0.78), rgba(168,85,247,0.34), rgba(49,46,129,0.72))",
                                    backgroundSize: "220% 220%",
                                    animation:
                                      "post-preview-video-cover-loading 1.45s ease-in-out infinite",
                                    color: "rgba(255,255,255,0.92)",
                                    textAlign: "center",
                                    padding: 10,
                                    boxSizing: "border-box",
                                    zIndex: 2,
                                  }}
                                >
                                  <div
                                    style={{
                                      display: "grid",
                                      gap: 6,
                                      justifyItems: "center",
                                    }}
                                  >
                                    <span
                                      style={{ fontSize: 22, lineHeight: 1 }}
                                    >
                                      🎥
                                    </span>
                                    <span
                                      style={{
                                        fontSize: 11,
                                        fontWeight: 800,
                                        lineHeight: 1.15,
                                      }}
                                    >
                                      Cargando video
                                    </span>
                                  </div>
                                </div>
                              )}

                              {isVideoCoverLoading && (
                                <div
                                  aria-hidden="true"
                                  style={{
                                    position: "absolute",
                                    inset: 0,
                                    background:
                                      "linear-gradient(90deg, rgba(255,255,255,0.02), rgba(255,255,255,0.14), rgba(255,255,255,0.02))",
                                    opacity: 0.52,
                                    animation:
                                      "post-preview-loading-pulse 1.2s ease-in-out infinite",
                                    zIndex: 2,
                                  }}
                                />
                              )}

                              <div
                                aria-hidden="true"
                                style={{
                                  position: "absolute",
                                  right: 8,
                                  bottom: 35,
                                  color: "#fff",
                                  fontSize: 11,
                                  fontWeight: 800,
                                  lineHeight: 1,
                                  textShadow: "0 2px 8px rgba(0,0,0,0.95)",
                                  zIndex: 3,
                                }}
                              >
                                {formatVideoDuration(item.durationSeconds)}
                              </div>

                              <button
                                type="button"
                                onPointerDown={(event) =>
                                  event.stopPropagation()
                                }
                                onClick={() => onChooseVideoCover(item.id)}
                                disabled={creating}
                                style={{
                                  position: "absolute",
                                  left: 0,
                                  right: 0,
                                  bottom: 0,
                                  height: 29,
                                  padding: "0 8px",
                                  borderRadius: 0,
                                  border: "none",
                                  background: "#a855ff",
                                  color: "rgba(255,255,255,0.98)",
                                  fontSize: 12,
                                  fontWeight: 500,
                                  fontFamily: fontStack,
                                  lineHeight: 1,
                                  cursor: creating ? "not-allowed" : "pointer",
                                  opacity: creating ? 0.55 : 1,
                                  whiteSpace: "nowrap",
                                  letterSpacing: "-0.02em",
                                  zIndex: 3,
                                }}
                              >
                                {hasManualCover ? "Cambiar" : "Portada"}
                              </button>
                            </>
                          )}

                          <div
                            style={{
                              position: "absolute",
                              left: 8,
                              top: 8,
                              minWidth: 24,
                              height: 24,
                              borderRadius: 999,
                              background: "rgba(0,0,0,0.62)",
                              color: "#fff",
                              display: "grid",
                              placeItems: "center",
                              fontSize: 12,
                              fontWeight: 800,
                              lineHeight: 1,
                              zIndex: 3,
                            }}
                          >
                            {index + 1}
                          </div>

                          {!item.locked && (
                            <button
                              type="button"
                              onPointerDown={(event) => event.stopPropagation()}
                              onClick={() => onRemoveMedia(index)}
                              style={removeMediaButtonStyle}
                              aria-label={`Quitar media ${index + 1}`}
                              disabled={creating}
                            >
                              ×
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {Array.from({ length: processingImageSlots }).map(
                    (_, index) => (
                      <div
                        key={`processing-image-${index}`}
                        aria-label="Preparando imagen"
                        style={{
                          ...mediaPreviewWrapStyle,
                          animation:
                            "post-preview-loading-pulse 1.6s ease-in-out infinite",
                        }}
                      />
                    ),
                  )}

                  {Array.from({ length: processingVideoSlots }).map(
                    (_, index) => (
                      <div
                        key={`processing-video-${index}`}
                        aria-label="Preparando video"
                        style={{
                          ...mediaPreviewWrapStyle,
                          border: "1px solid rgba(168,85,247,0.24)",
                          background:
                            "linear-gradient(135deg, rgba(76,29,149,0.72), rgba(168,85,247,0.22), rgba(49,46,129,0.68))",
                          backgroundSize: "220% 220%",
                          animation:
                            "post-preview-video-cover-loading 1.45s ease-in-out infinite",
                        }}
                      />
                    ),
                  )}

                  {canAddMoreMedia && (
                    <button
                      type="button"
                      onClick={onOpenMediaPicker}
                      disabled={creating}
                      style={{
                        width: 104,
                        height: 104,
                        borderRadius: 14,
                        border: "1px dashed rgba(255,255,255,0.24)",
                        background: "rgba(255,255,255,0.045)",
                        color: "rgba(255,255,255,0.82)",
                        display: "grid",
                        placeItems: "center",
                        cursor: creating ? "not-allowed" : "pointer",
                        opacity: creating ? 0.5 : 1,
                        fontSize: 30,
                        fontWeight: 300,
                        lineHeight: 1,
                        flex: "0 0 auto",
                      }}
                      aria-label="Agregar otra media"
                    >
                      +
                    </button>
                  )}
                </div>
              </div>
            </div>

            </div>

            {premiumComposer.premiumEnabled ? (
            <div style={{ marginTop: 14 }}>
              <ComposerPremiumPanel
                hasVideos={hasVideos}
                contextType={contextType}
                premiumEnabled={premiumComposer.premiumEnabled}
                setPremiumEnabled={premiumComposer.setPremiumEnabled}
                accessMode={premiumComposer.accessMode}
                setAccessMode={premiumComposer.setAccessMode}
                freeFor={premiumComposer.freeFor}
                setFreeFor={premiumComposer.setFreeFor}
                priceInput={premiumComposer.priceInput}
                setPriceInput={premiumComposer.setPriceInput}
                capabilities={premiumComposer.capabilities}
                validation={premiumComposer.validation}
                premiumErrorMessage={premiumComposer.premiumErrorMessage}
                disabled={creating}
                isEditMode={isEditMode}
              />
            </div>
            ) : null}

            {localError && (
              <div
                style={{
                  marginTop: 14,
                  borderRadius: 13,
                  border: "1px solid rgba(255,90,90,0.24)",
                  background: "rgba(120,18,18,0.28)",
                  color: "#ffdada",
                  padding: "10px 12px",
                  fontSize: 13,
                  lineHeight: 1.4,
                }}
              >
                {localError}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}
