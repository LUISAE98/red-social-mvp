"use client";

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
import type { ProfileMini } from "./ConversationList";
import { ChatReveal, MessageThreadSkeleton } from "./ChatSkeletons";

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
function ActionIcon({ path }: { path: React.ReactNode }) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
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

const INPUT_MAX_HEIGHT = 120;
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
  /** Imagen elegida y ya subida, esperando a enviarse. Una como mucho. */
  const [pendingImage, setPendingImage] = useState<ChatImage | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  /** Imagen abierta a tamaño completo. */
  const [lightbox, setLightbox] = useState<string | null>(null);
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
  const scrollToBottom = useCallback((smooth: boolean) => {
    const container = scrollRef.current;
    if (!container) return;
    container.scrollTo({
      top: container.scrollHeight,
      behavior: smooth ? "smooth" : "auto",
    });
  }, []);

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

    const dx = touch.clientX - swipe.startX;
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

    swipe.slider.style.transform = `translateX(${pull}px)`;
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
      setError(tChat("messageActionError"));
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
  const [error, setError] = useState<string | null>(null);
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
    if (pendingImage && !pendingImage.thumbnailUrl) {
      paths.push(pendingImage.thumbnailPath);
    }
    return paths;
  }, [messages, pendingImage]);

  const signedUrls = useDmImageUrls(conversationId, imagePaths);

  /** URL para pintar: la firmada, o la permanente si es un mensaje antiguo. */
  function imageUrl(image: ChatImage, variant: "thumb" | "full"): string | null {
    if (variant === "thumb") {
      return image.thumbnailUrl ?? signedUrls[image.thumbnailPath] ?? null;
    }
    return image.url ?? signedUrls[image.path] ?? null;
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

  async function handleSend() {
    const body = draft.trim();

    // En modo edición el compositor GUARDA en vez de enviar.
    if (editing) {
      if (!body || sending || !conversationId) return;
      setSending(true);
      setError(null);
      try {
        await editMessage(conversationId, editing.id, body);
        setEditing(null);
        setDraft("");
        if (inputRef.current) inputRef.current.style.height = "auto";
      } catch {
        setError(tChat("messageActionError"));
      } finally {
        setSending(false);
      }
      return;
    }

    // Con imagen el texto es opcional: la imagen sola ya es un mensaje.
    if ((!body && !pendingImage) || sending || uploadingImage || !canWrite || !selfUid) return;

    // Lo que acabas de mandar se ve, estuvieras donde estuvieras leyendo.
    stickToBottomRef.current = true;

    setSending(true);
    setError(null);
    try {
      if (exists) {
        await send(body, pendingImage, replyingTo);
      } else {
        if (!otherUid) throw new Error("missing-other");
        const createdId = await createConversationWithFirstMessage(
          selfUid,
          otherUid,
          body,
          pendingImage
        );
        onConversationCreated?.(createdId);
      }
      setDraft("");
      setPendingImage(null);
      setReplyingTo(null);
      if (inputRef.current) inputRef.current.style.height = "auto";
    } catch {
      setError(tChat("sendError"));
    } finally {
      setSending(false);
    }
  }

  /**
   * Sube la imagen al elegirla, no al enviar: así el envío es instantáneo y los
   * fallos de subida se ven en el momento, con el mensaje todavía sin mandar.
   *
   * El hilo puede no existir aún (modo borrador). El path de Storage usa el ID
   * determinista de la conversación, que ya se conoce antes de crearla.
   */
  async function handlePickImage(file: File | null | undefined) {
    if (!file || !conversationId || uploadingImage) return;

    setUploadingImage(true);
    setError(null);
    try {
      const uploaded = await uploadDirectMessageImage({ conversationId, file });
      setPendingImage(uploaded);
    } catch {
      setError(tChat("imageUploadError"));
    } finally {
      setUploadingImage(false);
      // Permite volver a elegir el MISMO fichero tras quitarlo.
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
          onTouchStart={(e) => beginSwipe(e, message)}
          onTouchMove={moveSwipe}
          onTouchEnd={endSwipe}
          onTouchCancel={endSwipe}
          style={{
            order: 2,
            display: "flex",
            marginTop: 4,
            touchAction: "pan-y",
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
            {/* Acciones al pasar el cursor. El hueco se reserva SIEMPRE (aunque
                estén invisibles) para que aparecer no empuje el globo de sitio.
                Van del lado de fuera del globo: a su izquierda si el mensaje es
                mío (pegado a la derecha), a su derecha si es del otro. */}
            {pointerActions ? (
            <span
              className="vibra-msg-actions"
              style={{
                order: mine ? 0 : 3,
                // Pegados AL GLOBO, no centrados en el hueco reservado. Con una
                // sola acción (editar caduca a los 10 minutos, y en lo del otro
                // nunca aparece) centrar dejaba un espacio muerto justo entre el
                // icono y el mensaje. Así el sobrante se va hacia fuera, donde
                // no se nota.
                justifyContent: mine ? "flex-end" : "flex-start",
              }}
            >
              {canReply(message) ? (
                <button
                  type="button"
                  className="vibra-msg-action"
                  onClick={(e) => {
                    e.stopPropagation();
                    startReply(message);
                  }}
                  aria-label={tChat("reply")}
                  title={tChat("reply")}
                >
                  <ActionIcon path={ICON_REPLY} />
                </button>
              ) : null}

              {/* Editar: solo lo tuyo, con texto y dentro de los 10 minutos.
                  Pasado ese punto las rules lo rechazan, así que ni se ofrece. */}
              {mine && withinWindow && message.text && !message.isDeleted ? (
                <button
                  type="button"
                  className="vibra-msg-action"
                  onClick={(e) => {
                    e.stopPropagation();
                    startEdit(message);
                  }}
                  aria-label={tChat("editMessage")}
                  title={tChat("editMessage")}
                >
                  <ActionIcon path={ICON_PENCIL} />
                </button>
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
                order: 1,
                position: "relative",
                width: 0,
                display: "flex",
                alignItems: "center",
                opacity: 0,
                transform: "scale(0.6)",
                pointerEvents: "none",
              }}
            >
              <span style={{ position: "absolute", right: 8, display: "flex" }}>
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
              // Un arrastre acaba disparando un click; ese no despliega nada.
              if (suppressClickRef.current) {
                suppressClickRef.current = false;
                return;
              }
              toggleExpanded(message.id, e.currentTarget);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggleExpanded(message.id, e.currentTarget);
              }
            }}
            style={{
              order: 2,
              cursor: "pointer",
              maxWidth: "78%",
              padding: "8px 11px",
              // La esquina "pegada" al lado del emisor da la direccionalidad del
              // globo sin necesidad de una cola.
              borderRadius: mine ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
              background: flashing === message.id
                ? "rgba(168,85,247,0.55)"
                : mine
                  ? "rgba(168,85,247,0.30)"
                  : "rgba(255,255,255,0.07)",
              // El destello al llegar desde una cita: entra rápido y se va sin
              // prisa, que es lo que hace que el ojo lo siga.
              transition: "background 420ms ease",
              boxShadow: mine ? "inset 0 1px 0 rgba(255,255,255,0.06)" : "none",
              minWidth: 0,
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
                  width: "100%",
                  textAlign: "left",
                  border: "none",
                  borderRadius: 7,
                  background: "rgba(0,0,0,0.22)",
                  padding: "5px 8px",
                  marginBottom: 5,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  minWidth: 0,
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
                <span style={{ minWidth: 0, display: "grid", gap: 1 }}>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#c99bf5",
                      lineHeight: 1.25,
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
                      // Dos líneas como mucho: la cita ubica, no vuelve a contar
                      // el mensaje entero.
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                      overflowWrap: "anywhere",
                    }}
                  >
                    {message.replyTo.text ||
                      (message.replyTo.hasImage ? tChat("photoPreview") : "")}
                  </span>
                </span>
              </button>
            ) : null}

            {!message.isDeleted && message.image && imageUrl(message.image, "thumb") ? (
              <button
                type="button"
                onClick={(e) => {
                  // No debe desplegar también el detalle del mensaje.
                  e.stopPropagation();
                  setLightbox(message.image ? imageUrl(message.image, "full") : null);
                }}
                aria-label={tChat("openImage")}
                style={{
                  display: "block",
                  padding: 0,
                  border: "none",
                  background: "none",
                  cursor: "zoom-in",
                  borderRadius: 10,
                  overflow: "hidden",
                  marginBottom: message.text ? 6 : 0,
                  lineHeight: 0,
                }}
              >
                {/* <img> y no next/image: la URL de Storage lleva token y las
                    dimensiones las decide el propio archivo. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageUrl(message.image, "thumb") ?? undefined}
                  alt=""
                  // Una imagen no ocupa sitio hasta que carga. Si la del último
                  // mensaje llega tarde, el hilo crece por debajo y lo que
                  // estabas viendo deja de ser el final.
                  onLoad={() => {
                    if (stickToBottomRef.current) scrollToBottom(false);
                  }}
                  style={{
                    display: "block",
                    maxWidth: "100%",
                    maxHeight: 260,
                    width: "auto",
                    height: "auto",
                    borderRadius: 10,
                  }}
                />
              </button>
            ) : null}

            {message.isDeleted || message.text ? (
              <div
                style={{
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
                {message.isDeleted ? tChat("messageDeleted") : message.text}
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
                          {tChat("editMessage")}
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

  const canSend =
    (draft.trim().length > 0 || !!pendingImage) && !sending && !uploadingImage && canWrite;

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
                runAction(() => acceptConversationRequest(conversationId!), "requestActionError")
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
                  "requestActionError"
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
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setDraft("");
                if (inputRef.current) inputRef.current.style.height = "auto";
              }}
              style={{ ...messageActionStyle, color: "#a855f7", fontWeight: 600 }}
            >
              {tCommon("cancel")}
            </button>
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
                {replyingTo.text || (replyingTo.hasImage ? tChat("photoPreview") : "")}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setReplyingTo(null)}
              aria-label={tChat("cancelReply")}
              style={{
                flexShrink: 0,
                width: 22,
                height: 22,
                borderRadius: 999,
                border: "none",
                background: "transparent",
                color: "rgba(255,255,255,0.6)",
                cursor: "pointer",
                display: "grid",
                placeItems: "center",
                padding: 0,
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden>
                <path
                  d="M6 6L18 18M18 6L6 18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        ) : null}

        {/* Previsualización de la imagen elegida, con su X para quitarla. */}
        {pendingImage || uploadingImage ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {pendingImage ? (
              <div style={{ position: "relative", lineHeight: 0 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageUrl(pendingImage, "thumb") ?? undefined}
                  alt=""
                  style={{
                    width: 54,
                    height: 54,
                    objectFit: "cover",
                    borderRadius: 10,
                    display: "block",
                  }}
                />
                <button
                  type="button"
                  onClick={() => setPendingImage(null)}
                  aria-label={tChat("removeImage")}
                  style={{
                    position: "absolute",
                    top: -6,
                    right: -6,
                    width: 20,
                    height: 20,
                    borderRadius: 999,
                    border: "none",
                    background: "rgba(0,0,0,0.78)",
                    color: "#fff",
                    cursor: "pointer",
                    display: "grid",
                    placeItems: "center",
                    padding: 0,
                  }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden>
                    <path
                      d="M6 6L18 18M18 6L6 18"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.6"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>
            ) : (
              <div
                style={{
                  fontSize: 11.5,
                  color: "rgba(255,255,255,0.5)",
                }}
              >
                {tChat("uploadingImage")}
              </div>
            )}
          </div>
        ) : null}

        <div style={{ display: "flex", alignItems: "flex-end", gap: 6 }}>
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
          value={draft}
          onFocus={() => {
            // Ponerse a escribir lleva al final del hilo, como en WhatsApp. Se
            // marca antes de que abra el teclado para que el reajuste que viene
            // después (el hilo encoge) también acabe abajo.
            stickToBottomRef.current = true;
            scrollToBottom(false);
          }}
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
            minHeight: 40,
            maxHeight: INPUT_MAX_HEIGHT,
            // El padding derecho deja el hueco de los DOS iconos que van dentro
            // del campo: el de foto y la flecha de enviar.
            //
            // Las medidas cuadran EXACTO con `minHeight`: 20 de línea + 10 y 10
            // de relleno = 40. Con un interlineado en múltiplo (1.5 sobre 13px
            // daba 19.5) sobraba medio píxel y el texto caía descentrado.
            padding: "10px 72px 10px 12px",
            borderRadius: 12,
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

        {/* Ambos iconos DENTRO del campo, anclados abajo y no centrados: al
            crecer el campo se quedan junto a la última línea, que es donde está
            el cursor. La foto va a la izquierda de la flecha. */}
        <div
          style={{
            position: "absolute",
            right: 6,
            bottom: 0,
            // Alto igual al mínimo del campo y centrado dentro: con una línea
            // quedan en el centro exacto, y al crecer el campo se quedan junto a
            // la última línea, que es donde está el cursor.
            height: 40,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            // Una imagen por mensaje: con una elegida, el botón se apaga.
            disabled={!!pendingImage || uploadingImage || sending}
            aria-label={tChat("attachImage")}
            style={{
              flexShrink: 0,
              border: "none",
              background: "none",
              padding: 0,
              display: "grid",
              placeItems: "center",
              cursor: pendingImage || uploadingImage ? "not-allowed" : "pointer",
              opacity: pendingImage || uploadingImage ? 0.4 : 1,
            }}
          >
            <AttachImageIcon />
          </button>

          <button
            type="button"
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
        ) : !exists || messages.length === 0 ? (
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

            {loadingOlder ? (
              <div
                style={{
                  fontSize: 11,
                  color: "rgba(255,255,255,0.46)",
                  textAlign: "center",
                  padding: "6px 0",
                }}
              >
                {tChat("loadingOlder")}
              </div>
            ) : null}

            {messages.map((message, index) =>
              renderMessage(message, index > 0 ? messages[index - 1] : null)
            )}

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
          text-align: left;
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
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          background: "transparent",
          padding: safeAreaBottom
            ? "12px 14px calc(12px + var(--vb-safe-bottom, 0px))"
            : "12px 14px",
          display: "grid",
          gap: 8,
          pointerEvents: "none",
        }}
      >
        {error ? <div style={{ fontSize: 11.5, color: "#fca5a5" }}>{error}</div> : null}
        <div style={{ pointerEvents: "auto" }}>{renderFooter()}</div>
      </div>

      {/* Visor a tamaño completo. Cubre el hilo entero (no la app), así sirve
          igual en la pestaña de laptop que en la página de celular. */}
      {lightbox ? (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setLightbox(null)}
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 5,
            background: "rgba(0,0,0,0.92)",
            display: "grid",
            placeItems: "center",
            padding: 12,
            cursor: "zoom-out",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox}
            alt=""
            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
          />
        </div>
      ) : null}
    </div>
  );
}
