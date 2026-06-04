"use client";

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
};

type PostComposerDesktopOverlayProps = {
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

  selectedMediaItems: SelectedMediaItem[];
  processingImageSlots: number;
  processingVideoSlots: number;
  canAddMoreMedia: boolean;

  previewScrollerRef: RefObject<HTMLDivElement | null>;
  draggingPreviewIndex: number | null;
  dragOverPreviewIndex: number | null;
  isReorderingPreview: boolean;

  onSubmit: () => void | Promise<void>;
  onOpenMediaPicker: () => void;
  onRemoveMedia: (index: number) => void;
  onChooseVideoCover: (videoId: string) => void;

  onPreviewPointerDown: (
    index: number,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => void;
  onPreviewPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPreviewPointerUp: () => void;
};

const fontStack =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

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
      <img
        src={avatarUrl}
        alt={name}
        style={{
          width: size,
          height: size,
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
  localError,
  selectedMediaItems,
  processingImageSlots,
  processingVideoSlots,
  canAddMoreMedia,
  previewScrollerRef,
  draggingPreviewIndex,
  dragOverPreviewIndex,
  isReorderingPreview,
  onSubmit,
  onOpenMediaPicker,
  onRemoveMedia,
  onChooseVideoCover,
  onPreviewPointerDown,
  onPreviewPointerMove,
  onPreviewPointerUp,
}: PostComposerDesktopOverlayProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const [mounted, setMounted] = useState(false);
  const [shouldRender, setShouldRender] = useState(open);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (open) {
      setShouldRender(true);
      return;
    }

    const timer = window.setTimeout(() => {
      setShouldRender(false);
    }, 180);

    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const timer = window.setTimeout(() => {
      textareaRef.current?.focus();
    }, 120);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.scrollTop = textarea.scrollHeight;
  }, [text, open]);

  if (!shouldRender || !mounted) return null;

  const disabledPublish = creating || isPreparingImages || !hasContent;

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

  const mediaPreviewStyle: CSSProperties = {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    display: "block",
    userSelect: "none",
    WebkitUserSelect: "none",
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
top: 0,
left: 0,
right: 0,
bottom: 0,
width: "100vw",
height: "100vh",
zIndex: 999999,
display: "flex",
alignItems: "center",
justifyContent: "center",
padding: 24,
background: "rgba(0,0,0,0.52)",
backdropFilter: "blur(10px)",
WebkitBackdropFilter: "blur(10px)",
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
        `}
      </style>

<section
  style={{
    width: "min(100%, 540px)",
    borderRadius: 22,
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(8,9,11,0.985)",
    boxShadow:
      "0 30px 90px rgba(0,0,0,0.56), 0 0 0 1px rgba(255,255,255,0.035)",
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
    borderBottom: "1px solid rgba(255,255,255,0.08)",
  }}
>
          <div />

<h2
  style={{
    margin: 0,
    textAlign: "center",
    fontSize: 17,
    fontWeight: 500,
    letterSpacing: "-0.02em",
  }}
>
  Crear publicación
</h2>

          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
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
}}
          >
            ×
          </button>
        </header>

<div>
  <div style={{ padding: "18px 20px 18px" }}>
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
  height: 150,
  minHeight: 150,
  maxHeight: 150,
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
  overflowY: "auto",
  scrollbarWidth: "none",
  WebkitAppearance: "none",
}}
            />

<div
  style={{
    marginTop: 14,
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-start",
  }}
>
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
                            <img
                              src={item.previewUrl}
                              alt={`Vista previa de imagen ${index + 1}`}
                              style={mediaPreviewStyle}
                              draggable={false}
                              onDragStart={(event) => event.preventDefault()}
                            />
                          ) : (
                            <>
                              {videoCoverPreviewUrl ? (
                                <img
                                  src={videoCoverPreviewUrl}
                                  alt={`Portada del video ${index + 1}`}
                                  style={mediaPreviewStyle}
                                  draggable={false}
                                  onDragStart={(event) =>
                                    event.preventDefault()
                                  }
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
                                onPointerDown={(event) => event.stopPropagation()}
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

<button
  type="button"
  onClick={onSubmit}
  disabled={disabledPublish}
style={{
  width: "100%",
  height: 42,
  marginTop: 14,
  borderRadius: 13,
  border: "none",
  background: disabledPublish
    ? "rgba(255,255,255,0.1)"
    : "#a855ff",
  color: disabledPublish
    ? "rgba(255,255,255,0.36)"
    : "rgba(255,255,255,0.98)",
  fontSize: 17,
  fontWeight: 500,
  fontFamily: fontStack,
  cursor: disabledPublish ? "not-allowed" : "pointer",
  letterSpacing: "-0.02em",
}}
>
              {isPreparingImages
                ? "Preparando..."
                : creating
                  ? "Publicando..."
                  : "Publicar"}
            </button>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}
