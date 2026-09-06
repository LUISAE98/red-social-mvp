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

import FillImage from "@/components/ui/FillImage";
import { IconButton, SkeletonBlock } from "@/components/ui";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations, useLocale } from "next-intl";
import { AvatarRing, medidaAroEnCaja } from "@/components/ui/AvatarRing";
import { ReadAlongText } from "@/components/tts/ReadAlongText";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { StoryDoc, StoryType } from "@/lib/stories/types";
import { useTextReader, scrollCursorIntoView } from "@/lib/tts/useTextReader";
import { vozParaLocale } from "@/lib/tts/voices";
import { useGreetingPurchase } from "@/lib/greetings/useGreetingPurchase";
import { useCreatorProfile } from "@/lib/reels/creatorProfiles";
import { buildStoryUrl } from "@/lib/reels/reelStories";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import VibraShareIcon from "@/app/components/VibraServiceIcons/VibraShareIcon";
import VibraFlameIcon from "@/app/components/VibraServiceIcons/VibraFlameIcon";
import { hasLikedStory, toggleStoryLike } from "@/lib/stories/storyLikes";
import { useAuth } from "@/app/providers";
import FollowCreatorButton from "@/components/social/FollowCreatorButton";
import { PLAY_COUNT_THRESHOLD, recordStoryPlay } from "@/lib/stories/storyPlays";
import ScrubBar from "./ScrubBar";

/**
 * Aire bajo los botones de la última fila, en píxeles.
 *
 * Antes eran 8px fijos. Con el safe-area inferior a cero en toda la plataforma,
 * esos 8px son literalmente lo que separa un botón del canto de la pantalla, y
 * los controles se leen como si se salieran por abajo.
 *
 * Se SUMA a lo que llegue en `safeBottom` (en el reel, el alto de la barra
 * inferior), no lo sustituye: en el reel los botones tienen que quedar por
 * encima de la barra Y además respirar.
 */
const BOTTOM_BREATHING_PX = 20;


const FONT = "inherit";
/** Segundos reproducidos para contar la historia como vista. */
const VIEW_THRESHOLD_MS = 2_000;

/**
 * Acorta el numero de vistas cuando crece.
 *
 * Va en la misma fila que los controles de lectura, y ahi no cabe un numero de
 * siete cifras sin empujar a los botones.
 */
function formatPlays(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1_000;
    return `${k < 10 ? k.toFixed(1).replace(/.0$/, "") : Math.round(k)}K`;
  }
  const m = n / 1_000_000;
  return `${m < 10 ? m.toFixed(1).replace(/.0$/, "") : Math.round(m)}M`;
}

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
  /**
   * Pinta su propia barra de progreso, con la que además se puede avanzar y
   * retroceder. El visor de círculos no la usa: trae la suya por segmentos.
   */
  showProgressBar?: boolean;
  /**
   * Recibe una función para saltar a una fracción del video. Se la queda el
   * anfitrión que dibuje su propia barra, porque el video vive aquí dentro.
   */
  seekRef?: { current: ((ratio: number) => void) | null };
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
  showProgressBar = false,
  seekRef,
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
  const locale = useLocale();
  const tGroups = useTranslations("groups");
  const { toast: shareToast, showToast: showShareToast } = useVibraToast(2400);
  const { user: likeUser } = useAuth();
  // Una cuenta anonima puede mirar, pero no reaccionar: darse de alta como
  // anonimo cuesta un clic y una flamita repetible sin limite no mide nada.
  const likeUid = likeUser && !likeUser.isAnonymous ? likeUser.uid : null;
  // Mientras la hoja de compartir está abierta el video se detiene, igual que
  // con el contexto o con la compra. `navigator.share` no resuelve hasta que se
  // cierra, así que sirve de señal exacta de "sigue abierta".
  const [sharing, setSharing] = useState(false);

  /**
   * Da o quita la flamita.
   *
   * Se pinta ANTES de llamar al servidor y se revierte si falla: en un reel el
   * dedo ya va camino de la siguiente historia, y esperar a la red para encender
   * el icono se siente como que el toque no registro.
   */
  async function handleLike(e: React.MouseEvent) {
    e.stopPropagation();
    if (!likeUid || likeBusyRef.current) return;
    likeBusyRef.current = true;
    const antesLiked = liked;
    const antesLikes = likes;
    setLiked(!antesLiked);
    setLikes(Math.max(0, antesLikes + (antesLiked ? -1 : 1)));
    const res = await toggleStoryLike(story.id);
    if (res) {
      // El servidor es quien lleva la cuenta buena: si dos personas votan a la
      // vez, su numero es el que vale.
      setLiked(res.liked);
      setLikes(res.likes);
    } else {
      setLiked(antesLiked);
      setLikes(antesLikes);
    }
    likeBusyRef.current = false;
  }

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
    setSharing(true);
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
    } finally {
      // Al cerrar la hoja —compartiendo o cancelando— el video sigue.
      setSharing(false);
    }
  }

  // Lo que ya viene en el documento se DERIVA, no se copia a estado. El estado
  // guarda solo lo que hubo que ir a buscar. Copiarlo obligaba a un efecto por
  // campo para resincronizarlo, que es justo la cascada de renders que hay que
  // evitar, y además dejaba dos fuentes de verdad para el mismo dato.
  const [fetchedPlaybackId, setFetchedPlaybackId] = useState<string | null>(null);
  const [fetchedInstructions, setFetchedInstructions] = useState<{ text: string | null } | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  // El video ya está pintando imagen real. Hasta entonces se ve la portada.
  const [videoStarted, setVideoStarted] = useState(false);
  const [videoAspect, setVideoAspect] = useState<{ w: number; h: number } | null>(null);
  const [contextOpen, setContextOpen] = useState(false);
  // Progreso propio, para la barra que pinta este componente. El anfitrión que
  // trae la suya sigue recibiéndolo por `onProgress`.
  const [ownProgress, setOwnProgress] = useState(0);
  // Mientras se arrastra la barra, el video se detiene: reproducir y arrastrar a
  // la vez hace que el indicador pelee contra el dedo.
  const [scrubbing, setScrubbing] = useState(false);
  // Vistas de ESTA historia. Arranca con lo que traiga el documento y sube sola
  // cuando esta reproduccion cuenta: el numero del servidor tardaria en volver y
  // el espectador acaba de hacer que suba.
  const [plays, setPlays] = useState<number>(story.viewsCount ?? 0);
  // Una apertura, una vista como mucho. Sin esto, el reel repite en bucle y
  // cruzaria el 35% cada vuelta, sumando una vista cada treinta segundos por el
  // mero hecho de dejar la pantalla abierta.
  const playCountedRef = useRef(false);
  /** Cuando se repinto la barra por ultima vez. */
  const lastProgressPaintRef = useRef(0);
  // Flamitas. Es UNA por persona y global: darla aqui o desde el perfil del
  // creador es lo mismo, y el numero es el mismo en los dos sitios.
  const [liked, setLiked] = useState(false);
  const [likes, setLikes] = useState<number>(story.likesCount ?? 0);
  const likeBusyRef = useRef(false);

  const resolvedPlaybackId = story.muxPlaybackId ?? fetchedPlaybackId;
  const instructions = story.instructions ?? fetchedInstructions?.text ?? null;
  const instructionsLoading =
    !story.instructions && !!story.greetingRequestId && fetchedInstructions === null;
  // Los contadores vuelven a su sitio con cada historia: el visor de circulos
  // reutiliza este mismo componente cambiandole la historia, sin desmontarlo.
  useEffect(() => {
    playCountedRef.current = false;
    setPlays(story.viewsCount ?? 0);
  }, [story.id, story.viewsCount]);

  useEffect(() => {
    setLikes(story.likesCount ?? 0);
  }, [story.id, story.likesCount]);

  // Si ya le diste flamita se lee de TU propio espejo, no de la subcoleccion de
  // la historia: es un documento tuyo, y responde sin depender de las reglas del
  // contenido.
  useEffect(() => {
    const uid = likeUid;
    if (!uid) {
      setLiked(false);
      return;
    }
    let cancelled = false;
    void hasLikedStory(uid, story.id).then((yes) => {
      if (!cancelled) setLiked(yes);
    });
    return () => {
      cancelled = true;
    };
  }, [likeUid, story.id]);

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
  // Alto real del bloque inferior (contexto + botones). El velo se ajusta a
  // él en vez de rellenar siempre hasta el tope: con dos líneas de contexto,
  // difuminar media pantalla es difuminar aire.
  const bottomStackRef = useRef<HTMLDivElement | null>(null);
  const [bottomStackH, setBottomStackH] = useState(0);

  const seek = useCallback((ratio: number) => {
    const video = videoRef.current;
    if (!video) return;
    const dur = video.duration;
    if (!Number.isFinite(dur) || dur <= 0) return;
    video.currentTime = Math.min(dur, Math.max(0, ratio * dur));
  }, []);

  useEffect(() => {
    if (!seekRef) return;
    seekRef.current = seek;
    return () => {
      seekRef.current = null;
    };
  }, [seekRef, seek]);

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
  //
  // ⚠️ Del lector COMPARTIDO, no de una lectura propia de este panel. El mismo
  // documento lo necesitan tambien la compra y las vistas previas, y cuando
  // cada uno abria la suya el nombre, la foto y el precio llegaban por separado:
  // eso era lo que se veia como inestabilidad. Un creador ya leido sale puesto
  // desde el primer pintado, sin pasar por el esqueleto.
  const creator = useCreatorProfile(greetingAuthorUid);
  /** Todavia no se sabe quien es. Lo que depende de el va en esqueleto. */
  const creatorPendiente = !!greetingAuthorUid && creator === undefined;

  useEffect(() => {
    if (greetingAuthorUid) return;
    // Sin identificador de creador no hay nombre, ni foto, ni precio: la
    // historia sale muda y sin poder comprarse. Es un dato que falta en el
    // documento, no un fallo de red, y por eso conviene verlo.
    console.warn("[ReelStorySlide] historia sin creador:", story.id, {
      creatorId: story.creatorId,
      greetingCreatorId: story.greetingCreatorId,
      esMuestra: story.isSample,
    });
  }, [greetingAuthorUid, story.id, story.creatorId, story.greetingCreatorId, story.isSample]);

  // ── Lectura del contexto y compra ─────────────────────────────────────────

  const readerText = instructionsLoading
    ? tServices("loadingContext")
    : (instructions ?? tServices("noContextAvailable"));

  const reader = useTextReader(instructions ?? tServices("noContextAvailable"), {
    // Quien escucha es el creador, leyendo lo que le pidieron.
    voice: vozParaLocale(locale),
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
    if (paused || contextOpen || purchase.isOpen || sharing || scrubbing) {
      video.pause();
      return;
    }
    // ⚠️ `play()` sobre un video YA TERMINADO lo rearranca desde el principio.
    // Sin este guardia, cualquier repintado que vuelva a correr este efecto
    // después del final relanza el video, y en escritorio eso se veía como que
    // la historia se repetía en bucle en vez de pasar a la siguiente.
    //
    // Quien decide qué pasa al acabar es `onEnded`, no este efecto.
    if (video.ended && !loop) return;
    video.play().catch(() => {});
  }, [paused, contextOpen, purchase.isOpen, sharing, scrubbing, loop]);

  // El aviso de progreso va por ref y NO por dependencia.
  //
  // ⚠️ El anfitrion lo pasa como funcion escrita en el propio JSX, asi que cambia
  // de identidad en cada render suyo. Teniendolo como dependencia, el efecto se
  // desmontaba y volvia a montarse sin parar mientras el bucle de animacion
  // repintaba a sesenta por segundo, y React acababa cortando con "Maximum update
  // depth exceeded" y dejando la pantalla rota.
  const onProgressRef = useRef(onProgress);
  useEffect(() => {
    onProgressRef.current = onProgress;
  });

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoReady) return;
    const tick = () => {
      const v = videoRef.current;
      if (!v) return;
      const dur = v.duration;
      if (dur > 0) {
        const ratio = v.currentTime / dur;
        onProgressRef.current?.(ratio);
        // Una VISTA no es el marcador de "ya la vi" de los dos segundos: exige
        // el 35% y suma cada vez que ocurre, tambien si es la misma persona
        // abriendola de nuevo desde otro sitio.
        if (!playCountedRef.current && ratio >= PLAY_COUNT_THRESHOLD) {
          playCountedRef.current = true;
          setPlays((n) => n + 1);
          void recordStoryPlay(story.id);
        }
        // ⚠️ La barra se repinta como MUCHO diez veces por segundo, no sesenta.
        //
        // Este componente es grande. Repintarlo en cada fotograma hace que un
        // render tarde mas de los 16 ms que dura el fotograma, asi que el
        // siguiente llega antes de que React haya terminado: las
        // actualizaciones se apilan, nunca se alcanzan, y React corta con
        // "Maximum update depth exceeded". Es intermitente porque depende de
        // lo cargada que vaya la maquina, y por eso costo tanto de ver.
        //
        // Una barra de progreso a diez por segundo se ve igual de fluida: es
        // una linea fina que avanza despacio. Lo que NO se limita es el aviso
        // al anfitrion, que solo escribe en una referencia y no repinta nada.
        const ahora = performance.now();
        if (ahora - lastProgressPaintRef.current >= 100) {
          lastProgressPaintRef.current = ahora;
          setOwnProgress((prev) => (Math.abs(prev - ratio) < 0.001 ? prev : ratio));
        }
      }
      progressRafRef.current = requestAnimationFrame(tick);
    };
    progressRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (progressRafRef.current !== null) cancelAnimationFrame(progressRafRef.current);
    };
    // `story.id` entra de verdad en juego: el visor de circulos cambia de
    // historia SIN desmontar, y sin esta dependencia el bucle seguiria contando
    // la vista a la historia anterior.
  }, [videoReady, story.id]);

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

  // El alto cambia con el texto, con el idioma y al girar el teléfono, así que
  // se observa en vez de medirse una vez.
  useEffect(() => {
    const el = bottomStackRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const alto = entry.contentRect.height;
      // ⚠️ Solo se guarda si cambio de verdad, y el umbral es UN PIXEL.
      //
      // `contentRect.height` es un decimal, y este bloque se anima al abrir y
      // cerrar el contexto: durante la transicion el observador dispara en cada
      // fotograma con alturas que difieren en milesimas, y cada una provocaba un
      // render. Encadenados, React los cuenta como actualizaciones anidadas y
      // corta con "Maximum update depth exceeded".
      //
      // El velo que se alimenta de esta medida se dibuja redondeado a pixeles
      // enteros, asi que las milesimas no pintaban nada de todos modos.
      setBottomStackH((prev) => (Math.abs(prev - alto) < 1 ? prev : alto));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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

  // La flamita: el dibujo y el hueco que deja dentro de la caja del boton.
  const flameIconSize = compact ? 20 : 24;
  const flameInset = (32 - flameIconSize) / 2;

  const avatarSz = compact ? 40 : 54;
  // El hueco de la foto ya no se pone a ojo: es lo que ocupa el aro.
  const avatarInset = medidaAroEnCaja(avatarSz).sobresale;
  const profileHref = creator?.handle ? `/u/${creator.handle}` : null;
  // Aire por debajo de los botones. Con `safeBottom` numérico (historias en el
  // visor de círculos) no hay barra que esquivar y basta con el aire; con string
  // (el reel, que pasa el alto real del nav) se suma al hueco de la barra.
  const btnPadBottom =
    typeof safeBottom === "string"
      ? `calc(${safeBottom} + ${BOTTOM_BREATHING_PX}px)`
      : `${safeBottom + BOTTOM_BREATHING_PX}px`;

  const avatarRing = (
    <div style={{ position: "relative", width: avatarSz, height: avatarSz, flexShrink: 0 }}>
      <div style={{ position: "absolute", inset: avatarInset, borderRadius: "50%", overflow: "hidden", background: "rgba(255,255,255,0.1)" }}>
        {creatorPendiente ? (
          <SkeletonBlock height="100%" circle />
        ) : (
          <FillImage
            src={creator?.photo}
            fallback={<div style={{ width: "100%", height: "100%", background: "rgba(255,255,255,0.15)" }} />}
          />
        )}
      </div>
      <AvatarRing foto={medidaAroEnCaja(avatarSz).foto} />
    </div>
  );

  const headerStyle: React.CSSProperties = {
    position: "absolute",
    top: typeof safeTop === "number" ? safeTop + 36 : `calc(${safeTop} + 36px)`,
    insetInlineStart: 12,
    zIndex: 10,
    display: "flex",
    alignItems: "center",
    // La caja se ajusta a su contenido (avatar, nombre y seguir), así que
    // reactivar aquí no roba más superficie de la que ocupa a la vista.
    pointerEvents: "auto",
  };
  // El enlace al perfil envuelve SOLO avatar y nombre.
  //
  // ⚠️ El botón de seguir queda fuera a propósito: un <button> dentro de un <a>
  // es anidamiento inválido, y el navegador reacomoda el árbol por su cuenta,
  // que es de las formas más desagradables de romper la hidratación.
  const headerLinkStyle: React.CSSProperties = {
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
        {/* El renglon del nombre no se queda en blanco mientras carga: un hueco
            mudo y un creador sin nombre se ven igual. */}
        {creatorPendiente ? (
          <SkeletonBlock width={compact ? 84 : 116} height={compact ? 13 : 17} radius={5} style={{ margin: "1px 0" }} />
        ) : (
          <span style={{ color: "#fff", fontSize: compact ? 13 : 17, fontWeight: 500, lineHeight: "1.2", fontFamily: FONT }}>
            {creator?.name ?? ""}
          </span>
        )}
        <span style={{ color: "rgba(255,255,255,0.75)", fontSize: compact ? 11 : 13, fontWeight: 500, lineHeight: "1.2", fontFamily: FONT }}>
          {label}
        </span>
      </div>
    </>
  );

  return (
    <>
      {videoUrl && (
        <video controlsList="noremoteplayback"
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
          // `playing` es el primer instante con imagen real en pantalla, no
          // `play`, que solo dice que se pidió reproducir.
          //
          // ⚠️ Se espera DOS fotogramas antes de marcarlo. Con el video ya
          // precargado, `playing` llega tan pronto que el estado cambiaba antes
          // del primer pintado: la portada nacía ya en opacidad 0 y el navegador
          // no tenía desde dónde animar, así que desaparecía de golpe.
          onPlaying={() => {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => setVideoStarted(true));
            });
          }}
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

      {/* Portada por encima del video, que se DESVANECE cuando empieza a
          reproducirse. El atributo `poster` desaparece de golpe en el primer
          fotograma, y ese corte seco es lo que se leía como parpadeo al pasar
          de una historia a otra. Aquí la misma imagen se funde. */}
      {thumbUrl && !videoProcessing && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 2,
            backgroundImage: `url(${thumbUrl})`,
            // Sin proporción conocida se usa `contain`, que nunca recorta. Una
            // portada horizontal mostrada con `cover` daría el mismo destello que
            // se está evitando.
            backgroundSize: !videoAspect || isLandscape ? "contain" : "cover",
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
            backgroundColor: "#000",
            // No basta con que empiece a reproducirse: hasta que no se conoce la
            // proporción del video, `objectFit` sigue en `cover` y un video
            // horizontal se ve estirado y recortado un instante. Ese destello se
            // queda DEBAJO de la portada, y solo cuando el encuadre ya es el
            // definitivo se descubre.
            opacity: videoStarted && videoAspect ? 0 : 1,
            transition: "opacity 320ms ease",
            pointerEvents: "none",
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

      {/* Capa de controles.
          ⚠️ Cubre la pantalla ENTERA y va por encima de `tapLayer`, así que si
          recibe toques se los quita a las zonas de avanzar y retroceder. Y sus
          contenedores son casi todos transparentes y de ancho completo —la
          tira del progreso arriba, la fila de la flamita y la de los botones
          abajo—, o sea que se tragaban el toque sin hacer nada: de ahí que
          picar a un lado o a otro funcionara "a veces".

          Por eso la capa NO recibe nada y cada control de verdad se reactiva
          con `pointerEvents: "auto"`. Lo que hay entre control y control deja
          pasar el toque a la zona de debajo.

          Y cuando la capa está oculta se apaga con `visibility`, no con
          `pointer-events`: los hijos ahora piden `auto` a mano y un `none` en
          el padre ya no los frenaría. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: overlaysHidden ? 0 : 1,
          visibility: overlaysHidden ? "hidden" : "visible",
          transition: overlaysHidden ? "none" : "opacity 180ms ease",
          pointerEvents: "none",
        }}
      >
        {topSlot}

        {showProgressBar && (
          <div
            style={{
              position: "absolute",
              top: safeTop,
              insetInlineStart: 0,
              insetInlineEnd: 0,
              paddingTop: 6,
              paddingInlineStart: 10,
              paddingInlineEnd: 10,
              display: "flex",
              zIndex: 12,
            }}
          >
            <ScrubBar
              progress={ownProgress}
              onSeek={seek}
              onScrubbingChange={setScrubbing}
              ariaLabel={tCommon("videoProgress")}
            />
          </div>
        )}

        {profileHref ? (
          <div style={headerStyle}>
            <Link href={profileHref} onClick={(e) => e.stopPropagation()} style={headerLinkStyle}>
              {headerInner}
            </Link>
            {/* Se sigue a quien GRABÓ el video. Cuando el comprador republica el
                saludo que le hicieron, esto apunta al creador, no al comprador. */}
            <FollowCreatorButton targetUserId={greetingAuthorUid} compact={compact} />
          </div>
        ) : (
          <div style={headerStyle}>
            <div style={headerLinkStyle}>{headerInner}</div>
            <FollowCreatorButton targetUserId={greetingAuthorUid} compact={compact} />
          </div>
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
            // También se ajusta a sus iconos, así que no invade el resto.
            pointerEvents: "auto",
          }}
        >
          <IconButton label={muted ? tCommon("unmute") : tCommon("muteAriaLabel")} size="sm" tone="bare" shape="square" onClick={(e) => { e.stopPropagation(); onMutedChange(!muted); }}>
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
          </IconButton>
          <IconButton label={tCommon("shareStory")} size="sm" tone="bare" shape="square" onClick={(e) => { e.stopPropagation(); void handleShare(); }}>
            <VibraShareIcon size={compact ? 20 : 23} color="rgba(255,255,255,0.9)" />
          </IconButton>
          {topRightActions}
        </div>

        {/* Con el contexto abierto, tocar la pantalla lo CIERRA en vez de
            cambiar de historia. Va por encima de las zonas de toque del
            anfitrión (z 5) y por debajo del propio panel (z 10), así que los
            botones de leer y cerrar siguen respondiendo.

            Lo resuelve el slide y no el anfitrión porque `contextOpen` vive
            aquí: el visor de círculos no tiene forma de saber si está abierto. */}
        {contextOpen && (
          <button
            type="button"
            aria-label={tCommon("closeContextAriaLabel")}
            onClick={(e) => {
              e.stopPropagation();
              setContextOpen(false);
            }}
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 8,
              background: "transparent",
              border: "none",
              padding: 0,
              cursor: "default",
              // Con el contexto abierto, este SÍ tiene que cubrirlo todo: es la
              // forma de cerrarlo picando fuera.
              pointerEvents: "auto",
            }}
          />
        )}

        {/* El VELO, en su propia capa y sin nada dentro.
            Mismo patrón que la pestaña del panel de grabación: lo único que
            cambia de tamaño es el velo, y como no envuelve contenido, nada se
            reacomoda al abrir o cerrar.
            La máscara desvanece el desenfoque hacia arriba; sin ella el blur
            terminaría en un canto recto a media pantalla. */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            insetInlineStart: 0,
            insetInlineEnd: 0,
            bottom: 0,
            zIndex: 9,
            pointerEvents: "none",
            // Hasta donde llega el contenido, nunca más del tope. Los 20px de
            // más son el margen que necesita el degradado para fundirse por
            // arriba en lugar de cortarse justo sobre el texto.
            height: contextOpen
              ? `min(${Math.round(bottomStackH) + 20}px, 62%)`
              : 0,
            transition: "height 300ms cubic-bezier(0.4, 0, 0.2, 1)",
            background: "linear-gradient(to top, rgba(0,0,0,0.88), rgba(0,0,0,0))",
            backdropFilter: "blur(14px)",
            WebkitBackdropFilter: "blur(14px)",
            maskImage: "linear-gradient(to top, #000 55%, transparent 100%)",
            WebkitMaskImage: "linear-gradient(to top, #000 55%, transparent 100%)",
          }}
        />

        {/* Panel de contexto + botones */}
        <div ref={bottomStackRef} style={{ position: "absolute", insetInlineStart: 0, insetInlineEnd: 0, bottom: 0, display: "flex", flexDirection: "column", zIndex: 10 }}>
          {/* El CONTENIDO se desplaza fuera por abajo conservando su alto, en
              vez de encogerse. Así el texto no se reacomoda al cerrar y al
              volver a abrir ya está colocado tal cual estaba. */}
          <div
            style={{
              maxHeight: "50vh",
              display: "flex",
              flexDirection: "column",
              transform: contextOpen ? "none" : "translateY(100%)",
              opacity: contextOpen ? 1 : 0,
              visibility: contextOpen ? "visible" : "hidden",
              pointerEvents: contextOpen ? "auto" : "none",
              transition:
                "transform 300ms cubic-bezier(0.4, 0, 0.2, 1), opacity 240ms ease, visibility 300ms",
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
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 18px 4px", flexShrink: 0 }}>
              {/* Las vistas, a la izquierda de los controles de lectura. */}
              <span
                aria-label={tCommon("viewsCountAriaLabel", { count: plays })}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  color: "rgba(255,255,255,0.72)",
                  fontSize: 12,
                  fontWeight: 600,
                  fontVariantNumeric: "tabular-nums",
                  flexShrink: 0,
                }}
              >
                <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                {formatPlays(plays)}
              </span>

              {/* Lectura y cierre, a la derecha. */}
              <span style={{ display: "inline-flex", alignItems: "center", flexShrink: 0 }}>
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
              <IconButton label={ reader.state === "playing" ? tServices("pauseReading") : reader.state === "paused" ? tServices("resumeReading") : tServices("readContext") } size="sm" tone="bare" shape="square" style={{ marginInlineEnd: 6 }} disabled={instructionsLoading || !instructions} onTouchStart={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); reader.toggle(); }}>
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
              </IconButton>
              <IconButton label={tCommon("closeContextAriaLabel")} size="sm" tone="bare" shape="square" onTouchStart={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setContextOpen(false); }}>
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </IconButton>
              </span>
            </div>

            <div style={{ overflowY: "auto", maxHeight: "calc(50vh - 44px)" }}>
              <p
                ref={readerTextRef}
                onClick={(e) => {
                  e.stopPropagation();
                  reader.seekFromPoint(e.clientX, e.clientY, readerTextRef.current);
                }}
                style={{
                  // Abajo solo lo justo: el aire que separa el texto de los
                  // botones lo pone ya el relleno de la fila de botones.
                  margin: "4px 18px 6px",
                  color: "rgba(255,255,255,0.94)",
                  fontSize: compact ? 13 : 15,
                  fontFamily: FONT,
                  lineHeight: 1.55,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  cursor: "text",
                  userSelect: "none",
                  // Sobre video y sin caja detrás, el texto necesita su propia
                  // sombra para no perderse en los fotogramas claros.
                  textShadow: "0 1px 3px rgba(0,0,0,0.7)",
                }}
              >
                <ReadAlongText
                  text={readerText}
                  active={reader.state !== "idle" && !!reader.highlight}
                  readChars={(reader.highlight?.start ?? 0) + (reader.highlight?.length ?? 0)}
                  cursorRef={readerCursorRef}
                />
              </p>
            </div>
          </div>

          {/* Flamita, en su propia fila encima de los botones. Cuenta como una
              accion sobre la historia, no como un control del reproductor, asi
              que vive con lo que se hace CON la historia y no en la columna de
              silencio y compartir. */}
          {likeUid && (
            // Con el contexto abierto la flamita se aparta: ese panel es para
            // leer, y un icono encima compitiendo por atencion sobra.
            //
            // Antes se iba con un fundido pero CONSERVABA su alto, para que los
            // botones no dieran un salto. Ese hueco reservado era la mitad del
            // aire que se veia entre el texto y los botones. Ahora la fila se
            // pliega de verdad, y no hay salto igual: la pila esta anclada
            // abajo, asi que quitar una fila de ENCIMA de los botones no los
            // mueve — solo baja lo que hay arriba, que es justo lo que se
            // quiere. El plegado va animado con el mismo tiempo que el fundido.
            <div
              style={{
                display: "flex",
                alignItems: "center",
                // Sin separacion propia: el hueco lo pone el margen del numero,
                // que ya descuenta la caja del icono.
                gap: 0,
                padding: contextOpen ? "0 14px" : "0 14px 6px",
                height: contextOpen ? 0 : undefined,
                overflow: contextOpen ? "hidden" : undefined,
                opacity: contextOpen ? 0 : 1,
                transform: contextOpen ? "translateY(4px)" : "none",
                transition:
                  "opacity 220ms ease, transform 220ms ease, height 220ms ease, padding 220ms ease",
                pointerEvents: contextOpen ? "none" : undefined,
              }}
              aria-hidden={contextOpen}
            >
              <IconButton
                label={liked ? tCommon("removeFlameFromStory") : tCommon("addFlameToStory")}
                size="sm"
                tone="bare"
                shape="square"
                // ⚠️ El icono va CENTRADO en una caja de 32, asi que sobra hueco
                // a AMBOS lados del dibujo. A la izquierda desalineaba la fila
                // respecto a "Contexto"; a la derecha alejaba el numero. Los dos
                // se descuentan con el mismo valor.
                style={{ marginInlineStart: -flameInset, pointerEvents: "auto" }}
                onClick={(e) => { void handleLike(e); }}
              >
                <VibraFlameIcon active={liked} size={flameIconSize} />
              </IconButton>
              {likes > 0 && (
                <span
                  aria-hidden="true"
                  style={{
                    color: "rgba(255,255,255,0.92)",
                    fontSize: compact ? 12 : 14,
                    fontWeight: 700,
                    lineHeight: 1,
                    fontVariantNumeric: "tabular-nums",
                    textShadow: "0 1px 6px rgba(0,0,0,0.6)",
                    // Pegado al dibujo, no a la caja.
                    marginInlineStart: 2 - flameInset,
                  }}
                >
                  {formatPlays(likes)}
                </span>
              )}
            </div>
          )}

          <div style={{ display: "flex", gap: 10, padding: "0 14px", paddingBottom: btnPadBottom }}>
            <button
              type="button"
              onTouchStart={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setContextOpen((v) => !v);
              }}
              style={{ pointerEvents: "auto", flex: 1, padding: compact ? "8px 10px" : "11px 10px", borderRadius: 10, border: "none", background: "#3b82f6", color: "#fff", fontSize: compact ? 12 : 14, fontWeight: 600, fontFamily: FONT, cursor: "pointer", letterSpacing: "-0.01em", transition: "opacity 150ms ease", WebkitTapHighlightColor: "transparent" }}
            >
              {tServices("contextLabel")}
            </button>
            {/* Solo se ofrece cuando SE SABE que se puede comprar.
                ⚠️ Antes bastaba con que no se supiera lo contrario, y eso era el
                origen de la inestabilidad: si la historia no traia identificador
                de creador —o su lectura no llegaba— el boton se pintaba igual,
                la persona llenaba el formulario entero y la pasarela terminaba
                diciendo que no se pudo determinar el precio.
                Aparecer un instante despues es mucho mejor que llevar a un
                callejon sin salida. */}
            {/* Mientras no se sabe, el hueco del boton se reserva con su
                esqueleto. Asi la fila no da un salto cuando el boton llega, y
                se ve que algo esta cargando en vez de parecer que no hay nada
                a la venta. */}
            {purchase.available === null && creatorPendiente && (
              <SkeletonBlock height={compact ? 31 : 41} radius={10} style={{ flex: 1 }} />
            )}
            {purchase.available === true && (
              <button
                type="button"
                onTouchStart={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  void purchase.open();
                }}
                style={{ pointerEvents: "auto", flex: 1, padding: compact ? "8px 10px" : "11px 10px", borderRadius: 10, border: "none", background: "linear-gradient(135deg, #f472b6, #a855f7)", color: "#fff", fontSize: compact ? 12 : 14, fontWeight: 600, fontFamily: FONT, cursor: "pointer", letterSpacing: "-0.01em", transition: "opacity 150ms ease", WebkitTapHighlightColor: "transparent" }}
              >
                {effectiveType === "saludo" ? tServices("wantGreeting") : tServices("wantAdvice")}
              </button>
            )}
          </div>
        </div>
      </div>

      {purchase.modals}
      <VibraToast toast={shareToast} />
    </>
  );
}
