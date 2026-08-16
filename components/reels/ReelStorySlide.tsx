"use client";

// UN saludo o consejo a pantalla completa. Video, cabecera del creador, panel de
// contexto con lectura en voz alta y botón de compra.
//
// Este componente NO sabe cómo se navega entre historias. Esa era justo la mezcla
// que tenía StoryViewer, que hacía de slide y de carrusel a la vez, y por eso el
// feed de reels no podía reutilizarlo sin clonarlo: el reel navega scrolleando en
// vertical, el visor de círculos navega tocando los lados y deslizando en
// horizontal, pero el CONTENIDO de una historia es el mismo en los dos.
//
// Lo que el anfitrión quiera pintar encima entra por capas con nombre, para que el
// apilamiento lo siga decidiendo el slide:
//   topSlot          → z 10, arriba (barras de progreso del visor de círculos)
//   tapLayer         → z 5, sobre el video y bajo los controles (zonas de toque)
//   topRightActions  → junto al botón de silencio (cerrar)

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { StoryDoc, StoryType } from "@/lib/stories/types";
import { useTextReader, scrollCursorIntoView } from "@/lib/tts/useTextReader";
import { useGreetingPurchase } from "@/lib/greetings/useGreetingPurchase";
import { buildStoryUrl } from "@/lib/reels/reelStories";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import VibraShareIcon from "@/app/components/VibraServiceIcons/VibraShareIcon";

const VIBRA_RING = "linear-gradient(135deg, #ec4899 0%, #9333ea 52%, #3b82f6 100%)";
const FONT = "inherit";
/** Segundos reproducidos para contar la historia como vista. */
const VIEW_THRESHOLD_MS = 2_000;

type Props = {
  story: StoryDoc;
  /** Fuerza la etiqueta mostrada. El visor de círculos agrupa por tipo. */
  type?: StoryType;
  /** Pausa impuesta desde fuera (mantener pulsado, slide fuera de pantalla). */
  paused?: boolean;
  muted: boolean;
  onMutedChange: (muted: boolean) => void;
  /** Tipografías e iconos más pequeños, para el panel de escritorio. */
  compact?: boolean;
  safeTop?: string | number;
  safeBottom?: string | number;
  /** Esconde todos los controles mientras el anfitrión anima. */
  overlaysHidden?: boolean;
  /** Repetir al terminar. El reel no avanza solo; el visor de círculos sí. */
  loop?: boolean;
  topSlot?: ReactNode;
  tapLayer?: ReactNode;
  topRightActions?: ReactNode;
  onProgress?: (ratio: number) => void;
  onEnded?: () => void;
  onViewed?: () => void;
};

export default function ReelStorySlide({
  story,
  type,
  paused = false,
  muted,
  onMutedChange,
  compact = false,
  safeTop = 12,
  safeBottom = 0,
  overlaysHidden = false,
  loop = false,
  topSlot,
  tapLayer,
  topRightActions,
  onProgress,
  onEnded,
  onViewed,
}: Props) {
  const tCommon = useTranslations("common");
  const tWallet = useTranslations("wallet");
  const tServices = useTranslations("services");
  const tGroups = useTranslations("groups");
  const { toast: shareToast, showToast: showShareToast } = useVibraToast(2400);

  /**
   * Comparte el enlace directo a ESTA historia.
   *
   * En móvil abre la hoja del sistema; donde no existe, copia al portapapeles.
   * Mismo comportamiento que compartir una publicación, para que no haya dos
   * formas distintas de compartir en la misma app.
   */
  async function handleShare() {
    const url = buildStoryUrl(story.id);
    const copy = async () => {
      await navigator.clipboard.writeText(url);
      showShareToast(tCommon("linkCopiedToClipboard"), "success");
    };
    try {
      if (navigator.share) {
        await navigator.share({ url });
        return;
      }
      await copy();
    } catch {
      try {
        await copy();
      } catch {
        showShareToast(tGroups("copyManuallyError"), "error");
      }
    }
  }

  // Lo que ya viene en el documento se DERIVA, no se copia a estado. El estado
  // guarda solo lo que hubo que ir a buscar. Copiarlo obligaba a un efecto por
  // campo para resincronizarlo, que es justo la cascada de renders que hay que
  // evitar, y además dejaba dos fuentes de verdad para el mismo dato.
  const [fetchedPlaybackId, setFetchedPlaybackId] = useState<string | null>(null);
  const [fetchedInstructions, setFetchedInstructions] = useState<{ text: string | null } | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [videoAspect, setVideoAspect] = useState<{ w: number; h: number } | null>(null);
  const [creator, setCreator] = useState<{
    name: string | null;
    photo: string | null;
    handle: string | null;
  } | null>(null);
  const [contextOpen, setContextOpen] = useState(false);

  const resolvedPlaybackId = story.muxPlaybackId ?? fetchedPlaybackId;
  const instructions = story.instructions ?? fetchedInstructions?.text ?? null;
  const instructionsLoading =
    !story.instructions && !!story.greetingRequestId && fetchedInstructions === null;
  // A quién se le encarga el nuevo saludo: quien GRABÓ, no quien publicó.
  const greetingAuthorUid = story.greetingCreatorId ?? story.creatorId ?? null;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const progressRafRef = useRef<number | null>(null);
  const viewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewedRef = useRef(false);
  const contextDragStartY = useRef<number | null>(null);
  // Nodos del texto leído. Viven aquí y no en `useTextReader` porque un hook que
  // devuelve refs contamina todo lo que devuelve, y entonces leer el resaltado al
  // pintar deja de estar permitido.
  const readerTextRef = useRef<HTMLParagraphElement | null>(null);
  const readerCursorRef = useRef<HTMLSpanElement | null>(null);

  const effectiveType = type ?? story.type;

  // ── Datos de la historia ──────────────────────────────────────────────────

  // El video puede no estar listo cuando se publicó la historia. El backend ya
  // parchea el playbackId (webhook de Mux + disparador de creación), pero si el
  // creador está mirando su propia historia recién publicada, esta escucha se lo
  // muestra en cuanto aparece sin recargar.
  useEffect(() => {
    if (story.muxPlaybackId || !story.greetingRequestId) return;
    return onSnapshot(doc(db, "greetingRequests", story.greetingRequestId), (snap) => {
      const id = snap.data()?.muxPlaybackId as string | null | undefined;
      if (typeof id === "string" && id) setFetchedPlaybackId(id);
    });
  }, [story.greetingRequestId, story.muxPlaybackId]);

  // El contexto viene en la propia historia; el respaldo por `greetingRequests`
  // es para las antiguas, y solo funciona si quien mira es comprador o creador.
  useEffect(() => {
    if (story.instructions || !story.greetingRequestId) return;
    let cancelled = false;
    getDoc(doc(db, "greetingRequests", story.greetingRequestId))
      .then((snap) => {
        if (cancelled) return;
        const instr = snap.data()?.instructions;
        setFetchedInstructions({
          text: typeof instr === "string" && instr.trim() ? instr.trim() : null,
        });
      })
      .catch(() => {
        // Un objeto, aunque el texto sea nulo, marca que la búsqueda terminó.
        if (!cancelled) setFetchedInstructions({ text: null });
      });
    return () => {
      cancelled = true;
    };
  }, [story.instructions, story.greetingRequestId]);

  // La cabecera muestra SIEMPRE a quien GRABÓ el video, nunca a quien publicó la
  // historia. Son distintos cuando el comprador republica en su perfil el saludo
  // que le hicieron, y en ese caso la cara que corresponde sigue siendo la del
  // creador: es su trabajo, y es a él a quien se le encarga uno nuevo desde el
  // botón de comprar. Antes se leía `story.creatorId`, que es el publicador, así
  // que esa misma historia salía con dos caras distintas según quién la subiera.
  useEffect(() => {
    if (!greetingAuthorUid) return;
    let cancelled = false;
    getDoc(doc(db, "users", greetingAuthorUid))
      .then((snap) => {
        if (cancelled) return;
        const d = snap.data();
        setCreator({
          name: typeof d?.displayName === "string" ? d.displayName : null,
          photo: typeof d?.photoURL === "string" ? d.photoURL : null,
          handle: typeof d?.handle === "string" ? d.handle : null,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [greetingAuthorUid]);

  // ── Lectura del contexto y compra ─────────────────────────────────────────

  const readerText = instructionsLoading
    ? tServices("loadingContext")
    : (instructions ?? tServices("noContextAvailable"));

  const reader = useTextReader(instructions ?? tServices("noContextAvailable"), {
    // Al terminar de leer, el panel se cierra solo.
    onFinished: () => setContextOpen(false),
  });

  const purchase = useGreetingPurchase({
    creatorId: greetingAuthorUid,
    creatorName: creator?.name ?? null,
    creatorPhoto: creator?.photo ?? null,
    type: effectiveType,
    source: story.source === "group" ? "group" : "profile",
    groupId: story.source === "group" ? story.groupId : null,
  });

  // Cerrar el panel calla la lectura.
  useEffect(() => {
    if (!contextOpen) reader.stop();
  }, [contextOpen, reader]);

  // El cursor de lectura sigue a la voz. El <p> no scrollea, lo hace su padre.
  useEffect(() => {
    scrollCursorIntoView(readerCursorRef.current, readerTextRef.current?.parentElement ?? null);
  }, [reader.highlight]);

  // ── Video ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  // Un solo sitio decide si el video corre. El anfitrión impone `paused`
  // (mantener pulsado, slide fuera de pantalla) y el slide añade sus propios
  // motivos, que son sus modales abiertos.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (paused || contextOpen || purchase.isOpen) {
      video.pause();
    } else {
      video.play().catch(() => {});
    }
  }, [paused, contextOpen, purchase.isOpen]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoReady || !onProgress) return;
    const tick = () => {
      const v = videoRef.current;
      if (!v) return;
      const dur = v.duration;
      if (dur > 0) onProgress(v.currentTime / dur);
      progressRafRef.current = requestAnimationFrame(tick);
    };
    progressRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (progressRafRef.current !== null) cancelAnimationFrame(progressRafRef.current);
    };
  }, [videoReady, onProgress]);

  useEffect(
    () => () => {
      if (viewTimerRef.current !== null) clearTimeout(viewTimerRef.current);
    },
    [],
  );

  function markViewed() {
    if (viewedRef.current) return;
    viewedRef.current = true;
    onViewed?.();
  }

  function handleVideoPlay() {
    if (viewedRef.current) return;
    if (viewTimerRef.current !== null) clearTimeout(viewTimerRef.current);
    // Un video más corto que el umbral nunca llegaría a cumplirlo, así que ese se
    // cuenta al terminar.
    const knownDur = story.videoDuration ?? videoRef.current?.duration ?? null;
    if (knownDur !== null && knownDur < VIEW_THRESHOLD_MS / 1000) return;
    viewTimerRef.current = setTimeout(markViewed, VIEW_THRESHOLD_MS);
  }

  function handleVideoEnded() {
    if (viewTimerRef.current !== null) clearTimeout(viewTimerRef.current);
    if ((videoRef.current?.duration ?? Infinity) < VIEW_THRESHOLD_MS / 1000) markViewed();
    onProgress?.(1);
    onEnded?.();
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const videoProcessing = !resolvedPlaybackId;
  const videoUrl = resolvedPlaybackId
    ? `https://stream.mux.com/${resolvedPlaybackId}/high.mp4`
    : null;
  const thumbUrl = resolvedPlaybackId
    ? `https://image.mux.com/${resolvedPlaybackId}/thumbnail.jpg?time=0`
    : null;
  const label =
    effectiveType === "saludo" ? tWallet("typeLabelGreeting") : tWallet("typeLabelAdvice");
  const isLandscape = !!videoAspect && videoAspect.w > videoAspect.h;

  const avatarSz = compact ? 40 : 54;
  const avatarInset = compact ? 5 : 6;
  const profileHref = creator?.handle ? `/u/${creator.handle}` : null;
  const btnPadBottom = typeof safeBottom === "string" ? `max(8px, ${safeBottom})` : "8px";

  const avatarRing = (
    <div style={{ position: "relative", width: avatarSz, height: avatarSz, flexShrink: 0 }}>
      <div style={{ position: "absolute", inset: avatarInset, borderRadius: "50%", overflow: "hidden", background: "rgba(255,255,255,0.1)" }}>
        {creator?.photo ? (
          <Image src={creator.photo} alt="" fill style={{ objectFit: "cover" }} />
        ) : (
          <div style={{ width: "100%", height: "100%", background: "rgba(255,255,255,0.15)" }} />
        )}
      </div>
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          background: VIBRA_RING,
          WebkitMaskImage: "radial-gradient(farthest-side, transparent calc(100% - 3px), white calc(100% - 3px))",
          maskImage: "radial-gradient(farthest-side, transparent calc(100% - 3px), white calc(100% - 3px))",
        }}
      />
    </div>
  );

  const headerStyle: React.CSSProperties = {
    position: "absolute",
    top: typeof safeTop === "number" ? safeTop + 36 : `calc(${safeTop} + 36px)`,
    insetInlineStart: 12,
    zIndex: 10,
    display: "flex",
    alignItems: "center",
    gap: compact ? 6 : 8,
    textDecoration: "none",
    WebkitTapHighlightColor: "transparent",
    cursor: profileHref ? "pointer" : "default",
  };
  const headerInner = (
    <>
      {avatarRing}
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <span style={{ color: "#fff", fontSize: compact ? 13 : 17, fontWeight: 600, lineHeight: "1.2", fontFamily: FONT }}>
          {creator?.name ?? ""}
        </span>
        <span style={{ color: "rgba(255,255,255,0.75)", fontSize: compact ? 11 : 13, fontWeight: 500, lineHeight: "1.2", fontFamily: FONT }}>
          {label}
        </span>
      </div>
    </>
  );

  return (
    <>
      {videoUrl && (
        <video
          ref={videoRef}
          src={videoUrl}
          poster={thumbUrl ?? undefined}
          // Solo la que está en pantalla descarga video. Las vecinas se montan
          // para que el cambio de slide sea inmediato, pero con `metadata` el
          // navegador pide cabeceras y para. Antes las tres bajaban el MP4
          // entero, y en datos móviles eso es triple consumo por cada scroll.
          preload={paused ? "metadata" : "auto"}
          autoPlay={!paused}
          playsInline
          loop={loop}
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
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: isLandscape ? "contain" : "cover",
            zIndex: 1,
          }}
        />
      )}

      {videoProcessing && (
        <div style={{ position: "absolute", inset: 0, zIndex: 3, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, background: "#0a0a0e" }}>
          <style>{`@keyframes storySpinner { to { transform: rotate(360deg); } }`}</style>
          <div style={{ width: 36, height: 36, borderRadius: "50%", border: "3px solid rgba(255,255,255,0.12)", borderTopColor: "#a855f7", animation: "storySpinner 0.8s linear infinite" }} />
          {/* Sin traducir, tal cual venía de StoryViewer. No se toca aquí para que
              B2 no cambie nada visible; entra con la revisión de copy del reel. */}
          <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 13, fontFamily: FONT }}>
            Procesando video...
          </span>
        </div>
      )}

      {tapLayer}

      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: overlaysHidden ? 0 : 1,
          transition: overlaysHidden ? "none" : "opacity 180ms ease",
          pointerEvents: overlaysHidden ? "none" : undefined,
        }}
      >
        {topSlot}

        {profileHref ? (
          <Link href={profileHref} onClick={(e) => e.stopPropagation()} style={headerStyle}>
            {headerInner}
          </Link>
        ) : (
          <div style={headerStyle}>{headerInner}</div>
        )}

        {/* Silencio + lo que aporte el anfitrión (cerrar) */}
        <div
          style={{
            position: "absolute",
            top: typeof safeTop === "number"
              ? safeTop + 28 + avatarSz / 2
              : `calc(${safeTop} + ${28 + avatarSz / 2}px)`,
            insetInlineEnd: 10,
            transform: "translateY(-50%)",
            display: "flex",
            alignItems: "center",
            gap: 4,
            zIndex: 11,
          }}
        >
          <button
            type="button"
            aria-label={muted ? tCommon("unmute") : tCommon("muteAriaLabel")}
            onClick={(e) => {
              e.stopPropagation();
              onMutedChange(!muted);
            }}
            style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.9)", padding: "0 5px", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            {muted ? (
              <svg width={compact ? 20 : 24} height={compact ? 20 : 24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <line x1="23" y1="9" x2="17" y2="15" />
                <line x1="17" y1="9" x2="23" y2="15" />
              </svg>
            ) : (
              <svg width={compact ? 20 : 24} height={compact ? 20 : 24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              </svg>
            )}
          </button>
          <button
            type="button"
            aria-label={tCommon("shareStory")}
            title={tCommon("shareStory")}
            onClick={(e) => {
              e.stopPropagation();
              void handleShare();
            }}
            style={{ background: "none", border: "none", cursor: "pointer", padding: "0 5px", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <VibraShareIcon size={compact ? 20 : 23} color="rgba(255,255,255,0.9)" />
          </button>
          {topRightActions}
        </div>

        {/* Panel de contexto flotante + botones */}
        <div style={{ position: "absolute", insetInlineStart: 0, insetInlineEnd: 0, bottom: 0, display: "flex", flexDirection: "column", zIndex: 10 }}>
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
            <div style={{ background: "rgba(37,99,235,0.62)", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 16, display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "8px 10px 4px", flexShrink: 0 }}>
                {reader.state !== "idle" && (
                  <button
                    type="button"
                    aria-label={tServices("changeReadingSpeed")}
                    onTouchStart={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      reader.cycleRate();
                    }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.75)", padding: "4px 6px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginInlineEnd: 6, fontSize: 12, fontWeight: 700, letterSpacing: "-0.3px" }}
                  >
                    {reader.rate}×
                  </button>
                )}
                <button
                  type="button"
                  disabled={instructionsLoading || !instructions}
                  aria-label={
                    reader.state === "playing"
                      ? tServices("pauseReading")
                      : reader.state === "paused"
                        ? tServices("resumeReading")
                        : tServices("readContext")
                  }
                  onTouchStart={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    reader.toggle();
                  }}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.85)", padding: 4, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginInlineEnd: 6, transition: "color 0.15s" }}
                >
                  {reader.state === "playing" ? (
                    <svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor">
                      <rect x="5" y="4" width="4" height="16" rx="1" />
                      <rect x="15" y="4" width="4" height="16" rx="1" />
                    </svg>
                  ) : (
                    <svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="5,3 19,12 5,21" />
                    </svg>
                  )}
                </button>
                <button
                  type="button"
                  aria-label={tCommon("closeContextAriaLabel")}
                  onTouchStart={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setContextOpen(false);
                  }}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.75)", padding: 4, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                >
                  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>

              <div style={{ overflowY: "auto", maxHeight: "calc(50vh - 44px)" }}>
                <p
                  ref={readerTextRef}
                  onClick={(e) => {
                    e.stopPropagation();
                    reader.seekFromPoint(e.clientX, e.clientY, readerTextRef.current);
                  }}
                  style={{
                    margin: "4px 18px 14px",
                    color: "rgba(255,255,255,0.88)",
                    fontSize: compact ? 13 : 15,
                    fontFamily: FONT,
                    lineHeight: 1.55,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    cursor: "text",
                    userSelect: "none",
                  }}
                >
                  {reader.state === "idle" || !reader.highlight ? (
                    readerText
                  ) : (
                    <>
                      <strong style={{ color: "#fff", fontWeight: 700 }}>
                        {readerText.slice(0, reader.highlight.start + reader.highlight.length)}
                      </strong>
                      <span ref={readerCursorRef} />
                      {readerText.slice(reader.highlight.start + reader.highlight.length)}
                    </>
                  )}
                </p>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, padding: "0 14px", paddingBottom: btnPadBottom }}>
            <button
              type="button"
              onTouchStart={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setContextOpen((v) => !v);
              }}
              style={{ flex: 1, padding: compact ? "8px 10px" : "11px 10px", borderRadius: 10, border: "none", background: "#3b82f6", color: "#fff", fontSize: compact ? 12 : 14, fontWeight: 600, fontFamily: FONT, cursor: "pointer", letterSpacing: "-0.01em", transition: "opacity 150ms ease", WebkitTapHighlightColor: "transparent" }}
            >
              {tServices("contextLabel")}
            </button>
            <button
              type="button"
              onTouchStart={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                purchase.open();
              }}
              style={{ flex: 1, padding: compact ? "8px 10px" : "11px 10px", borderRadius: 10, border: "none", background: "linear-gradient(135deg, #f472b6, #a855f7)", color: "#fff", fontSize: compact ? 12 : 14, fontWeight: 600, fontFamily: FONT, cursor: "pointer", letterSpacing: "-0.01em", transition: "opacity 150ms ease", WebkitTapHighlightColor: "transparent" }}
            >
              {effectiveType === "saludo" ? tServices("wantGreeting") : tServices("wantAdvice")}
            </button>
          </div>
        </div>
      </div>

      {purchase.modals}
      <VibraToast toast={shareToast} />
    </>
  );
}
