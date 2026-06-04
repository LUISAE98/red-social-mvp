"use client";

import Link from "next/link";
import {
  useEffect,
  useRef,
  type CSSProperties,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SetStateAction,
} from "react";

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
  size = 42,
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
        fontWeight: 800,
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
}: PostComposerMobileOverlayProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const timer = window.setTimeout(() => {
      textareaRef.current?.focus();
    }, 180);

    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
  }, [text, open]);

  if (!open) return null;

  const disabledPublish = creating || isPreparingImages || !hasContent;

  const mediaPreviewWrapStyle: CSSProperties = {
    width: 104,
    height: 104,
    borderRadius: 16,
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Crear publicación"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,0.72)",
        fontFamily: fontStack,
        color: "#fff",
      }}
    >
      <style>
        {`
          @keyframes vibraComposerMobileIn {
            from {
              transform: translateY(100%);
            }
            to {
              transform: translateY(0);
            }
          }

          .vibra-composer-mobile-scroll::-webkit-scrollbar {
            width: 0px;
            height: 0px;
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
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          background: "rgba(18,19,21,0.99)",
          animation: "vibraComposerMobileIn 240ms cubic-bezier(.2,.9,.2,1)",
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        <header
          style={{
            height: 56,
            flex: "0 0 auto",
            display: "grid",
            gridTemplateColumns: "56px 1fr 86px",
            alignItems: "center",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
            padding: "0 8px",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            style={{
              width: 44,
              height: 44,
              borderRadius: 999,
              border: "none",
              background: "transparent",
              color: "rgba(255,255,255,0.9)",
              cursor: "pointer",
              fontSize: 30,
              lineHeight: 1,
              display: "grid",
              placeItems: "center",
            }}
          >
            ×
          </button>

          <h2
            style={{
              margin: 0,
              textAlign: "center",
              fontSize: 17,
              fontWeight: 850,
              letterSpacing: "-0.03em",
            }}
          >
            Crear publicación
          </h2>

          <button
            type="button"
            onClick={onSubmit}
            disabled={disabledPublish}
            style={{
              height: 36,
              borderRadius: 999,
              border: "none",
              background: disabledPublish
                ? "rgba(255,255,255,0.1)"
                : "linear-gradient(135deg, #8b5cf6, #a855f7)",
              color: disabledPublish
                ? "rgba(255,255,255,0.38)"
                : "rgba(255,255,255,0.98)",
              fontSize: 13,
              fontWeight: 900,
              fontFamily: fontStack,
              cursor: disabledPublish ? "not-allowed" : "pointer",
              padding: "0 14px",
            }}
          >
            {isPreparingImages ? "..." : creating ? "..." : "Publicar"}
          </button>
        </header>

        <main
          className="vibra-composer-mobile-scroll"
          style={{
            flex: "1 1 auto",
            overflowY: "auto",
            WebkitOverflowScrolling: "touch",
            padding: "16px 16px 92px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 11,
              marginBottom: 14,
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

            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 850,
                  lineHeight: 1.2,
                  letterSpacing: "-0.02em",
                }}
              >
                {currentUserName}
              </div>

              <div
                style={{
                  marginTop: 5,
                  display: "inline-flex",
                  alignItems: "center",
                  height: 25,
                  padding: "0 10px",
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  color: "rgba(255,255,255,0.82)",
                  fontSize: 12,
                  fontWeight: 750,
                }}
              >
                {contextType === "profile" ? "Perfil" : "Comunidad"}
              </div>
            </div>
          </div>

          <textarea
            ref={textareaRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={
              contextType === "profile"
                ? `¿Qué estás pensando, ${currentUserName.split(" ")[0] || "tú"}?`
                : "Comparte algo en esta comunidad..."
            }
            style={{
              width: "100%",
              minHeight: 150,
              maxHeight: 220,
              resize: "none",
              border: "none",
              outline: "none",
              background: "transparent",
              color: "#fff",
              fontFamily: fontStack,
              fontSize: 24,
              fontWeight: 400,
              lineHeight: "31px",
              letterSpacing: "-0.04em",
              padding: 0,
              overflowY: "auto",
              WebkitAppearance: "none",
            }}
          />

          {(selectedMediaItems.length > 0 ||
            processingImageSlots > 0 ||
            processingVideoSlots > 0) && (
            <div style={{ marginTop: 18 }}>
              <div
                ref={previewScrollerRef}
                className="vibra-composer-mobile-scroll"
                style={{
                  display: "flex",
                  gap: 10,
                  overflowX: "auto",
                  overflowY: "hidden",
                  paddingBottom: 10,
                  marginLeft: -2,
                  marginRight: -2,
                  paddingLeft: 2,
                  paddingRight: 2,
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
                                onDragStart={(event) => event.preventDefault()}
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
                                  <span style={{ fontSize: 21, lineHeight: 1 }}>
                                    🎥
                                  </span>
                                  <span
                                    style={{
                                      fontSize: 10,
                                      fontWeight: 850,
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
                                left: "50%",
                                top: "50%",
                                width: 36,
                                height: 36,
                                borderRadius: 999,
                                transform: "translate(-50%, -50%)",
                                display: "grid",
                                placeItems: "center",
                                background: "rgba(0,0,0,0.58)",
                                border: "1px solid rgba(255,255,255,0.24)",
                                color: "#fff",
                                fontSize: 15,
                                lineHeight: 1,
                                pointerEvents: "none",
                                zIndex: 3,
                              }}
                            >
                              ▶
                            </div>

                            <div
                              aria-hidden="true"
                              style={{
                                position: "absolute",
                                right: 7,
                                bottom: 7,
                                minHeight: 21,
                                padding: "4px 7px",
                                borderRadius: 999,
                                background: "rgba(0,0,0,0.68)",
                                color: "#fff",
                                fontSize: 10,
                                fontWeight: 850,
                                lineHeight: 1,
                                display: "inline-flex",
                                alignItems: "center",
                                zIndex: 3,
                              }}
                            >
                              {formatVideoDuration(item.durationSeconds)}
                            </div>
                          </>
                        )}

                        <div
                          style={{
                            position: "absolute",
                            left: 7,
                            top: 7,
                            minWidth: 23,
                            height: 23,
                            borderRadius: 999,
                            background: "rgba(0,0,0,0.62)",
                            color: "#fff",
                            display: "grid",
                            placeItems: "center",
                            fontSize: 11,
                            fontWeight: 850,
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
                          disabled={creating}
                          aria-label={`Quitar media ${index + 1}`}
                          style={{
                            position: "absolute",
                            top: 7,
                            right: 7,
                            width: 27,
                            height: 27,
                            borderRadius: 999,
                            border: "1px solid rgba(255,255,255,0.16)",
                            background: "rgba(0,0,0,0.72)",
                            color: "#fff",
                            cursor: "pointer",
                            fontSize: 16,
                            lineHeight: 1,
                            zIndex: 4,
                          }}
                        >
                          ×
                        </button>
                      </div>

                      {item.type === "video" && (
                        <button
                          type="button"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={() => onChooseVideoCover(item.id)}
                          disabled={creating}
                          style={{
                            width: "100%",
                            minHeight: 31,
                            padding: "7px 7px",
                            borderRadius: 11,
                            border: "1px solid rgba(168,85,247,0.34)",
                            background: "rgba(168,85,247,0.14)",
                            color: "rgba(237,233,254,0.96)",
                            fontSize: 10,
                            fontWeight: 850,
                            fontFamily: fontStack,
                            lineHeight: 1.1,
                            cursor: creating ? "not-allowed" : "pointer",
                            opacity: creating ? 0.55 : 1,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {hasManualCover ? "Cambiar portada" : "Elegir portada"}
                        </button>
                      )}
                    </div>
                  );
                })}

                {Array.from({ length: processingImageSlots }).map((_, index) => (
                  <div
                    key={`processing-image-${index}`}
                    aria-label="Preparando imagen"
                    style={{
                      ...mediaPreviewWrapStyle,
                      animation:
                        "post-preview-loading-pulse 1.6s ease-in-out infinite",
                    }}
                  />
                ))}

                {Array.from({ length: processingVideoSlots }).map((_, index) => (
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
                ))}

                {canAddMoreMedia && (
                  <button
                    type="button"
                    onClick={onOpenMediaPicker}
                    disabled={creating}
                    aria-label="Agregar otra media"
                    style={{
                      width: 104,
                      height: 104,
                      borderRadius: 16,
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
                  >
                    +
                  </button>
                )}
              </div>
            </div>
          )}

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
        </main>

        <footer
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            padding: "10px 14px calc(10px + env(safe-area-inset-bottom))",
            borderTop: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(18,19,21,0.96)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
          }}
        >
          <div
            style={{
              minHeight: 54,
              padding: "8px 10px",
              borderRadius: 16,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.035)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <strong
              style={{
                fontSize: 13,
                fontWeight: 850,
                letterSpacing: "-0.02em",
                color: "rgba(255,255,255,0.92)",
              }}
            >
              Agregar
            </strong>

            <button
              type="button"
              onClick={onOpenMediaPicker}
              disabled={creating || isPreparingImages}
              title="Agregar fotos o videos"
              aria-label="Agregar fotos o videos"
              style={{
                width: 44,
                height: 44,
                borderRadius: 999,
                border: "none",
                background: "rgba(255,255,255,0.06)",
                color: "#a855ff",
                display: "grid",
                placeItems: "center",
                cursor:
                  creating || isPreparingImages ? "not-allowed" : "pointer",
                opacity: creating || isPreparingImages ? 0.45 : 1,
              }}
            >
              <VibraNavigationIcon
                type="attachMedia"
                size={30}
                strokeWidth={2.1}
              />
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}