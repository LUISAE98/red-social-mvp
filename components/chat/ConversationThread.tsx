"use client";

import { useDirectionFactor } from "@/lib/i18n/useDirectionFactor";

import { TextButton, IconButton } from "@/components/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import {
  acceptConversationRequest,
  buildReplyPreview,
  createConversationWithFirstMessage,
  deleteMessageForEveryone,
  editMessage,
  hideMessageForMe,
  rejectConversationRequest,
  setMessageLike,
  type MessageWithId,
} from "@/lib/chat/chatService";
import { useConversation } from "@/lib/chat/useConversation";
import { useConversationDoc } from "@/lib/chat/useConversationDoc";
import { useDmImageUrls } from "@/lib/chat/useDmImageUrls";
import { useSocialRelationship } from "@/lib/social/useSocialRelationship";
import {
  MESSAGE_EDIT_WINDOW_MS,
  MESSAGE_MAX_LENGTH,
  type ChatImage,
  type MessageReply,
} from "@/lib/chat/types";
import { uploadDirectMessageImage } from "@/lib/posts/image-upload";
import { renderMessageText } from "@/lib/chat/linkify";
import ReadChecksIcon from "./ReadChecksIcon";
import type { ProfileMini } from "./ConversationList";
import {
  ChatReveal,
  MessageThreadSkeleton,
  SendingImageSkeleton,
  SkeletonBlock,
} from "./ChatSkeletons";
import {
  CommentImageLightbox,
  type CommentImageLightboxTarget,
} from "@/app/[locale]/groups/[groupId]/components/posts/CommentImageUI";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import { captureError } from "@/lib/observability/captureError";

/**
 * Hilo de conversación SIN chrome: solo el área de mensajes y el pie de acción.
 *
 * Se monta en dos sitios con presentaciones distintas — el dock anclado de
 * laptop y la página a pantalla completa de celular — así que no impone ni
 * cabecera ni contenedor: el que lo usa decide el marco.
 *
 * Funciona en dos situaciones: con un hilo existente y en BORRADOR, cuando aún
 * no hay conversación (al escribir desde un perfil). En borrador, el primer
 * envío crea el hilo y el mensaje en un solo lote atómico.
 */

type TimestampLike = { toDate?: () => Date } | null | undefined;

function toDate(value: TimestampLike): Date | null {
  if (!value || typeof value.toDate !== "function") return null;
  const date = value.toDate();
  return Number.isNaN(date.getTime()) ? null : date;
}

function dayKey(date: Date | null): string {
  if (!date) return "";
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/**
 * Iconos del menú de un mensaje. Heredan el color del renglón (`currentColor`),
 * así que basta con cambiar el del texto para que sigan.
 *
 * "Ocultar" lleva un ojo tachado y no una papelera a propósito: esa acción no
 * borra nada, solo te lo quita de la vista. La papelera queda para la que sí
 * retira el mensaje de los dos lados.
 */
function MenuIcon({ path }: { path: React.ReactNode }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, opacity: 0.75 }}
      aria-hidden
    >
      {path}
    </svg>
  );
}

const ICON_HIDE = (
  <>
    <path d="M3 3l18 18" />
    <path d="M10.6 10.6a2 2 0 002.8 2.8" />
    <path d="M9.4 5.2A9.6 9.6 0 0112 5c5 0 9 4.5 9 7 0 .9-.5 2-1.4 3.1" />
    <path d="M6.3 6.9C3.9 8.4 3 10.4 3 12c0 2.5 4 7 9 7 1.5 0 2.8-.4 4-1" />
  </>
);

const ICON_TRASH = (
  <>
    <path d="M4 7h16" />
    <path d="M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2" />
    <path d="M6.5 7l.8 12a1 1 0 001 1h7.4a1 1 0 001-1l.8-12" />
  </>
);

const ICON_PENCIL = (
  <>
    <path d="M15.5 5.5l3 3" />
    <path d="M4 20l4.5-1 10-10-3-3-10 10L4 20z" />
  </>
);

/**
 * Responder: la MISMA silueta que el compartir de las publicaciones
 * (`VibraShareIcon`), reflejada. Compartir apunta hacia fuera y responder hacia
 * dentro, así que una es el espejo de la otra y el producto habla un solo idioma
 * de iconos. El camino va ya escrito en espejo (x' = 24 − x) en vez de girarse
 * con un `transform`, para que sirva igual dentro de `MenuIcon`.
 */
const ICON_REPLY = (
  <path d="M11.2 4.5L3 11.5L11.2 18.5V14.2H13.5C17.3 14.2 19.8 16 21.5 19.5C21.2 12.7 18.2 9.2 13.3 9.2H11.2V4.5Z" />
);

/**
 * Iconos de las acciones que salen al lado del globo.
 *
 * Van aparte de `MenuIcon` porque piden lo contrario que aquel: ahí son un
 * apoyo del texto y se atenúan; aquí son la acción entera, así que van más
 * blancos y con más cuerpo de trazo. Huecos en los dos casos.
 */
function ActionIcon({
  path,
  fill = "none",
}: {
  path: React.ReactNode;
  fill?: string;
}) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill={fill}
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "block", flexShrink: 0 }}
      aria-hidden
    >
      {path}
    </svg>
  );
}

/**
 * Deslizar un mensaje hacia la derecha lo cita, como en WhatsApp.
 *
 * `THRESHOLD` es el arrastre a partir del cual el gesto cuenta; `MAX` es hasta
 * dónde acompaña el globo. Pasado ese tope sigue cediendo un poco (efecto goma)
 * para que el gesto no se sienta topado en seco, pero ya no aporta nada.
 */
const REPLY_SWIPE_THRESHOLD = 56;
const REPLY_SWIPE_MAX = 76;
/** Antes de esto no se decide el eje: un gesto de 3px no dice si es scroll. */
const SWIPE_AXIS_SLOP = 6;

/** Lo que tarda el texto en irse del campo al enviarlo. Cuadra con el CSS. */
const DRAFT_FADE_MS = 140;

/**
 * Cuánto se espera para volver a apuntar al final del hilo.
 *
 * Tiene que caer DESPUÉS de que el campo haya encogido (`DRAFT_FADE_MS`) y de
 * que el globo nuevo haya terminado de entrar, porque las dos cosas cambian el
 * alto del contenido mientras el scroll ya va en camino.
 */
const SCROLL_SETTLE_MS = 280;

/**
 * Cuánto hay que mantener el dedo para abrir el menú de un mensaje.
 *
 * 480ms es el punto donde no se dispara sin querer al tocar, pero tampoco
 * obliga a esperar: es el mismo orden que usan las apps de mensajería.
 */
const LONG_PRESS_MS = 480;

/** Corazón: relleno para la marca del mensaje, contorno para el botón. */
const HEART_PATH =
  "M12 20.5l-1.6-1.45C5.1 14.5 2 11.7 2 8.2 2 5.4 4.2 3.2 7 3.2c1.6 0 3.1.74 4 1.9.9-1.16 2.4-1.9 4-1.9 2.8 0 5 2.2 5 5 0 3.5-3.1 6.3-8.4 10.85L12 20.5z";

/**
 * Fondos de los globos, sobre negro.
 *
 * El morado es el de marca (#a855f7) con alfa: la opacidad es lo que decide
 * cuánta luz tiene. A 0.30 quedaba casi apagado sobre el fondo negro del chat.
 *
 * El destello del salto a una cita tiene que seguir leyéndose como un golpe de
 * luz POR ENCIMA del globo ya iluminado, no como su color normal — de ahí la
 * distancia entre los dos valores.
 */
const BUBBLE_MINE = "rgba(168,85,247,0.52)";
const BUBBLE_MINE_FLASH = "rgba(168,85,247,0.85)";
/** Los del otro no se tocan: el encargo era iluminar el morado, no el gris. */
const BUBBLE_THEIRS = "rgba(255,255,255,0.07)";


/** Pista del gesto: aparece a la izquierda del globo según se arrastra. */
function SwipeReplyCue() {
  return (
    <span
      style={{
        width: 26,
        height: 26,
        borderRadius: 999,
        background: "rgba(255,255,255,0.14)",
        display: "grid",
        placeItems: "center",
      }}
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#fff"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {ICON_REPLY}
      </svg>
    </span>
  );
}

/**
 * Icono de adjuntar imagen del compositor.
 *
 * Misma forma que el `attachMedia` del compositor de publicaciones, redibujada
 * aquí en BLANCO: aquel trae el verde escrito en el propio SVG y cambiarlo
 * afectaría también al de publicaciones, donde el verde sí se queda.
 *
 * Va MÁS grande que la flecha de enviar (26 frente a 23) a propósito: su dibujo
 * ocupa solo 16 de las 24 unidades del lienzo, mientras que la flecha lo llena
 * casi entero. A igual `size` se vería claramente más pequeño.
 */
function AttachImageIcon({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden style={{ display: "block" }}>
      <rect
        x="3.5"
        y="4"
        width="14"
        height="14"
        rx="2.4"
        fill="none"
        stroke="#fff"
        strokeWidth="2.2"
      />
      <circle cx="7.2" cy="8.2" r="1.6" fill="#fff" />
      <path
        d="M3.5 15.8 L8 11.2 L10.5 13.8 L14.2 10 L17.5 13.5 V18 H3.5 Z"
        fill="#fff"
      />
    </svg>
  );
}

/**
 * Alto del campo. 48 y no 40: un dedo en un campo de 40 con el pulgar en marcha
 * falla más de lo que parece, y el compositor es lo que más se toca del chat.
 * Cuadra con el relleno: 20 de línea + 14 + 14.
 */
const INPUT_MIN_HEIGHT = 48;
const INPUT_MAX_HEIGHT = 132;

/**
 * Caja que ocupa una imagen en el hilo, calculada ANTES de que cargue.
 *
 * Sin esto el hueco solo existe cuando la foto llega, y entonces el hilo pega un
 * empujón. Con la proporción real puesta de antemano, la imagen se funde encima
 * de su propio sitio y nada se mueve.
 *
 * Se devuelve `aspectRatio` en vez de un alto fijo para que la caja pueda
 * encoger con el globo en pantallas estrechas sin deformar la foto.
 */
function imageBox(image: ChatImage): {
  width: number;
  maxWidth: string;
  aspectRatio: string;
} {
  const MAX_WIDTH = 240;
  const MAX_HEIGHT = 260;
  const width = image.width ?? 0;
  const height = image.height ?? 0;

  // Sin dimensiones guardadas (mensajes antiguos) se asume apaisado corriente.
  if (!width || !height) {
    return { width: 200, maxWidth: "100%", aspectRatio: "4 / 3" };
  }

  // Nunca se amplía: una foto pequeña se queda a su tamaño.
  const scale = Math.min(MAX_WIDTH / width, MAX_HEIGHT / height, 1);
  return {
    width: Math.round(width * scale),
    maxWidth: "100%",
    aspectRatio: `${width} / ${height}`,
  };
}
function autoGrow(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, INPUT_MAX_HEIGHT)}px`;
}

export default function ConversationThread({
  conversationId,
  otherUid,
  profile,
  selfUid,
  active = true,
  safeAreaBottom = false,
  pointerActions = false,
  onConversationCreated,
}: {
  /** ID determinista del hilo. Puede no existir todavía (modo borrador). */
  conversationId: string | null;
  /** Necesario para crear el hilo en el primer envío. */
  otherUid: string | null;
  profile: ProfileMini | undefined;
  selfUid: string | null;
  /** false cuando el hilo está minimizado: corta las suscripciones. */
  active?: boolean;
  /**
   * Reserva el safe-area inferior bajo el compositor. Solo lo quiere la pantalla
   * completa de celular; en la pestaña anclada de laptop no hay barra de sistema
   * debajo y esos 20px quedarían como hueco muerto.
   */
  safeAreaBottom?: boolean;
  /**
   * Responder y editar salen como iconos al pasar el cursor sobre el mensaje, y
   * desaparecen del menú.
   *
   * Lo decide quien monta el hilo y no un `@media (hover: hover)`: el dock solo
   * existe en laptop y la pantalla completa solo en celular, así que el dato ya
   * lo sabe el sitio que monta. Consultarlo por CSS añadía una incógnita (qué
   * responde cada navegador con pantalla táctil) sin ganar nada.
   */
  pointerActions?: boolean;
  onConversationCreated?: (conversationId: string) => void;
}) {
  const tChat = useTranslations("chat");
  const tCommon = useTranslations("common");
  const locale = useLocale();

  const { conversation } = useConversationDoc(active ? conversationId : null);
  const exists = conversation != null;

  const { messages, loading, loadingOlder, hasMore, loadOlder, send } = useConversation(
    active && exists ? conversationId : null,
    selfUid
  );

  const [draft, setDraft] = useState("");
  /**
   * Imágenes en vuelo: elegidas y todavía subiendo.
   *
   * La foto se manda al elegirla, sin previsualización ni segundo toque, así que
   * lo único que hay que recordar es CUÁNTAS están en camino para pintar sus
   * skeletons. Se guardan ids y no un contador porque dos fotos seguidas
   * terminan en cualquier orden.
   */
  const [uploadingIds, setUploadingIds] = useState<number[]>([]);
  const uploadIdRef = useRef(0);
  /** El campo tiene el foco ⇒ hay teclado ⇒ el botón de foto se pliega. */
  const [composerFocused, setComposerFocused] = useState(false);
  /** Miniaturas ya cargadas, por ruta: deciden cuándo apagar su skeleton. */
  const [loadedImages, setLoadedImages] = useState<Record<string, true>>({});
  /** Breve, mientras el texto se desvanece del campo tras enviarlo. */
  const [draftFading, setDraftFading] = useState(false);

  /** Temporizador de la pulsación larga que abre el menú de un mensaje. */
  const longPressRef = useRef<number | null>(null);
  /**
   * Imagen abierta a tamaño completo.
   *
   * Se reutiliza el visor de las imágenes de comentario: crece desde la propia
   * miniatura, enseña la miniatura ya cargada mientras llega el original (sin
   * parpadeo) y se cierra deslizando hacia abajo. No había motivo para escribir
   * otro.
   */
  const [lightbox, setLightbox] = useState<CommentImageLightboxTarget | null>(null);
  /**
   * Mensaje con el detalle (hora + acciones) desplegado, y HACIA DÓNDE se abre.
   * Solo uno a la vez. Un mensaje pegado
   * al compositor abre hacia arriba: abrir siempre hacia abajo lo dejaría
   * escondido detrás del campo de escritura.
   */
  const [expandedMessage, setExpandedMessage] = useState<{
    id: string;
    direction: "up" | "down";
  } | null>(null);
  /** Mensaje que se está editando; el compositor pasa a guardar en vez de enviar. */
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  /** Mensaje que se está citando. El siguiente envío irá como respuesta a él. */
  const [replyingTo, setReplyingTo] = useState<MessageReply | null>(null);
  /** Mensaje al que se acaba de saltar desde una cita: parpadea para ubicarlo. */
  const [flashing, setFlashing] = useState<string | null>(null);

  const expandedPanelRef = useRef<HTMLDivElement | null>(null);
  /** Nodo de cada mensaje, para poder saltar al original desde su cita. */
  const messageNodes = useRef(new Map<string, HTMLDivElement>());

  /**
   * Qué mensajes entran con animación.
   *
   * Solo los que LLEGAN estando tú mirando. La tanda inicial no se anima: veinte
   * globos haciendo pop a la vez al abrir un hilo es ruido, no un detalle.
   *
   * Se decide una sola vez por mensaje y se recuerda, porque si la decisión
   * cambiara en el siguiente render la animación se cortaría a medias.
   */
  const popDecision = useRef(new Map<string, boolean>());
  const firstBatchDone = useRef(false);

  function shouldPop(messageId: string): boolean {
    const decided = popDecision.current.get(messageId);
    if (decided !== undefined) return decided;
    const value = firstBatchDone.current;
    popDecision.current.set(messageId, value);
    return value;
  }

  /**
   * Alto real del compositor. Como va superpuesto al hilo, el área de mensajes
   * necesita ese relleno abajo para que el último mensaje no quede debajo.
   */
  const composerRef = useRef<HTMLDivElement | null>(null);
  const [composerHeight, setComposerHeight] = useState(64);

  useEffect(() => {
    const node = composerRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      // BORDE, no `contentRect`. El compositor lleva relleno propio arriba y
      // abajo (12 + 12) más el safe-area inferior, y `contentRect` los excluye:
      // el hueco reservado salía ~44px corto y el último mensaje quedaba
      // justo DEBAJO del campo de escritura.
      const border = entries[0]?.borderBoxSize?.[0]?.blockSize;
      setComposerHeight(Math.ceil(border ?? node.getBoundingClientRect().height));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  /**
   * Distancia al final por debajo de la cual se considera que estás "abajo".
   * Con margen: al llegar un mensaje mientras lees los últimos, se sigue bajando.
   */
  const STICK_TO_BOTTOM_SLACK = 90;
  /** ¿Seguimos pegados al final? Si te fuiste a leer historia, no se te arrastra. */
  const stickToBottomRef = useRef(true);

  /**
   * Baja al final del hilo.
   *
   * Se mueve el contenedor a mano en vez de usar `scrollIntoView`: ese arrastra
   * TODOS los ancestros scrollables, incluido el documento, y en iOS eso pelea
   * con el `position: fixed` de la pantalla de celular — la página entera daba
   * un salto. Aquí solo se toca el scroller del hilo.
   *
   * `scrollHeight` incluye el relleno inferior, así que el tope del scroll deja
   * el último mensaje justo por encima del compositor, no debajo.
   */
  const settleTimerRef = useRef<number | null>(null);

  const scrollToBottom = useCallback((smooth: boolean) => {
    const container = scrollRef.current;
    if (!container) return;

    container.scrollTo({
      top: container.scrollHeight,
      behavior: smooth ? "smooth" : "auto",
    });

    /**
     * Segunda pasada, y es la que arregla el mensaje que aparecía DEBAJO del
     * campo en vez de encima.
     *
     * Un scroll suave apunta al alto que había cuando arrancó y anima hacia ahí.
     * Justo al mandar, ese alto cambia a media animación: el globo nuevo entra
     * con la suya y el campo encoge de tres líneas a una, lo que recorta el hueco
     * reservado abajo. El scroll terminaba en un destino que ya no era el final,
     * y el último mensaje quedaba medio tapado.
     *
     * Aquí se vuelve a apuntar cuando todo cuajó. Lo que falta son decenas de
     * píxeles, así que la corrección se ve como una continuación del mismo
     * movimiento y no como un salto. Si mientras tanto te fuiste a leer hacia
     * arriba, no se te arrastra.
     */
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current);
    }
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = null;
      const node = scrollRef.current;
      if (!node || !stickToBottomRef.current) return;
      node.scrollTo({
        top: node.scrollHeight,
        behavior: smooth ? "smooth" : "auto",
      });
    }, SCROLL_SETTLE_MS);
  }, []);

  useEffect(
    () => () => {
      if (settleTimerRef.current !== null) {
        window.clearTimeout(settleTimerRef.current);
      }
    },
    []
  );

  /** Alto aproximado del menú (hora + hasta 4 acciones). Solo decide el lado. */
  const MENU_ESTIMATED_HEIGHT = 190;

  function toggleExpanded(messageId: string, anchor: HTMLElement) {
    setExpandedMessage((prev) => {
      if (prev?.id === messageId) return null;

      let direction: "up" | "down" = "down";
      const container = scrollRef.current;

      if (container) {
        const containerRect = container.getBoundingClientRect();
        const anchorRect = anchor.getBoundingClientRect();
        // El compositor va SUPERPUESTO al hilo, así que el fondo realmente
        // visible termina por encima de él, no en el borde del contenedor.
        const visibleBottom = containerRect.bottom - composerHeight;
        const spaceBelow = visibleBottom - anchorRect.bottom;
        const spaceAbove = anchorRect.top - containerRect.top;

        if (spaceBelow < MENU_ESTIMATED_HEIGHT && spaceAbove > spaceBelow) {
          direction = "up";
        }
      }

      return { id: messageId, direction };
    });
  }

  /**
   * Red de seguridad: si aun eligiendo lado el menú se sale, se ajusta el
   * scroll. Se hace a mano y NO con `scrollIntoView`, porque este último cree
   * que el fondo del contenedor está visible cuando en realidad lo tapa el
   * compositor superpuesto — que era justo por lo que el menú quedaba oculto.
   *
   * Espera a que termine la animación para medir la altura real del menú y no
   * la de a medio abrir.
   */
  useEffect(() => {
    if (!expandedMessage) return;

    const timer = setTimeout(() => {
      const panel = expandedPanelRef.current;
      const container = scrollRef.current;
      if (!panel || !container) return;

      const panelRect = panel.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const visibleBottom = containerRect.bottom - composerHeight;
      const MARGIN = 8;

      if (panelRect.bottom > visibleBottom) {
        container.scrollBy({
          top: panelRect.bottom - visibleBottom + MARGIN,
          behavior: "smooth",
        });
      } else if (panelRect.top < containerRect.top) {
        container.scrollBy({
          top: panelRect.top - containerRect.top - MARGIN,
          behavior: "smooth",
        });
      }
    }, 260);

    return () => clearTimeout(timer);
  }, [expandedMessage, composerHeight]);

  /**
   * Gesto de citar: deslizar el globo hacia la derecha.
   *
   * Va por DOM directo y no por estado de React a propósito. Un `setState` por
   * `touchmove` volvería a pintar el hilo entero decenas de veces por segundo, y
   * un arrastre que se entrecorta se nota inmediatamente. Aquí solo se tocan dos
   * `transform`, que el navegador resuelve en el compositor sin recalcular nada.
   *
   * El eje se decide una sola vez, en los primeros píxeles: si el dedo va más en
   * vertical que en horizontal, el gesto se abandona y el scroll se queda con
   * él. El `touch-action: pan-y` del renglón es la otra mitad de eso — le dice al
   * navegador que lo horizontal es nuestro y lo vertical suyo.
   */
  // +1 / -1 según el sentido de lectura. Deslizar para responder se hace hacia el
  // lado por el que EMPIEZA la línea: a la derecha leyendo de izquierda a derecha,
  // y a la izquierda en árabe. Como en el resto de gestos, `dx` y `pull` se llevan
  // en LÓGICO y se vuelve a multiplicar solo al pintar; así el rechazo de `dx <= 0`
  // y el umbral de abajo siguen valiendo sin tocarlos. La pista ya se ancla con
  // insetInlineEnd, o sea que esa se voltea sola.
  const dirX = useDirectionFactor();
  const swipeRef = useRef<{
    message: MessageWithId;
    startX: number;
    startY: number;
    axis: "undecided" | "x";
    slider: HTMLElement;
    cue: HTMLElement;
    reached: boolean;
  } | null>(null);
  /** Un arrastre termina en `click`; sin esto también desplegaría el detalle. */
  const suppressClickRef = useRef(false);

  function beginSwipe(e: React.TouchEvent<HTMLDivElement>, message: MessageWithId) {
    suppressClickRef.current = false;
    if (!canReply(message) || e.touches.length !== 1) return;

    const touch = e.touches[0];
    const row = e.currentTarget;
    const slider = row.querySelector<HTMLElement>("[data-swipe-slider]");
    const cue = row.querySelector<HTMLElement>("[data-swipe-cue]");
    if (!touch || !slider || !cue) return;

    slider.style.transition = "none";
    cue.style.transition = "none";

    swipeRef.current = {
      message,
      startX: touch.clientX,
      startY: touch.clientY,
      axis: "undecided",
      slider,
      cue,
      reached: false,
    };
  }

  function moveSwipe(e: React.TouchEvent<HTMLDivElement>) {
    const swipe = swipeRef.current;
    const touch = e.touches[0];
    if (!swipe || !touch) return;

    const dx = (touch.clientX - swipe.startX) * dirX;
    const dy = touch.clientY - swipe.startY;

    if (swipe.axis === "undecided") {
      if (Math.abs(dx) < SWIPE_AXIS_SLOP && Math.abs(dy) < SWIPE_AXIS_SLOP) return;
      // Vertical, o hacia la izquierda: no es este gesto. Se suelta para que el
      // scroll siga su curso sin competir con nosotros.
      if (dx <= 0 || Math.abs(dx) <= Math.abs(dy)) {
        swipeRef.current = null;
        return;
      }
      swipe.axis = "x";
    }

    const pull =
      dx <= REPLY_SWIPE_MAX
        ? Math.max(0, dx)
        : REPLY_SWIPE_MAX + (dx - REPLY_SWIPE_MAX) * 0.15;
    const progress = Math.min(1, pull / REPLY_SWIPE_THRESHOLD);

    swipe.slider.style.transform = `translateX(${pull * dirX}px)`;
    swipe.cue.style.opacity = String(progress);
    swipe.cue.style.transform = `scale(${0.6 + progress * 0.4})`;

    // Vibración corta justo al cruzar el umbral: confirma que soltando ahora sí
    // se cita, sin tener que mirar. iOS no la implementa; da igual, es opcional.
    if (!swipe.reached && pull >= REPLY_SWIPE_THRESHOLD) {
      swipe.reached = true;
      navigator.vibrate?.(10);
    } else if (swipe.reached && pull < REPLY_SWIPE_THRESHOLD) {
      swipe.reached = false;
    }

    suppressClickRef.current = true;
  }

  function endSwipe() {
    const swipe = swipeRef.current;
    swipeRef.current = null;
    if (!swipe) return;

    swipe.slider.style.transition = "transform 220ms cubic-bezier(0.2,0,0,1)";
    swipe.cue.style.transition = "opacity 160ms ease, transform 160ms ease";
    swipe.slider.style.transform = "translateX(0)";
    swipe.cue.style.opacity = "0";
    swipe.cue.style.transform = "scale(0.6)";

    if (swipe.reached) startReply(swipe.message);
  }

  /** Un mensaje retirado no se cita, y en un hilo donde no se puede escribir tampoco. */
  function canReply(message: MessageWithId) {
    return canWrite && !message.isDeleted && !!conversationId;
  }

  function startReply(message: MessageWithId) {
    const preview = buildReplyPreview(message);
    if (!preview) return;

    // Citar y editar son excluyentes: el compositor solo puede hacer una cosa.
    setEditing(null);
    setReplyingTo(preview);
    setExpandedMessage(null);
    inputRef.current?.focus();
  }

  /** ¿Le puse yo corazón a este mensaje? */
  function isLikedByMe(message: MessageWithId) {
    return !!selfUid && (message.likedBy ?? []).includes(selfUid);
  }

  function toggleLike(message: MessageWithId) {
    if (!conversationId || !selfUid || message.isDeleted) return;
    void setMessageLike(
      conversationId,
      message.id,
      selfUid,
      !isLikedByMe(message)
    ).catch(() => setError(tCommon("actionCompletionError")));
  }

  /**
   * En táctil el menú se abre con pulsación LARGA, no con un toque.
   *
   * Es el reparto que la gente ya trae de WhatsApp y iMessage, y aquí además era
   * la única salida: el toque simple estaba ocupado dos veces —abrir la imagen y
   * abrir el menú—, así que no quedaba gesto libre. Con esto el toque queda solo
   * para abrir la foto, y el corazón se movió al propio menú.
   *
   * Se cancela en cuanto el dedo se mueve, para no pelear con el deslizar-para-
   * responder: quien empieza a arrastrar no quería abrir nada.
   */
  function cancelLongPress() {
    if (longPressRef.current === null) return;
    clearTimeout(longPressRef.current);
    longPressRef.current = null;
  }

  function startLongPress(message: MessageWithId, anchor: HTMLElement) {
    cancelLongPress();
    longPressRef.current = window.setTimeout(() => {
      longPressRef.current = null;
      // Un toque corto de vibración confirma que el menú abrió sin tener que
      // mirar; es lo que hace que la pulsación larga se sienta deliberada.
      navigator.vibrate?.(12);
      toggleExpanded(message.id, anchor);
      // El `click` que llega al levantar el dedo ya no debe hacer nada más.
      suppressClickRef.current = true;
    }, LONG_PRESS_MS);
  }

  function startEdit(message: MessageWithId) {
    setEditing({ id: message.id, text: message.text });
    setReplyingTo(null);
    setDraft(message.text);
    setExpandedMessage(null);
    inputRef.current?.focus();
  }

  /**
   * Salta al mensaje citado y lo hace parpadear.
   *
   * Si ya no está cargado (quedó en una página anterior del historial) no se
   * hace nada: la cita lleva el texto dentro, así que no se pierde información
   * por no poder llegar al original.
   */
  /**
   * El texto de una cita, leído del mensaje ORIGINAL.
   *
   * ⚠️ B9. Antes se pintaba `replyTo.text`, una copia que escribe el cliente al
   * enviar y que las reglas no podían comprobar: la cita se recorta a 200
   * caracteres y un mensaje llega a 2000, así que no hay con qué compararla, y
   * las reglas no saben cortar cadenas. Es decir, se podía poner en boca del
   * otro cualquier cosa y la interfaz la pintaba tal cual.
   *
   * Ahora la copia se IGNORA y el texto sale del mensaje de verdad, buscado por
   * su id entre los cargados. Las reglas ya garantizan que ese mensaje existe en
   * este hilo y que `replyTo.senderId` es su autor real, así que el globo
   * completo —quién y qué— pasa a ser cierto.
   *
   * Si el original quedó en una página anterior y no está en memoria, la cita se
   * pinta SIN texto: se sigue viendo de quién es y sigue llevando a su mensaje
   * al pulsarla. Preferimos no decir nada antes que repetir algo que no podemos
   * verificar, y no se inventa un texto nuevo para 47 idiomas por un caso que se
   * resuelve solo al cargar la página anterior.
   */
  function textoCitado(replyTo: MessageReply): string {
    const original = messages.find((m) => m.id === replyTo.messageId);

    if (!original) return "";
    if (original.isDeleted) return tChat("messageDeleted");

    return original.text || (original.image ? tChat("photoPreview") : "");
  }

  function jumpToMessage(messageId: string) {
    const node = messageNodes.current.get(messageId);
    if (!node) return;

    node.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlashing(messageId);
    setTimeout(() => {
      setFlashing((current) => (current === messageId ? null : current));
    }, 1200);
  }

  async function runMessageAction(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
      setExpandedMessage(null);
    } catch {
      setError(tCommon("actionCompletionError"));
    }
  }

  const messageActionStyle = {
    border: "none",
    background: "transparent",
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
    fontFamily: "inherit",
    cursor: "pointer",
    padding: 0,
  } as const;
  const [sending, setSending] = useState(false);
  /**
   * El mismo "está enviando" pero visible al instante. `sending` es estado y no
   * cambia hasta el siguiente render, así que no sirve para frenar dos disparos
   * dentro del mismo gesto — y ahora el botón dispara desde el dedo Y desde el
   * clic que viene detrás.
   */
  const sendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const { toast, showToast } = useVibraToast();
  useEffect(() => { if (error) showToast(error, "error"); }, [error]); // eslint-disable-line react-hooks/exhaustive-deps
  const [busyAction, setBusyAction] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const topSentinelRef = useRef<HTMLDivElement | null>(null);
  const lastMessageIdRef = useRef<string | null>(null);

  // Rutas de todas las imágenes cargadas (miniaturas para el globo, originales
  // para el visor). Se firman de una sola vez.
  const imagePaths = useMemo(() => {
    const paths: string[] = [];
    for (const message of messages) {
      if (message.isDeleted || !message.image) continue;
      // Las de los primeros mensajes ya traen URL permanente y no se firman.
      if (message.image.thumbnailUrl || message.image.url) continue;
      paths.push(message.image.thumbnailPath, message.image.path);
    }
    return paths;
  }, [messages]);

  const signedUrls = useDmImageUrls(conversationId, imagePaths);

  /**
   * Cuál de MIS mensajes lleva las palomitas de leído.
   *
   * Sale del recibo agregado que ya existía: `lastReadAt` guarda hasta cuándo
   * leyó cada quien, así que un mensaje está leído si es anterior a esa marca.
   * No hace falta ningún campo por mensaje ni ninguna escritura nueva — que es
   * justo lo que abarataba este diseño desde el principio.
   */
  const lastReadMineId = useMemo(() => {
    const readAt = otherUid ? conversation?.lastReadAt?.[otherUid] : null;
    if (!readAt || !selfUid) return null;

    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const candidate = messages[i];
      if (candidate.senderId !== selfUid) continue;
      // Sin `createdAt` es una escritura optimista que el servidor aún no ha
      // sellado: no se puede comparar, y desde luego no está leída.
      const at = candidate.createdAt;
      if (at && at.toMillis() <= readAt.toMillis()) return candidate.id;
    }
    return null;
  }, [messages, conversation?.lastReadAt, otherUid, selfUid]);

  /** URL para pintar: la firmada, o la permanente si es un mensaje antiguo. */
  function imageUrl(image: ChatImage, variant: "thumb" | "full"): string | null {
    if (variant === "thumb") {
      return image.thumbnailUrl ?? signedUrls[image.thumbnailPath] ?? null;
    }
    return image.url ?? signedUrls[image.path] ?? null;
  }

  /**
   * Traduce la imagen del DM al contrato del visor de comentarios.
   *
   * Aquel guarda URLs directas; el DM guarda rutas y las firma al vuelo. Es la
   * única diferencia, así que resolverlas aquí basta para reutilizar el visor
   * entero en vez de escribir uno igual.
   */
  function openLightbox(image: ChatImage, rect: DOMRect | null) {
    const thumbnailUrl = imageUrl(image, "thumb");
    // Si el original no está firmado se cae a la miniatura: mejor verla en
    // grande y algo blanda que no abrir nada.
    const url = imageUrl(image, "full") ?? thumbnailUrl;
    if (!thumbnailUrl || !url) return;

    setLightbox({
      image: {
        url,
        thumbnailUrl,
        path: image.path,
        thumbnailPath: image.thumbnailPath,
        width: image.width,
        height: image.height,
      },
      rect,
    });
  }

  // Bloqueo de PERFIL: es el canónico y el que se maneja desde el menú de la
  // cabecera. El estado bloqueado del hilo lo acompaña (lo pone ese mismo menú)
  // porque es lo que miran las reglas al escribir.
  const { relationship } = useSocialRelationship(selfUid, otherUid);
  const blockedByMe = relationship.hasBlocked;
  const blockedByThem = relationship.isBlockedBy;
  const profileBlock = blockedByMe || blockedByThem;

  const status = conversation?.status ?? null;
  const isBlocked = status === "blocked" || profileBlock;
  const iBlocked =
    blockedByMe || (status === "blocked" && conversation?.blockedBy === selfUid);
  const isPendingRequest = status === "request";
  const iSentRequest = isPendingRequest && conversation?.createdBy === selfUid;
  const iReceivedRequest = isPendingRequest && conversation?.createdBy !== selfUid;
  const displayName = profile?.displayName || tCommon("user");

  const canWrite = !isBlocked && !iSentRequest && !iReceivedRequest;

  // Historial al asomar el centinela superior.
  useEffect(() => {
    const node = topSentinelRef.current;
    if (!node || !hasMore || loading) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadOlder();
      },
      { root: scrollRef.current, threshold: 0.1 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loading, loadOlder]);

  // Bajar al final cuando llega un mensaje nuevo (no al paginar hacia atrás).
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last || last.id === lastMessageIdRef.current) return;

    const isFirstPaint = lastMessageIdRef.current === null;
    lastMessageIdRef.current = last.id;
    // A partir de aquí, lo que llegue es nuevo y sí se anima.
    firstBatchDone.current = true;

    // Lo propio siempre se ve; lo del otro solo si ya estabas al final.
    if (isFirstPaint || last.senderId === selfUid || stickToBottomRef.current) {
      scrollToBottom(!isFirstPaint);
    }
  }, [messages, selfUid, scrollToBottom]);

  /**
   * El compositor cambió de alto ⇒ cambió el hueco reservado bajo el hilo.
   * Pasa al enviar (el campo vuelve de tres líneas a una), al citar un mensaje y
   * al adjuntar una imagen. Sin esto el último mensaje se descoloca justo
   * después de mandarlo, que es cuando más se nota.
   */
  useEffect(() => {
    if (stickToBottomRef.current) scrollToBottom(false);
  }, [composerHeight, scrollToBottom]);

  /**
   * El teclado al abrirse encoge el hilo, y al cerrarse lo devuelve a su sitio.
   * Ambos casos llegan aquí como un cambio de tamaño del scroller, así que no
   * hace falta escuchar al teclado: si estabas al final, sigues al final — que
   * es exactamente lo que se espera al ponerte a escribir.
   */
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      if (stickToBottomRef.current) scrollToBottom(false);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [scrollToBottom]);

  useEffect(() => {
    setDraft("");
    setError(null);
    setReplyingTo(null);
    lastMessageIdRef.current = null;
  }, [conversationId]);

  /**
   * Abrir el hilo lo deja SIEMPRE en los mensajes recientes.
   *
   * Al minimizar la pestaña se corta la suscripción y el hilo se queda sin
   * mensajes; al volver a abrirla llega el mismo último mensaje que ya había, y
   * el efecto de más abajo salía antes de mover nada — comprueba si CAMBIÓ el
   * último, no si el hilo se acaba de mostrar. Resultado: la conversación se
   * abría al principio de todo.
   *
   * Olvidando cuál era el último, la siguiente llegada vuelve a contar como
   * primera pintada y baja sola.
   */
  useEffect(() => {
    if (!active) {
      lastMessageIdRef.current = null;
      return;
    }
    stickToBottomRef.current = true;
    scrollToBottom(false);
  }, [active, scrollToBottom]);

  async function handleSend() {
    // Candado SÍNCRONO. `sending` es estado de React y no cambia hasta el
    // siguiente render, así que dos disparos en el mismo gesto —el que sale del
    // dedo y el `click` que viene detrás— lo dejaban pasar y mandaban el mensaje
    // dos veces. Un ref se ve al instante.
    if (sendingRef.current) return;

    const body = draft.trim();

    // En modo edición el compositor GUARDA en vez de enviar.
    if (editing) {
      if (!body || sending || !conversationId) return;
      sendingRef.current = true;
      setSending(true);
      setError(null);
      try {
        await editMessage(conversationId, editing.id, body);
        setEditing(null);
        setDraft("");
        if (inputRef.current) inputRef.current.style.height = "auto";
      } catch {
        setError(tCommon("actionCompletionError"));
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
      return;
    }

    if (!body || sending || !canWrite || !selfUid) return;

    // Lo que acabas de mandar se ve, estuvieras donde estuvieras leyendo.
    stickToBottomRef.current = true;

    sendingRef.current = true;
    setSending(true);
    setError(null);

    // El texto se desvanece del campo mientras el mensaje sale, en vez de
    // desaparecer de golpe. No se espera a que termine para enviar: el envío ya
    // va en camino y esto es solo lo que se ve.
    setDraftFading(true);
    setTimeout(() => {
      setDraft("");
      setDraftFading(false);
      if (inputRef.current) inputRef.current.style.height = "auto";
    }, DRAFT_FADE_MS);

    try {
      await deliver(body, null, replyingTo);
      setReplyingTo(null);
    } catch (err) {
      // El motivo real se descartaba aqui: la persona veia "no se pudo enviar"
      // y no quedaba rastro de si fue el freno de ritmo, una regla de Firestore
      // o la red. Sin eso, un fallo de envio no se puede diagnosticar.
      captureError(err, {
        scope: "chat",
        code: (err as { code?: string })?.code,
        extra: { conversationId, threadExists: exists },
      });
      setError(tChat("sendError"));
      // Si falló, lo escrito VUELVE al campo: perder un mensaje por un corte de
      // red es mucho peor que cualquier animación.
      //
      // Va con el mismo retardo que el borrado a propósito. Este temporizador se
      // crea después que aquel, así que nunca puede dispararse antes — y si el
      // fallo llega rapidísimo, esto sigue ganando en vez de que el borrado
      // vacíe el campo justo después de haberlo restaurado.
      setTimeout(() => setDraft(body), DRAFT_FADE_MS);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  /**
   * Escribe el mensaje, exista ya el hilo o haya que crearlo.
   *
   * En borrador (aún sin conversación) el primer envío crea hilo y mensaje en un
   * solo lote atómico. Lo usan tanto el texto como la imagen, que ahora salen por
   * caminos distintos.
   */
  async function deliver(
    body: string,
    image: ChatImage | null,
    replyTo: MessageReply | null
  ) {
    if (!selfUid) throw new Error("missing-self");

    if (exists) {
      await send(body, image, replyTo);
      return;
    }
    if (!otherUid) throw new Error("missing-other");
    const createdId = await createConversationWithFirstMessage(
      selfUid,
      otherUid,
      body,
      image
    );
    onConversationCreated?.(createdId);
  }

  /**
   * La foto se MANDA al elegirla: sin previsualización en el campo ni segundo
   * toque. Es lo que se espera hoy de un chat — eliges del carrete y ya está.
   *
   * Mientras sube, su hueco en el hilo lo ocupa un skeleton, así que se ve que
   * va en camino y al llegar el mensaje real nada salta de sitio.
   *
   * El hilo puede no existir aún (modo borrador). La ruta de Storage usa el ID
   * determinista de la conversación, que se conoce antes de crearla.
   */
  async function handlePickImage(file: File | null | undefined) {
    if (!file || !conversationId || !canWrite) return;

    const uploadId = ++uploadIdRef.current;
    setUploadingIds((prev) => [...prev, uploadId]);
    stickToBottomRef.current = true;
    setError(null);

    try {
      const uploaded = await uploadDirectMessageImage({ conversationId, file });
      // La foto va sola: el pie de foto se escribe como un mensaje aparte.
      await deliver("", uploaded, null);
    } catch {
      setError(tCommon("imageUploadError"));
    } finally {
      setUploadingIds((prev) => prev.filter((id) => id !== uploadId));
      // Permite volver a elegir el MISMO fichero justo después.
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function runAction(action: () => Promise<void>, errorKey: string) {
    if (busyAction) return;
    setBusyAction(true);
    setError(null);
    try {
      await action();
    } catch {
      setError(tChat(errorKey));
    } finally {
      setBusyAction(false);
    }
  }

  function renderMessage(message: MessageWithId, previous: MessageWithId | null) {
    const mine = message.senderId === selfUid;
    const date = toDate(message.createdAt as TimestampLike);
    const previousDate = previous ? toDate(previous.createdAt as TimestampLike) : null;
    const showDaySeparator = dayKey(date) !== dayKey(previousDate);

    // Hora y, tras ella, la fecha completa: día, mes y año. Se compone con dos
    // formateadores en vez de uno con `dateStyle`, para controlar el separador
    // y que el orden sea siempre hora → fecha, sea cual sea el idioma.
    const time = date
      ? [
          new Intl.DateTimeFormat(locale, {
            hour: "numeric",
            minute: "2-digit",
          }).format(date),
          new Intl.DateTimeFormat(locale, {
            day: "numeric",
            month: "short",
            year: "numeric",
          }).format(date),
        ].join(" · ")
      : "";

    /**
     * Este mensaje es el que lleva las palomitas de leído.
     *
     * Solo uno en todo el hilo, y va recorriéndose: es el ÚLTIMO tuyo que la
     * otra persona ya vio. Marcarlos todos sería ruido, y dejarlas clavadas en
     * el último enviado las haría desaparecer cada vez que escribes algo nuevo
     * — justo cuando más quieres saber si lo leyeron.
     */
    const showsReadChecks = message.id === lastReadMineId;

    // Una imagen sin pie ni cita ES el mensaje: no lleva globo detrás, solo sus
    // esquinas redondeadas.
    const bareImage = !message.isDeleted && !!message.image && !message.text && !message.replyTo;

    const expanded = expandedMessage?.id === message.id;
    const opensUp = expanded && expandedMessage?.direction === "up";
    // Editar y retirar caducan a los 10 minutos. Si el mensaje aún no tiene
    // `createdAt` del servidor (escritura optimista), se considera reciente.
    const withinWindow = !date || Date.now() - date.getTime() < MESSAGE_EDIT_WINDOW_MS;

    return (
      // Columna con `order` explícito: cuando el menú abre hacia arriba se
      // REORDENA visualmente, sin sacarlo de su sitio en el DOM. Si se moviera
      // de verdad, React lo remontaría y perdería la animación de apertura.
      <div
        key={message.id}
        ref={(node) => {
          if (node) messageNodes.current.set(message.id, node);
          else messageNodes.current.delete(message.id);
        }}
        // Los que llegan mientras miras entran con un pequeño rebote.
        className={shouldPop(message.id) ? "vibra-msg-pop" : undefined}
        // Con un menú abierto, TODO lo demás se difumina: el mensaje que
        // pulsaste y su menú se quedan nítidos y el ojo va solo hacia ellos.
        data-dimmed={
          expandedMessage && expandedMessage.id !== message.id ? "" : undefined
        }
        style={{ display: "flex", flexDirection: "column" }}
      >
        {showDaySeparator && date ? (
          <div
            style={{
              order: 0,
              display: "flex",
              justifyContent: "center",
              margin: "14px 0 10px",
            }}
          >
            <span
              style={{
                fontSize: 10.5,
                color: "rgba(255,255,255,0.46)",
                background: "rgba(255,255,255,0.06)",
                padding: "3px 10px",
                borderRadius: 999,
                whiteSpace: "nowrap",
              }}
            >
              {new Intl.DateTimeFormat(locale, {
                day: "numeric",
                month: "long",
                ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }),
              }).format(date)}
            </span>
          </div>
        ) : null}

        {/* Renglón deslizable. `touch-action: pan-y` reparte el gesto con el
            navegador: lo vertical sigue siendo scroll suyo, lo horizontal es
            nuestro. Sin eso habría que cancelar el evento, y React escucha
            `touchmove` en modo pasivo — no se puede. */}
        <div
          className="vibra-msg-row"
          onTouchStart={(e) => {
            beginSwipe(e, message);
            if (!message.isDeleted) startLongPress(message, e.currentTarget);
          }}
          onTouchMove={(e) => {
            // Moverse cancela la pulsación larga: quien arrastra no quería abrir
            // el menú, quería responder o hacer scroll.
            cancelLongPress();
            moveSwipe(e);
          }}
          onTouchEnd={() => {
            cancelLongPress();
            endSwipe();
          }}
          onTouchCancel={() => {
            cancelLongPress();
            endSwipe();
          }}
          style={{
            order: 2,
            display: "flex",
            marginTop: 4,
            touchAction: "pan-y",
            // Sin esto, mantener pulsado saca el menú de copiar/pegar del
            // sistema encima del nuestro.
            WebkitTouchCallout: "none",
            WebkitUserSelect: "none",
            userSelect: "none",
          }}
        >
          <div
            data-swipe-slider
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              justifyContent: mine ? "flex-end" : "flex-start",
              alignItems: "center",
            }}
          >
            {/* Corazón del mensaje. Va SIEMPRE en el DOM y se enciende con el
                atributo: así el pop de entrada y el de salida son la misma
                transición, sin tener que retrasar el desmontaje.
                Fuera del globo, que recorta lo que se sale (`overflow: hidden`).

                Mismo truco que la pista del gesto: un hueco de ancho CERO justo
                al lado del globo, así queda pegado a él sea cual sea su ancho.
                Va en la esquina de dentro — la que mira al centro de la
                pantalla — y por eso cambia de lado según quién escribe. */}
            {!message.isDeleted ? (
              <span
                aria-hidden
                style={{
                  order: mine ? 1 : 5,
                  position: "relative",
                  width: 0,
                  display: "flex",
                  alignItems: "center",
                  alignSelf: "stretch",
                }}
              >
                {/* Palomitas de leído y corazón COMPARTEN sitio, y por eso van
                    los dos siempre montados: al pasar las palomitas al mensaje
                    siguiente, el corazón de este entra con su rebote en el hueco
                    que dejan. Si se montaran y desmontaran, el relevo sería un
                    corte seco. */}
                <span
                  className="vibra-msg-heart"
                  data-on={showsReadChecks ? "" : undefined}
                  style={{
                    position: "absolute",
                    bottom: -7,
                    ...(mine ? { insetInlineStart: -5 } : { insetInlineEnd: -5 }),
                  }}
                >
                  <ReadChecksIcon />
                </span>

                <span
                  className="vibra-msg-heart"
                  // Las palomitas mandan: mientras estén, el corazón espera.
                  data-on={
                    !showsReadChecks && (message.likedBy ?? []).length > 0 ? "" : undefined
                  }
                  style={{
                    position: "absolute",
                    bottom: -7,
                    ...(mine ? { insetInlineStart: -5 } : { insetInlineEnd: -5 }),
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="#ff3040">
                    <path d={HEART_PATH} />
                  </svg>
                </span>
              </span>
            ) : null}

            {/* Acciones al pasar el cursor. El hueco se reserva SIEMPRE (aunque
                estén invisibles) para que aparecer no empuje el globo de sitio.
                Van del lado de fuera del globo: a su izquierda si el mensaje es
                mío (pegado a la derecha), a su derecha si es del otro. */}
            {pointerActions ? (
            <span
              className="vibra-msg-actions"
              style={{
                order: mine ? 0 : 6,
                // Pegados AL GLOBO, no centrados en el hueco reservado. Con una
                // sola acción (editar caduca a los 10 minutos, y en lo del otro
                // nunca aparece) centrar dejaba un espacio muerto justo entre el
                // icono y el mensaje. Así el sobrante se va hacia fuera, donde
                // no se nota.
                justifyContent: mine ? "flex-end" : "flex-start",
              }}
            >
              {/* Corazón: mismo gesto que el doble toque de celular, aquí con
                  su propio botón. Contorno cuando no está puesto, relleno y
                  rosa cuando sí. */}
              {!message.isDeleted && conversationId ? (
                <button
                  type="button"
                  className="vibra-msg-action"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleLike(message);
                  }}
                  aria-label={tChat("like")}
                  title={tChat("like")}
                  // El estado sí se anuncia a lectores de pantalla, aunque el
                  // icono no cambie: quien no ve el corazón del globo necesita
                  // saber si ya está puesto.
                  aria-pressed={isLikedByMe(message)}
                >
                  {/* Siempre de contorno, esté puesto o no. Es un botón de
                      acción, no un indicador: el corazón rojo del globo ya dice
                      si está puesto, y rellenar también el botón lo repetía. */}
                  <ActionIcon path={<path d={HEART_PATH} />} />
                </button>
              ) : null}

              {canReply(message) ? (
                <IconButton label={tChat("reply")} size="sm" tone="bare" style={{ color: "rgba(255,255,255,0.92)" }} className="vibra-msg-action" onClick={(e) => { e.stopPropagation(); startReply(message); }}>
                  <ActionIcon path={ICON_REPLY} />
                </IconButton>
              ) : null}

              {/* Editar: solo lo tuyo, con texto y dentro de los 10 minutos.
                  Pasado ese punto las rules lo rechazan, así que ni se ofrece. */}
              {mine && withinWindow && message.text && !message.isDeleted ? (
                <IconButton label={tCommon("edit")} size="sm" tone="bare" style={{ color: "rgba(255,255,255,0.92)" }} className="vibra-msg-action" onClick={(e) => { e.stopPropagation(); startEdit(message); }}>
                  <ActionIcon path={ICON_PENCIL} />
                </IconButton>
              ) : null}
            </span>
            ) : null}

            {/* Ancho cero: se coloca justo antes del globo sin ocupar sitio, así
                que la pista sale a su izquierda tanto si el mensaje va a la
                derecha como si va a la izquierda. */}
            <span
              data-swipe-cue
              aria-hidden
              style={{
                order: 2,
                position: "relative",
                width: 0,
                display: "flex",
                alignItems: "center",
                opacity: 0,
                transform: "scale(0.6)",
                pointerEvents: "none",
              }}
            >
              <span style={{ position: "absolute", insetInlineEnd: 8, display: "flex" }}>
                <SwipeReplyCue />
              </span>
            </span>

          {/* Todo el globo es el disparador del detalle. No es un <button> para
              no anidarlo con el de la imagen; se le da rol y teclado a mano.
              Su rectángulo es lo que se mide para decidir hacia dónde abrir. */}
          <div
            role="button"
            tabIndex={0}
            onClick={(e) => {
              // Un arrastre, o la pulsación larga que ya abrió el menú, acaban
              // disparando un click; ese no debe hacer nada más.
              if (suppressClickRef.current) {
                suppressClickRef.current = false;
                return;
              }
              // Con puntero el menú abre con un clic normal. En táctil NO: allí
              // se abre manteniendo pulsado, y un toque suelto no hace nada.
              if (pointerActions) toggleExpanded(message.id, e.currentTarget);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggleExpanded(message.id, e.currentTarget);
              }
            }}
            style={{
              order: 3,
              cursor: "pointer",
              maxWidth: "78%",
              // El relleno NO va aquí sino en cada parte que lo necesita (cita y
              // texto). Así la imagen llega a los bordes del globo en vez de
              // quedar enmarcada, y una imagen sola no lleva marco ninguno.
              padding: 0,
              // Recorta la imagen contra las esquinas del globo: es lo que le da
              // el redondeo sin tener que repetirlo en el <img>.
              overflow: "hidden",
              // La esquina "pegada" al lado del emisor da la direccionalidad del
              // globo sin necesidad de una cola.
              borderRadius: mine ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
              background: flashing === message.id
                ? BUBBLE_MINE_FLASH
                : bareImage
                  ? "transparent"
                  : mine
                    ? BUBBLE_MINE
                    : BUBBLE_THEIRS,
              // El destello al llegar desde una cita: entra rápido y se va sin
              // prisa, que es lo que hace que el ojo lo siga.
              transition: "background 420ms ease",
              boxShadow:
                mine && !bareImage ? "inset 0 1px 0 rgba(255,255,255,0.06)" : "none",
              minWidth: 0,
              lineHeight: 0,
            }}
          >
            {/* Cita del mensaje al que responde. Tocarla salta al original. */}
            {message.replyTo && !message.isDeleted ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  // Un arrastre que empezó justo encima de la cita también
                  // termina en click aquí; ese no debe saltar a ningún sitio.
                  if (suppressClickRef.current) {
                    suppressClickRef.current = false;
                    return;
                  }
                  jumpToMessage(message.replyTo!.messageId);
                }}
                style={{
                  display: "flex",
                  gap: 7,
                  // Ocupa TODO el ancho del globo (menos sus propios márgenes).
                  // Con `auto` se encogía al contenido y quedaba una cita corta
                  // flotando dentro de un globo ancho.
                  //
                  // El porcentaje no cuenta para calcular el ancho del globo, así
                  // que no hay pescadilla: el globo lo miden el texto o la foto,
                  // y la cita se estira hasta donde llegue.
                  width: "calc(100% - 22px)",
                  boxSizing: "border-box",
                  // Suelo para que responder a algo largo con un "ok" no deje la
                  // cita espachurrada en un globo diminuto.
                  minWidth: 160,
                  textAlign: "start",
                  border: "none",
                  borderRadius: 7,
                  background: "rgba(0,0,0,0.22)",
                  padding: "5px 8px",
                  margin: "8px 11px 5px",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    flexShrink: 0,
                    width: 2.5,
                    borderRadius: 2,
                    background: "#a855f7",
                  }}
                />
                <span style={{ minWidth: 0, flex: 1, display: "grid", gap: 1 }}>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#c99bf5",
                      lineHeight: 1.25,
                      minWidth: 0,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {message.replyTo.senderId === selfUid
                      ? tChat("replyToSelf")
                      : displayName}
                  </span>
                  <span
                    style={{
                      fontSize: 11.5,
                      color: "rgba(255,255,255,0.62)",
                      lineHeight: 1.3,
                      // UN renglón y lo que no quepa se corta con puntos
                      // suspensivos. La cita está para ubicar de qué se habla,
                      // no para volver a contar el mensaje entero.
                      minWidth: 0,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {textoCitado(message.replyTo)}
                  </span>
                </span>
              </button>
            ) : null}

            {/* La imagen ocupa su hueco DESDE EL PRIMER PINTADO, con la silueta
                shimmer detrás. Antes el globo estaba vacío hasta que la imagen
                llegaba y entonces aparecía de golpe, empujando el hilo. Ahora la
                caja ya está reservada con la proporción real y lo único que pasa
                al llegar es que la foto se funde encima. */}
            {!message.isDeleted && message.image ? (
              <button
                type="button"
                onClick={(e) => {
                  // No debe desplegar también el detalle del mensaje.
                  e.stopPropagation();
                  if (!message.image) return;
                  // El rect de la miniatura es de donde crece el visor.
                  openLightbox(message.image, e.currentTarget.getBoundingClientRect());
                }}
                aria-label={tChat("openImage")}
                style={{
                  display: "block",
                  position: "relative",
                  // A sangre: sin relleno, sin borde y sin radio propio. El
                  // redondeo se lo da el recorte del globo.
                  padding: 0,
                  border: "none",
                  background: "none",
                  cursor: "zoom-in",
                  lineHeight: 0,
                  ...imageBox(message.image),
                }}
              >
                <SkeletonBlock
                  style={{
                    position: "absolute",
                    inset: 0,
                    // Se apaga en cuanto la foto está encima, para que no siga
                    // brillando por los bordes.
                    opacity: loadedImages[message.image.thumbnailPath] ? 0 : 1,
                    transition: "opacity var(--duration-fast, 150ms) ease",
                  }}
                />

                {/* <img> y no next/image: la URL de Storage lleva token y las
                    dimensiones las decide el propio archivo. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageUrl(message.image, "thumb") ?? undefined}
                  alt=""
                  onLoad={() => {
                    const path = message.image?.thumbnailPath;
                    if (path) setLoadedImages((prev) => ({ ...prev, [path]: true }));
                    if (stickToBottomRef.current) scrollToBottom(false);
                  }}
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "block",
                    width: "100%",
                    height: "100%",
                    // La caja lleva la proporción real, así que `cover` no
                    // recorta nada: solo evita medio píxel de desajuste.
                    objectFit: "cover",
                    opacity: loadedImages[message.image.thumbnailPath] ? 1 : 0,
                    transition: "opacity var(--duration-slow, 400ms) ease",
                  }}
                />
              </button>
            ) : null}

            {message.isDeleted || message.text ? (
              <div
                style={{
                  // El relleno vive aquí, no en el globo. Con imagen encima se
                  // aprieta un poco arriba: la foto ya separa visualmente.
                  padding: message.image && !message.isDeleted ? "6px 11px 9px" : "8px 11px",
                  fontSize: 13.5,
                  lineHeight: 1.4,
                  color: message.isDeleted
                    ? "rgba(255,255,255,0.42)"
                    : "rgba(255,255,255,0.94)",
                  fontStyle: message.isDeleted ? "italic" : "normal",
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                }}
              >
                {message.isDeleted
                  ? tChat("messageDeleted")
                  : renderMessageText(message.text)}
              </div>
            ) : null}

          </div>
          </div>
        </div>

        {/* Marca de edición FUERA del globo, pegada debajo y en cursiva. */}
        {message.editedAt && !message.isDeleted ? (
          <div
            style={{
              order: 3,
              display: "flex",
              justifyContent: mine ? "flex-end" : "flex-start",
              marginTop: 2,
              padding: mine ? "0 4px 0 0" : "0 0 0 4px",
            }}
          >
            <span
              style={{
                fontSize: 10,
                fontStyle: "italic",
                color: "rgba(255,255,255,0.42)",
                lineHeight: 1,
              }}
            >
              {tChat("edited")}
            </span>
          </div>
        ) : null}

        {/* Detalle FUERA del globo: hora y acciones.
            Siempre montado y animado con grid-template-rows 0fr→1fr (el mismo
            acordeón del OwnerSidebar): así se despliega Y se pliega con
            transición, y llega a la altura real sin tope fijo que recorte. */}
        <div
          ref={expanded ? expandedPanelRef : undefined}
          // Plegado sigue en el DOM (para poder animar el cierre), así que hay
          // que sacarlo del foco y del lector de pantalla a mano.
          aria-hidden={!expanded}
          style={{
            // Arriba del globo si abre hacia arriba; si no, debajo de todo.
            order: opensUp ? 1 : 4,
            display: "grid",
            gridTemplateRows: expanded ? "1fr" : "0fr",
            opacity: expanded ? 1 : 0,
            transition:
              "grid-template-rows var(--duration-normal, 250ms) var(--ease-smooth, cubic-bezier(0.4,0,0.2,1)), opacity var(--duration-fast, 150ms) ease",
          }}
        >
          <div style={{ overflow: "hidden" }}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: mine ? "flex-end" : "flex-start",
                gap: 6,
                paddingTop: 2,
                paddingBottom: 2,
              }}
            >
              {/* La hora va FUERA de la tarjeta, debajo del globo y con el mismo
                  tratamiento que "Editado" (bajo esa palabra si la hay). */}
              <span
                style={{
                  fontSize: 10,
                  color: "rgba(255,255,255,0.42)",
                  lineHeight: 1,
                  padding: mine ? "0 4px 0 0" : "0 0 0 4px",
                }}
              >
                {time}
              </span>

              {/* Tarjeta propia, estilo WhatsApp: superficie elevada, esquinas
                  redondeadas y las acciones como renglones de ancho completo.
                  Un mensaje retirado no tiene acciones: se muestra solo la hora
                  en vez de una tarjeta vacía. */}
              {!message.isDeleted ? (
                <div className="vibra-msg-menu">
                  {/* En celular esto se hace deslizando el mensaje a la derecha.
                      Aquí queda para táctil; con puntero se hace desde los
                      iconos que salen al lado del globo. */}
                  {/* El corazón vive AQUÍ en táctil. Estuvo en el doble toque y
                      dio más problemas de los que resolvía: chocaba con abrir la
                      imagen y obligaba a retrasar todo lo demás. Con puntero
                      tiene su icono al pasar el cursor. */}
                  {!pointerActions && conversationId ? (
                    <button
                      type="button"
                      className="vibra-msg-menu-item"
                      onClick={() => {
                        toggleLike(message);
                        setExpandedMessage(null);
                      }}
                      tabIndex={expanded ? 0 : -1}
                    >
                      <MenuIcon path={<path d={HEART_PATH} />} />
                      {isLikedByMe(message) ? tChat("unlike") : tChat("like")}
                    </button>
                  ) : null}

                  {!pointerActions && canReply(message) ? (
                    <button
                      type="button"
                      className="vibra-msg-menu-item"
                      onClick={() => startReply(message)}
                      tabIndex={expanded ? 0 : -1}
                    >
                      <MenuIcon path={ICON_REPLY} />
                      {tChat("reply")}
                    </button>
                  ) : null}

                  <button
                    type="button"
                    className="vibra-msg-menu-item"
                    onClick={() =>
                      runMessageAction(() =>
                        hideMessageForMe(conversationId!, message.id, selfUid!)
                      )
                    }
                    tabIndex={expanded ? 0 : -1}
                  >
                    <MenuIcon path={ICON_HIDE} />
                    {tChat("deleteForMe")}
                  </button>

                  {/* Retirar y editar solo el autor, y solo dentro de la
                      ventana de 10 minutos: pasado ese punto las rules lo
                      rechazan, así que ni se ofrecen. */}
                  {mine && withinWindow ? (
                    <>
                      <button
                        type="button"
                        className="vibra-msg-menu-item"
                        onClick={() =>
                          runMessageAction(() =>
                            deleteMessageForEveryone(conversationId!, message.id)
                          )
                        }
                        tabIndex={expanded ? 0 : -1}
                      >
                        <MenuIcon path={ICON_TRASH} />
                        {tChat("deleteForEveryone")}
                      </button>

                      {!pointerActions && message.text ? (
                        <button
                          type="button"
                          className="vibra-msg-menu-item"
                          onClick={() => startEdit(message)}
                          tabIndex={expanded ? 0 : -1}
                        >
                          <MenuIcon path={ICON_PENCIL} />
                          {tCommon("edit")}
                        </button>
                      ) : null}
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Solo texto: la foto ya no espera aquí, se manda al elegirla.
  const canSend = draft.trim().length > 0 && !sending && canWrite;

  const noticeStyle = {
    fontSize: 12,
    color: "rgba(255,255,255,0.62)",
    lineHeight: 1.4,
  } as const;

  const secondaryButtonStyle = {
    minHeight: 40,
    borderRadius: 8,
    border: "none",
    background: "rgba(255,255,255,0.10)",
    color: "#fff",
    fontSize: 14,
    fontWeight: 500,
    fontFamily: "inherit",
    cursor: busyAction ? "not-allowed" : "pointer",
    flex: 1,
  } as const;

  function renderFooter() {
    // Bloqueado: no hay campo de escritura, solo el aviso de quién bloqueó a
    // quién. Desbloquear se hace desde el menú ⋮ de la cabecera, que es donde
    // vive el bloqueo de perfil.
    if (isBlocked) {
      return (
        <div style={{ ...noticeStyle, textAlign: "center", padding: "4px 0" }}>
          {iBlocked ? tChat("blockedByMeNotice") : tChat("blockedByThemNotice")}
        </div>
      );
    }

    if (iSentRequest) {
      return <div style={noticeStyle}>{tChat("requestPendingNotice")}</div>;
    }

    if (iReceivedRequest) {
      return (
        <div style={{ display: "grid", gap: 8 }}>
          <div style={noticeStyle}>{tChat("requestReceivedNotice", { name: displayName })}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() =>
                runAction(() => acceptConversationRequest(conversationId!), "actionCompletionError")
              }
              disabled={busyAction}
              style={{ ...secondaryButtonStyle, background: "#a855f7", fontWeight: 600 }}
            >
              {tChat("acceptRequest")}
            </button>
            <button
              type="button"
              onClick={() =>
                runAction(
                  () => rejectConversationRequest(conversationId!, selfUid!),
                  "actionCompletionError"
                )
              }
              disabled={busyAction}
              style={secondaryButtonStyle}
            >
              {tChat("rejectRequest")}
            </button>
          </div>
        </div>
      );
    }

    // Mismo compositor que el chat de los lives: campo sin borde con la flecha
    // morada rellena DENTRO, a la derecha, sin contenedor propio. A la
    // izquierda, el clip verde de adjuntar del compositor de publicaciones.
    return (
      <div style={{ display: "grid", gap: 8 }}>

        {/* Barra de edición: deja claro que lo que escribes reemplaza a un
            mensaje ya enviado, en vez de mandar uno nuevo. */}
        {editing ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 11.5,
              color: "rgba(255,255,255,0.6)",
            }}
          >
            <span style={{ flex: 1, minWidth: 0 }}>{tChat("editingMessage")}</span>
            <TextButton
              tone="brand"
              size="sm"
              onClick={() => {
                setEditing(null);
                setDraft("");
                if (inputRef.current) inputRef.current.style.height = "auto";
              }}
            >
              {tCommon("cancel")}
            </TextButton>
          </div>
        ) : null}

        {/* Mensaje citado. Mismo bloque que se verá dentro del globo al enviar,
            para que lo que se previsualiza y lo que se manda sean lo mismo. */}
        {replyingTo ? (
          <div
            role="group"
            aria-label={tChat("replyingTo", {
              name: replyingTo.senderId === selfUid ? tChat("replyToSelf") : displayName,
            })}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              borderRadius: 10,
              background: "rgba(255,255,255,0.06)",
              backdropFilter: "blur(14px)",
              WebkitBackdropFilter: "blur(14px)",
              padding: "7px 8px 7px 9px",
            }}
          >
            <span
              aria-hidden
              style={{
                flexShrink: 0,
                alignSelf: "stretch",
                width: 2.5,
                borderRadius: 2,
                background: "#a855f7",
              }}
            />
            <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 1 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: "#c99bf5", lineHeight: 1.25 }}>
                {replyingTo.senderId === selfUid ? tChat("replyToSelf") : displayName}
              </span>
              <span
                style={{
                  fontSize: 11.5,
                  color: "rgba(255,255,255,0.62)",
                  lineHeight: 1.3,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {/* La barra de "respondiendo a" que se ve al escribir. Lee del
                    mensaje original igual que la cita ya enviada, así que enseña
                    exactamente lo mismo que verá el otro. */}
                {textoCitado(replyingTo)}
              </span>
            </div>
            <IconButton label={tChat("cancelReply")} size="sm" tone="bare" style={{ placeItems: "center" }} onClick={() => setReplyingTo(null)}>
              <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden>
                <path
                  d="M6 6L18 18M18 6L6 18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                />
              </svg>
            </IconButton>
          </div>
        ) : null}


        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.heic,.heif"
            hidden
            onChange={(e) => handlePickImage(e.target.files?.[0])}
          />

          <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
        <textarea
          ref={inputRef}
          className="vibra-chat-ph"
          data-fading={draftFading ? "" : undefined}
          value={draft}
          onFocus={() => {
            // Ponerse a escribir lleva al final del hilo, como en WhatsApp. Se
            // marca antes de que abra el teclado para que el reajuste que viene
            // después (el hilo encoge) también acabe abajo.
            stickToBottomRef.current = true;
            scrollToBottom(false);
            setComposerFocused(true);
          }}
          onBlur={() => setComposerFocused(false)}
          onChange={(e) => {
            setDraft(e.target.value);
            autoGrow(e.currentTarget);
          }}
          onKeyDown={(e) => {
            // Enter envía; Shift+Enter salta de línea. En celular el teclado
            // manda su propio Enter, así que solo aplica con teclado físico.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          rows={1}
          maxLength={MESSAGE_MAX_LENGTH}
          placeholder={tChat("messagePlaceholder")}
          style={{
            width: "100%",
            boxSizing: "border-box",
            minHeight: INPUT_MIN_HEIGHT,
            maxHeight: INPUT_MAX_HEIGHT,
            // El relleno derecho deja hueco para la flecha de enviar, que es lo
            // único que queda DENTRO del campo. La foto se salió a la derecha.
            //
            // Las medidas cuadran EXACTO con `minHeight`: 20 de línea + 14 y 14
            // de relleno = 48. Con un interlineado en múltiplo (1.5 sobre 13px
            // daba 19.5) sobraba medio píxel y el texto caía descentrado.
            padding: "14px 42px 14px 14px",
            borderRadius: 14,
            border: "none",
            // Translúcido + desenfoque: los mensajes se ven pasar por detrás
            // sin que el texto que escribes deje de leerse.
            background: "rgba(255,255,255,0.06)",
            backdropFilter: "blur(14px)",
            WebkitBackdropFilter: "blur(14px)",
            color: "#fff",
            fontSize: 13,
            fontFamily: "inherit",
            lineHeight: "20px",
            resize: "none",
            outline: "none",
            display: "block",
          }}
        />

        {/* La flecha, DENTRO del campo y anclada abajo: al crecer el campo se
            queda junto a la última línea, que es donde está el cursor. */}
        <div
          style={{
            position: "absolute",
            insetInlineEnd: 6,
            bottom: 0,
            // Alto igual al mínimo del campo: con una línea queda centrada, y al
            // crecer el campo se queda junto a la última línea.
            height: INPUT_MIN_HEIGHT,
            display: "flex",
            alignItems: "center",
          }}
        >
          <button
            type="button"
            /**
             * Se manda desde el DEDO, no desde el clic, y con `preventDefault`.
             *
             * En iOS, tocar este botón con el teclado abierto quitaba el foco del
             * campo, el teclado se cerraba, la pantalla crecía de golpe y el
             * botón se movía de debajo del dedo ANTES de que llegara el `click`:
             * el primer toque solo cerraba el teclado y había que dar un segundo.
             *
             * `preventDefault` en `pointerdown` impide que el foco se mueva, así
             * que el teclado se queda abierto, nada se recoloca y el mensaje sale
             * al primer toque.
             */
            onPointerDown={(e) => {
              if (!canSend) return;
              e.preventDefault();
              void handleSend();
            }}
            // Se queda para quien no usa un puntero: teclado físico y lectores de
            // pantalla, que activan el botón con un `click` sintético. El candado
            // de `handleSend` evita que se mande dos veces.
            onClick={handleSend}
            disabled={!canSend}
            aria-label={tChat("send")}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              cursor: canSend ? "pointer" : "default",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              transition: "opacity 0.15s ease",
              // Al ir inclinada, la masa del avión cae hacia abajo dentro de su
              // caja: centrarla geométricamente la hace ver hundida. Se sube un
              // par de píxeles para que quede centrada A LA VISTA.
              position: "relative",
              top: -2,
            }}
          >
            <svg
              width="23"
              height="23"
              viewBox="0 0 24 24"
              fill="#a855f7"
              stroke="#a855f7"
              strokeWidth="1.5"
              strokeLinejoin="round"
              strokeLinecap="round"
              style={{ transform: "rotate(-20deg)" }}
              aria-hidden="true"
            >
              <path d="M3.4 20.4l17.45-7.48a1 1 0 0 0 0-1.84L3.4 3.6a.993.993 0 0 0-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z" />
            </svg>
          </button>
            </div>
          </div>

          {/* La foto, FUERA del campo y a su derecha. Al ponerte a escribir se
              pliega y le cede el sitio al texto; al soltar el campo vuelve. La
              anchura se anima, así que el campo crece y encoge acompañándola sin
              tener que animar el campo por su cuenta. */}
          <div
            className="vibra-chat-attach"
            data-collapsed={composerFocused ? "" : undefined}
            style={{ height: INPUT_MIN_HEIGHT }}
          >
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending || !canWrite}
              aria-label={tChat("attachImage")}
              // Sin foco cuando está plegado: si no, se puede tabular a un botón
              // invisible.
              tabIndex={composerFocused ? -1 : 0}
              style={{
                flexShrink: 0,
                border: "none",
                background: "none",
                padding: 0,
                display: "grid",
                placeItems: "center",
                cursor: "pointer",
              }}
            >
              <AttachImageIcon size={34} />
            </button>
          </div>

        </div>
      </div>
    );
  }

  function renderBody() {
    // El selector de motivos de reporte se fue con el resto: ahora lo abre el
    // menú ⋮ de la cabecera, con el ReportModal compartido del producto.
    return (
      <>
        {/* Acciones de seguridad del hilo, discretas y siempre a la vista. */}
        {/* Bloquear y reportar ya viven en el menú ⋮ de la cabecera; tenerlos
            también aquí sería la misma acción en dos sitios. */}

        {loading && exists ? (
          <MessageThreadSkeleton />
        ) : (!exists || messages.length === 0) && uploadingIds.length === 0 ? (
          // Con una foto ya subiendo NO se enseña el hilo vacío: la primera cosa
          // que mandas puede ser precisamente esa foto, y decirte "aún no hay
          // mensajes" mientras va en camino se lee como que no se envió.
          <div
            style={{
              fontSize: 12.5,
              color: "rgba(255,255,255,0.52)",
              textAlign: "center",
              padding: "28px 12px",
              lineHeight: 1.5,
            }}
          >
            {tChat("emptyThread", { name: displayName })}
          </div>
        ) : (
          <ChatReveal show>
            <div ref={topSentinelRef} aria-hidden style={{ height: 1 }} />

            {/* Los mensajes anteriores se anuncian con su propia forma —tres
                burbujas alternadas— y no con un renglón que dice que están en
                camino. Van arriba, que es por donde van a entrar. */}
            {loadingOlder ? <MessageThreadSkeleton bubbles={3} /> : null}

            {messages.map((message, index) =>
              renderMessage(message, index > 0 ? messages[index - 1] : null)
            )}

            {/* Fotos en camino. Van al final porque es donde va a aparecer el
                mensaje de verdad en cuanto termine de subir. */}
            {uploadingIds.map((id) => (
              <SendingImageSkeleton key={id} />
            ))}

          </ChatReveal>
        )}
      </>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        // Ancla del visor de imagen, que se posiciona sobre el hilo.
        position: "relative",
      }}
    >
      {/* Global, igual que en el chat de los lives: esa regla solo existe
          mientras hay una transmisión abierta, así que aquí hace falta la
          propia. El valor es el mismo para que el placeholder se vea idéntico. */}
      <style jsx global>{`
        .vibra-chat-ph::placeholder {
          color: rgba(255, 255, 255, 0.32);
        }

        /* Difuminado del resto mientras hay un menú abierto. Entra y sale con la
           misma transición, así que aparecer y desvanecerse son igual de suaves.
           Y deja de recibir toques: pulsar algo borroso no debe activarlo. */
        [data-dimmed] {
          filter: blur(3px);
          opacity: 0.45;
          pointer-events: none;
        }
        [data-dimmed],
        .vibra-msg-dimmable {
          transition:
            filter var(--duration-normal, 250ms) var(--ease-smooth, cubic-bezier(0.4, 0, 0.2, 1)),
            opacity var(--duration-normal, 250ms) var(--ease-smooth, cubic-bezier(0.4, 0, 0.2, 1));
        }
        @media (prefers-reduced-motion: reduce) {
          [data-dimmed],
          .vibra-msg-dimmable {
            transition: none;
          }
        }

        /* Corazón de un mensaje. Entra y sale con el MISMO rebote: al ser una
           transición y no una animación de montaje, quitarlo también se ve. */
        .vibra-msg-heart {
          display: grid;
          place-items: center;
          /* Sin contenedor: el corazón va suelto sobre el globo. Una sombra
             corta lo despega del fondo sin dibujarle una caja alrededor. */
          filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.55));
          pointer-events: none;
          z-index: 1;
          transform: scale(0);
          opacity: 0;
          /* Esta es la transición de SALIDA: CSS aplica la del estado al que se
             va. Las dos propiedades duran lo mismo a propósito — antes la
             opacidad tardaba 150ms y la escala 250, así que el corazón ya era
             invisible cuando empezaba a encoger y la salida parecía un corte
             seco. El easing con tirón negativo lo hace crecer un pelo antes de
             desaparecer: el mismo pop, al revés. */
          transition:
            transform 200ms cubic-bezier(0.36, 0, 0.66, -0.4),
            opacity 200ms ease;
        }
        .vibra-msg-heart[data-on] {
          transform: scale(1);
          opacity: 1;
          /* ENTRADA: rebote más marcado que el ease-spring estándar, porque es
             un elemento pequeño y con el rebote suave apenas se percibía. */
          transition:
            transform 340ms cubic-bezier(0.34, 1.8, 0.64, 1),
            opacity 120ms ease;
        }

        /* El texto se va del campo al enviarlo, en vez de desaparecer seco. */
        .vibra-chat-ph {
          transition: opacity 140ms ease;
        }
        .vibra-chat-ph[data-fading] {
          opacity: 0;
        }

        /* Entrada de un mensaje que llega mientras miras: sube un poco y crece
           hasta su sitio. El easing con rebote es el que hace que se lea como
           que "cae" en la conversación y no como un simple fundido. */
        .vibra-msg-pop {
          animation: vibraMsgPop var(--duration-normal, 250ms)
            var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1)) both;
        }
        @keyframes vibraMsgPop {
          from {
            opacity: 0;
            transform: scale(0.88) translateY(8px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .vibra-chat-ph {
            transition: none;
          }
          .vibra-msg-pop {
            animation: none;
          }
          .vibra-msg-heart {
            transition: none;
          }
        }

        /* Botón de foto, a la derecha del campo. Se pliega al escribir.
           Se anima el ANCHO (y su margen) en vez de esconderlo de golpe: así el
           campo se estira solo, arrastrado por el hueco que queda libre, sin
           necesidad de animarlo por separado. */
        .vibra-chat-attach {
          flex-shrink: 0;
          /* Un pelo más ancho que el icono: con el ancho justo, el recorte que
             hace falta para poder plegarlo le comía el trazo. */
          width: 38px;
          margin-inline-start: 8px;
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 1;
          transition:
            width var(--duration-normal, 250ms) var(--ease-smooth, cubic-bezier(0.4, 0, 0.2, 1)),
            margin-left var(--duration-normal, 250ms) var(--ease-smooth, cubic-bezier(0.4, 0, 0.2, 1)),
            opacity var(--duration-fast, 150ms) var(--ease-smooth, cubic-bezier(0.4, 0, 0.2, 1));
        }
        .vibra-chat-attach[data-collapsed] {
          width: 0;
          margin-inline-start: 0;
          opacity: 0;
          pointer-events: none;
        }
        @media (prefers-reduced-motion: reduce) {
          .vibra-chat-attach {
            transition: none;
          }
        }

        /* Menú de un mensaje, al estilo de WhatsApp: tarjeta compacta con
           superficie propia; el ancho lo fija el texto más largo. */
        .vibra-msg-menu {
          min-width: 168px;
          max-width: 240px;
          border-radius: 12px;
          background: #1f1f23;
          /* Sin contorno: la elevación la da solo la sombra. */
          border: none;
          box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }
        .vibra-msg-menu-item {
          appearance: none;
          border: none;
          background: transparent;
          color: rgba(255, 255, 255, 0.88);
          font-family: inherit;
          font-size: 13px;
          line-height: 1.2;
          text-align: start;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 11px 14px;
          cursor: pointer;
          transition: background var(--duration-fast, 150ms) ease;
          -webkit-tap-highlight-color: transparent;
        }
        @media (hover: hover) {
          .vibra-msg-menu-item:hover {
            background: rgba(255, 255, 255, 0.07);
          }
        }
        .vibra-msg-menu-item:active {
          background: rgba(255, 255, 255, 0.11);
        }

        /* Acciones rápidas al lado del globo. Solo se montan donde hay puntero
           (lo decide la prop pointerActions), así que aquí no hay media query.
           El hueco se reserva siempre para que salir del hover no mueva el
           globo de sitio. */
        .vibra-msg-actions {
          display: flex;
          flex-shrink: 0;
          align-items: center;
          gap: 2px;
          /* Ancho FIJO aunque solo haya una acción: si encogiera, el globo se
             movería de sitio en los mensajes viejos al caducar el editar. */
          width: 56px;
          opacity: 0;
          transition: opacity var(--duration-fast, 150ms) ease;
        }
        /* Visibles también mientras el foco esté dentro: si no, tabular hasta
           ellas las apagaría justo al llegar. */
        .vibra-msg-row:hover .vibra-msg-actions,
        .vibra-msg-actions:focus-within {
          opacity: 1;
        }
        .vibra-msg-action {
          appearance: none;
          border: none;
          background: transparent;
          /* Casi blanco: son la acción, no un adorno del texto. */
          color: rgba(255, 255, 255, 0.92);
          padding: 0;
          width: 26px;
          height: 26px;
          border-radius: 999px;
          display: grid;
          place-items: center;
          cursor: pointer;
          transition: background var(--duration-fast, 150ms) ease,
            color var(--duration-fast, 150ms) ease;
        }
        .vibra-msg-action:hover {
          background: rgba(255, 255, 255, 0.1);
          color: #fff;
        }

      `}</style>

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottomRef.current =
            el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_TO_BOTTOM_SLACK;
        }}
        // Con el menú abierto, tocar en cualquier otro sitio lo cierra. Sin
        // esto, abierto con pulsación larga, no había forma evidente de salir:
        // el resto está difuminado y no responde.
        onClickCapture={(e) => {
          if (!expandedMessage) return;
          const target = e.target as HTMLElement | null;
          if (target?.closest(".vibra-msg-menu")) return;
          setExpandedMessage(null);
        }}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          // Explícito: al deslizar un mensaje se sale de la caja, y sin esto el
          // navegador convertiría ese desbordamiento en scroll horizontal.
          overflowX: "hidden",
          // El rebote de iOS al final del hilo se lo queda el propio scroller y
          // no se propaga a la página de debajo.
          overscrollBehavior: "contain",
          // El relleno inferior deja hueco para el compositor, que va ENCIMA:
          // sin él, el último mensaje quedaría escondido debajo. Se mide en
          // vivo porque el compositor cambia de alto (campo que crece, aviso de
          // error, botones de solicitud).
          padding: `10px 14px ${composerHeight + 10}px`,
        }}
      >
        {renderBody()}
      </div>

      {/* Superpuesto al hilo, no en su propia fila: así los mensajes se ven
          pasar por detrás al scrollear. El campo lleva desenfoque para seguir
          siendo legible sobre ellos. */}
      <div
        ref={composerRef}
        className="vibra-msg-dimmable"
        data-dimmed={expandedMessage ? "" : undefined}
        style={{
          position: "absolute",
          insetInlineStart: 0,
          insetInlineEnd: 0,
          bottom: 0,
          background: "transparent",
          // En celular el hueco de abajo lo pone SOLO el safe-area. Antes se le
          // sumaban 12px y el campo quedaba flotando visiblemente alto.
          padding: safeAreaBottom
            ? "10px 14px var(--vb-safe-bottom, 0px)"
            : "12px 14px",
          display: "grid",
          gap: 8,
          pointerEvents: "none",
        }}
      >
        {/* El texto del error se fue al toast; aquí solo queda el "Reintentar",
            que es una acción y no un aviso: el texto ya volvió al campo, así que
            reintentar es mandarlo otra vez sin que haya que reescribir nada. */}
        {error && draft.trim().length > 0 && !sending ? (
          <div
            style={{
              pointerEvents: "auto",
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
            }}
          >
            <TextButton tone="brand" size="sm" style={{ fontFamily: "inherit", flexShrink: 0 }} onClick={() => void handleSend()}>
              {tChat("retry")}
            </TextButton>
          </div>
        ) : null}
        <div style={{ pointerEvents: "auto" }}>{renderFooter()}</div>
      </div>

      {/* El mismo visor que las imágenes de comentario. Se portalea al body, así
          que cubre la app entera y sirve igual en la pestaña de laptop que en la
          página de celular. */}
      <CommentImageLightbox target={lightbox} onClose={() => setLightbox(null)} />

      <VibraToast toast={toast} />
    </div>
  );
}
