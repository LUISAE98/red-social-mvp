"use client";

import Image from "next/image";
import { GlassEdge, IconButton } from "@/components/ui";
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
import PublishProgressButton from "./PublishProgressButton";
import type { useComposerPremium } from "./useComposerPremium";
import { useTranslations } from "next-intl";
import {
  Avatar, fontStack, formatVideoDuration,
  type PostComposerMobileOverlayProps, type PublishVisualState,
} from "./PostComposerMobileOverlay.parts";

export default function PostComposerMobileOverlay({
  open,
  onClose,
  text,
  setText,
  contextType = "group",
  currentUserName,
  currentUserAvatar,
  currentUserHref,
  publishProgress = null,
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
  const tGroups = useTranslations("groups");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const tCommon = useTranslations("common");
  const tPosts = useTranslations("posts");
  const tLive = useTranslations("live");
  const dragStartYRef = useRef(0);
  const dragStartOffsetYRef = useRef(0);
  const publishSuccessTimerRef = useRef<number | null>(null);
  const publishWasRequestedRef = useRef(false);
  const onCloseRef = useRef(onClose);

  /** Hueco de la cabecera flotante; el scroller lo repone con relleno. */
  const [topInset, setTopInset] = useState(0);

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
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
      // eslint-disable-next-line react-hooks/set-state-in-effect
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

  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;

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
    };
  }, [open]);

  useEffect(() => {
    if (open) return;

    publishWasRequestedRef.current = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPublishVisualState("idle");

    if (publishSuccessTimerRef.current !== null) {
      window.clearTimeout(publishSuccessTimerRef.current);
      publishSuccessTimerRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    if (creating || isPreparingImages) {
      if (publishWasRequestedRef.current || creating) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
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
        inset: 0,
        height: "var(--vb-alto-pantalla)",
        zIndex: 999999,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        // El safe-area NO va aquí (elevaría el panel y dejaría el backdrop como
        // "barra negra"): va como padding interno del contenido para que el fondo
        // del panel llene el hueco del home-indicator sin franja del backdrop.
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
            border-top-color: #a855f7;
            border-inline-end-color: #a855f7;
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
    height: "calc(var(--vb-alto-pantalla) - 72px)",
    maxHeight: "calc(var(--vb-alto-pantalla) - 72px)",
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
  {/* Cabecera flotante: lo que se escribe se disuelve al subir por detrás en
      vez de cortarse contra el canto. */}
  <GlassEdge side="top" onHeight={setTopInset} veil="rgba(10,10,10,0.68)" zIndex={4}>
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
      {isEditMode ? tPosts("editPostTitle") : tPosts("createPostTitle")}
    </h2>

    {/* El boton de publicar ya NO vive aqui: se mudo al pie, a lo ancho.
        La tercera columna de la rejilla se queda vacia a proposito, para que
        el titulo siga centrado respecto a la cruz de cerrar. */}
    <span aria-hidden="true" />
  </header>
  </GlassEdge>

        <div
          className="vibra-composer-mobile-scroll"
          style={{
            /* La cabecera ya no ocupa sitio: el scroll usa el alto entero y le
               repone el hueco con su relleno. */
            height: "100%",
            maxHeight: "100%",
            overflowY: "auto",
          }}
        >
          <div style={{ padding: `${topInset + 18}px 20px calc(8px + var(--vb-safe-bottom, 0px))` }}>
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
                      // El degradado canonico de marca, el mismo que <Button variant="gradient">
                      // (ver vibra_style.md). Sale de los tokens y no de tres hex sueltos, asi
                      // que sigue al morado de marca si algun dia se mueve.
                      background:
                        "linear-gradient(135deg, var(--pink) 0%, var(--brand-strong) 52%, #3b82f6 100%)",
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
                      // Sin halo: el color ya destaca de sobra sobre el negro, y la sombra
                      // morada difusa lo dejaba flotando por encima de todo lo demas.
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
                                onPointerDown={(event) =>
                                  event.stopPropagation()
                                }
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
                        aria-label={tGroups("preparingImage")}
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

            {/* A lo ancho y al final. Antes era una pildora en la esquina de
                la cabecera: el gesto de publicar quedaba lejos del pulgar y
                competia en tamano con la cruz de cerrar, que hace lo
                contrario. Aqui es lo mas grande de la pantalla, que es lo que
                le toca al unico gesto que cierra el flujo. */}
            <div style={{ marginTop: 16 }}>
              <PublishProgressButton
                progress={publishProgress}
                creating={isPublishLoading}
                success={isPublishSuccess}
                disabled={disabledPublish && !isPublishIconState}
                isEditMode={isEditMode}
                onClick={handlePublishClick}
              />
            </div>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}
