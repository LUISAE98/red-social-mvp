"use client";

import Image from "next/image";
import { IconButton } from "@/components/ui";
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
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { createPortal } from "react-dom";

import { VibraNavigationIcon } from "@/app/components/VibraServiceIcons/VibraNavigationIcons";
import ComposerPremiumPanel from "./ComposerPremiumPanel";
import type { useComposerPremium } from "./useComposerPremium";
import { useTranslations } from "next-intl";
import {
  Avatar, fontStack, formatVideoDuration,
  type PostComposerDesktopOverlayProps,
} from "./PostComposerDesktopOverlay.parts";

export default function PostComposerDesktopOverlay({
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
}: PostComposerDesktopOverlayProps) {
  const tCommon = useTranslations("common");
  const tPosts = useTranslations("posts");
  const tLive = useTranslations("live");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const onCloseRef = useRef(onClose);
  const [mounted, setMounted] = useState(false);
  const [shouldRender, setShouldRender] = useState(open);
  const [textareaHeight, setTextareaHeight] = useState(58);

  const TEXTAREA_MIN_HEIGHT = 58;
  const TEXTAREA_MAX_HEIGHT = 92;

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShouldRender(true);
      return;
    }

    const timer = window.setTimeout(() => {
      setShouldRender(false);
    }, 180);

    return () => window.clearTimeout(timer);
  }, [open]);

  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;


    const timer = window.setTimeout(() => {
      textareaRef.current?.focus();
    }, 120);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCloseRef.current();
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";

    const nextHeight = Math.min(
      TEXTAREA_MAX_HEIGHT,
      Math.max(TEXTAREA_MIN_HEIGHT, textarea.scrollHeight),
    );

    setTextareaHeight(nextHeight);

    if (textarea.scrollHeight > TEXTAREA_MAX_HEIGHT) {
      textarea.scrollTop = textarea.scrollHeight;
    }
  }, [text, open]);

  if (!shouldRender || !mounted) return null;

    const disabledPublish =
    creating ||
    isPreparingImages ||
    !hasContent ||
    (premiumComposer.premiumEnabled && !premiumComposer.validation.valid);

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
  insetInlineEnd: 6,
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
      aria-label={isEditMode ? tPosts("editPostTitle") : tPosts("createPostTitle")}
      style={{
        position: "fixed",
        top: 0,
        insetInlineStart: 0,
        insetInlineEnd: 0,
        bottom: 0,
        width: "100vw",
        height: "100dvh",
        zIndex: 999999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "rgba(0,0,0,0.88)",
        fontFamily: fontStack,
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <style>
        {`
          @keyframes vibraComposerDesktopIn {
            from {
              opacity: 0;
              transform: scale(0.94) translateY(10px);
            }
            to {
              opacity: 1;
              transform: scale(1) translateY(0);
            }
          }

          @keyframes vibraComposerDesktopOut {
            from {
              opacity: 1;
              transform: scale(1) translateY(0);
            }
            to {
              opacity: 0;
              transform: scale(0.94) translateY(10px);
            }
          }

          .vibra-composer-desktop-scroll::-webkit-scrollbar {
            width: 7px;
            height: 7px;
          }

          .vibra-composer-desktop-scroll::-webkit-scrollbar-track {
            background: transparent;
          }

          .vibra-composer-desktop-scroll::-webkit-scrollbar-thumb {
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

          /* Skeleton canónico de Vibra (vibra_style.md): onda .vb-skel / vbSkelWave. */
          .vb-skel {
            background: linear-gradient(
              100deg,
              rgba(255, 255, 255, 0.05) 30%,
              rgba(255, 255, 255, 0.11) 50%,
              rgba(255, 255, 255, 0.05) 70%
            );
            background-size: 300% 100%;
            animation: vbSkelWave 1.6s ease-in-out infinite;
          }
          @keyframes vbSkelWave {
            0%   { background-position: 180% 0; }
            100% { background-position: -80% 0; }
          }
          @media (prefers-reduced-motion: reduce) {
            .vb-skel { animation: none; background: rgba(255, 255, 255, 0.07); }
          }
        `}
      </style>

<section
  style={{
    width: "min(100%, 540px)",
    maxHeight: "min(88vh, 680px)",
    display: "flex",
    flexDirection: "column",
    borderRadius: 18,
    background: "#0a0a0a",
    boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 32px 72px rgba(0,0,0,0.9)",
    color: "#fff",
    overflow: "hidden",
    animation: open
      ? "vibraComposerDesktopIn 180ms ease-out"
      : "vibraComposerDesktopOut 180ms ease-in forwards",
  }}
>
<header
  style={{
    height: 56,
    display: "grid",
    gridTemplateColumns: "48px 1fr 48px",
    alignItems: "center",
    padding: "0 12px",
    borderBottom: "1px solid rgba(255,255,255,0.12)",
    flexShrink: 0,
  }}
>
          <div />

          <span style={{ fontSize: 17, fontWeight: 500, color: "#fff", lineHeight: 1.2, textAlign: "center", letterSpacing: "-0.02em" }}>
            {isEditMode ? tPosts("editPostTitle") : tPosts("createPostTitle")}
          </span>

          <IconButton label={tCommon("closeAriaLabel")} size="sm" tone="bare" shape="square" style={{ placeItems: "center", justifySelf: "end" }} onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </IconButton>
        </header>

<div
  className="vibra-composer-desktop-scroll"
  style={{ flex: 1, overflowY: "auto", minHeight: 0 }}
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
                    insetInlineEnd: 14,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    background: "linear-gradient(180deg, #a855f7 0%, #d946b8 100%)",
                    borderStartStartRadius: 0,
                    borderStartEndRadius: 0,
                    borderEndStartRadius: 6,
                    borderEndEndRadius: 6,
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
                  {tPosts("premiumPostBadge")}
                </div>
              ) : null}

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                marginBottom: 12,
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
    ? tPosts("shareOnProfilePlaceholder")
    : tPosts("shareInCommunityPlaceholder")
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
  transition: "height 180ms cubic-bezier(0.22, 1, 0.36, 1)",
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
    <IconButton label={tPosts("addPhotosOrVideos")} size="md" tone="bare" shape="square" style={{ placeItems: "center" }} onClick={onOpenMediaPicker} disabled={creating || isPreparingImages}>
      <VibraNavigationIcon
        type="attachMedia"
        size={30}
        strokeWidth={2.1}
      />
    </IconButton>

    {onLiveClick && !isEditMode && (
      <button
        type="button"
        onClick={onLiveClick}
        disabled={creating}
        title={tLive("scheduleLive")}
        aria-label={tLive("scheduleLive")}
        style={{
          width: 32,
          height: 42,
          borderRadius: 0,
          border: "none",
          background: "transparent",
          color: "#a855f7",
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
          background: "linear-gradient(135deg, #4f46ff, #a855f7, #ff2fb3)",
          color: "#fff",
          fontSize: 13,
          fontWeight: 500,
          cursor: creating || isPreparingImages ? "not-allowed" : "pointer",
          opacity: creating || isPreparingImages ? 0.55 : 1,
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
        {premiumComposer.premiumEnabled ? tPosts("removePremium") : tPosts("monetizeVideo")}
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
      className="vibra-composer-desktop-scroll"
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
                              alt={tPosts("imagePreviewAlt", { n: index + 1 })}
                              fill
                              style={{ objectFit: "cover", userSelect: "none" }}
                              draggable={false}
                            />
                          ) : (
                            <>
                              {videoCoverPreviewUrl ? (
                                <Image
                                  src={videoCoverPreviewUrl}
                                  alt={tPosts("videoCoverAlt", { n: index + 1 })}
                                  fill
                                  style={{ objectFit: "cover", userSelect: "none" }}
                                  draggable={false}
                                />
                              ) : (
                                // Skeleton canónico (vibra_style.md) mientras se prepara la
                                // portada del video — sin emoji ni texto, más profesional.
                                <div
                                  aria-hidden="true"
                                  className="vb-skel"
                                  style={{
                                    position: "absolute",
                                    inset: 0,
                                    zIndex: 2,
                                  }}
                                />
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
                                  insetInlineEnd: 8,
                                  bottom: 25,
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
                                onPointerDown={(event) => event.stopPropagation()}
                                onClick={() => onChooseVideoCover(item.id)}
                                disabled={creating}
                                style={{
                                  position: "absolute",
                                  insetInlineStart: 0,
                                  insetInlineEnd: 0,
                                  bottom: 0,
                                  height: 22,
                                  padding: "0 8px",
                                  borderRadius: 0,
                                  border: "none",
                                  background: "#a855f7",
                                  color: "rgba(255,255,255,0.98)",
                                  fontSize: 11.5,
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
                                {hasManualCover ? tPosts("changeButton") : tPosts("coverLabel")}
                              </button>
                            </>
                          )}

                          <div
                            style={{
                              position: "absolute",
                              insetInlineStart: 8,
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
                              aria-label={tPosts("removeMediaAria", { n: index + 1 })}
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
                        border: "none",
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
                      aria-label={tPosts("addMoreMedia")}
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
                disabled={creating}
                isEditMode={isEditMode}
              />
            </div>
            ) : null}

          </div>
        </div>
        <div
          style={{
            padding: "14px 20px 18px",
            borderTop: "1px solid rgba(255,255,255,0.12)",
          }}
        >
<button
  type="button"
  onClick={onSubmit}
  disabled={disabledPublish}
style={{
  width: "100%",
  height: 42,
  borderRadius: 5,
  border: "none",
  background: disabledPublish
    ? "rgba(255,255,255,0.1)"
    : "#a855f7",
  color: disabledPublish
    ? "rgba(255,255,255,0.36)"
    : "rgba(255,255,255,0.98)",
  fontSize: 17,
  fontWeight: 500,
  fontFamily: fontStack,
  cursor: disabledPublish ? "not-allowed" : "pointer",
  letterSpacing: "-0.02em",
  display: "grid",
  placeItems: "center",
}}
>
              {isPreparingImages
                ? tPosts("preparingLabel")
                : creating
                  ? (isEditMode ? tCommon("saving") : tCommon("publishing"))
                  : premiumComposer.premiumEnabled
                    ? <VibraNavigationIcon type="premiumCrown" size={22} />
                    : (isEditMode ? tCommon("saveChanges") : tCommon("publish"))}
            </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
