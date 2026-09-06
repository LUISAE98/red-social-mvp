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

/** Dos hojas superpuestas, la figura de copiar que ya trae todo el mundo. */
const ICON_COPY = (
  <>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M6 15H5a2 2 0 01-2-2V5a2 2 0 012-2h8a2 2 0 012 2v1" />
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

/**
 * Corazón: relleno para la marca del mensaje, contorno para el botón.
 *
 * ⚠️ El trazo es SIMÉTRICO respecto a x=12, y hay que mantenerlo así. El
 * anterior no lo era y por eso la punta de abajo no cuadraba: los lóbulos iban
 * de x=2 a x=20 —o sea, centrados en x=11— mientras que el pico estaba clavado
 * en x=12. Un píxel entero de desfase sobre un icono de diecisiete.
 *
 * Y el cierre de abajo era peor: el lado izquierdo bajaba hasta x=10,4 y el
 * derecho volvía por x=11,6 en vez de por su espejo, x=13,6. Con relleno se leía
 * como una punta torcida y con contorno, como una uve mal cerrada.
 *
 * Cada número tiene su espejo: 3↔21, 8,3↔15,7, 5,4↔18,6, 10,4↔13,6. Al tocarlo,
 * moverlos de dos en dos.
 */
const HEART_PATH =
  "M12 21C10.4 19.6 3 13.9 3 8.8 3 5.6 5.4 3.2 8.3 3.2 10 3.2 11.3 4.1 12 5.2 12.7 4.1 14 3.2 15.7 3.2 18.6 3.2 21 5.6 21 8.8 21 13.9 13.6 19.6 12 21Z";

/**
 * Fondos de los globos, sobre negro.
 *
 * OPACOS y planos. Antes eran el morado de marca con alfa (0.52) sobre el negro
 * del chat, y el negro de debajo se comía la saturación: salía un morado
 * apagado. Un color sólido llega entero a la pantalla.
 *
 * Nada de brillo interior ni sombra: el globo se lee por su color, no por
 * fingir volumen. Con el degradado encima, un reflejo arriba lo volvía un
 * plástico abombado — que es justo lo que se veía en celular.
 *
 * El destello del salto a una cita tiene que seguir leyéndose como un golpe de
 * luz POR ENCIMA del globo, no como su color normal — de ahí la distancia.
 */
const BUBBLE_MINE = "#a855f7";
/**
 * Destello del salto a una cita. Es un velo blanco POR ENCIMA del fondo, no un
 * color de fondo: así sirve igual sobre el morado, sobre el gris del otro y
 * sobre el barrido de color, y además se puede animar de ida y de vuelta.
 */
const BUBBLE_FLASH_VEIL = "inset 0 0 0 999px rgba(255,255,255,0.30)";
/** Los del otro no se tocan: el encargo era iluminar el morado, no el gris. */
const BUBBLE_THEIRS = "rgba(255,255,255,0.07)";

/**
 * Barrido de color del hilo, al estilo de Instagram.
 *
 * ⚠️ La gracia está en que va anclado a la PANTALLA, no al globo: el degradado
 * mide lo que mide el hilo visible y cada globo enseña el trozo que le toca
 * según dónde esté en ese momento. Rosa arriba, azul al centro, morado abajo, y
 * al scrollear los globos van cambiando de color al pasar por delante.
 *
 * Si cada globo llevara su propio degradado, uno pequeño sería un arcoíris
 * entero y uno grande otro distinto; así todos comparten UNA sola rampa.
 *
 * El morado manda: ocupa desde el 78 % hasta abajo, que es donde vive la
 * conversación reciente — lo que más se mira. Rosa y azul son el acento de lo
 * que va quedando arriba.
 */
const THREAD_GRADIENT =
  "linear-gradient(180deg, #ff4d9d 0%, #4d7cf5 38%, #a855f7 78%, #a855f7 100%)";

/**
 * La hora del chat va SIEMPRE en 24 h (14:22), en los 47 idiomas.
 *
 * `hourCycle` y no `hour12: false`: el segundo, en varios locales, devuelve el
 * ciclo h24 y saca las medianoches como "24:00".
 */
const HORA_24H: Intl.DateTimeFormatOptions = {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
};


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
/**
 * Hueco exacto de una foto en el globo.
 *
 * Recibe medidas sueltas y no un `ChatImage` porque lo llama también el hueco
 * de la foto QUE AÚN SE ESTÁ SUBIENDO, que todavía no es un mensaje: las dos
 * cajas tienen que salir de la misma cuenta o al relevarse se movería.
 */
function imageBox(
  imageWidth?: number,
  imageHeight?: number
): {
  width: number;
  maxWidth: string;
  aspectRatio: string;
} {
  const MAX_WIDTH = 240;
  const MAX_HEIGHT = 260;
  const width = imageWidth ?? 0;
  const height = imageHeight ?? 0;

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

/**
 * Mide la foto elegida SIN subirla y deja su URL local viva.
 *
 * `getImageDimensions` de `image-upload` no sirve aquí: revoca la URL nada más
 * medir, y lo que se necesita justo es quedársela para pintar la foto mientras
 * sube. La URL se revoca al cerrar el hilo.
 */
function medirFotoLocal(
  file: File
): Promise<{ url: string; width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () =>
      resolve({ url, width: image.naturalWidth || 0, height: image.naturalHeight || 0 });
    // Sin medidas, `imageBox` cae en su caja por defecto. Se sigue adelante: no
    // poder medir no es motivo para no mandar la foto.
    image.onerror = () => resolve({ url, width: 0, height: 0 });
    image.src = url;
  });
}
/** Una foto elegida que todavía está subiendo, con su hueco ya reservado. */
type FotoEnCamino = {
  id: number;
  /** URL local de la foto: se pinta YA, en su sitio y su tamaño definitivos. */
  previewUrl: string;
  width: number;
  height: number;
  /**
   * Ruta de la miniatura ya subida, o `null` mientras sube. Es la llave del
   * relevo: cuando llega un mensaje con esta misma ruta, este hueco sobra.
   */
  thumbnailPath: string | null;
};

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
  topInset = 0,
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
   * Hueco que hay que reservar ARRIBA porque quien monta el hilo le puso una
   * cabecera superpuesta. Mismo trato que el compositor, que va superpuesto
   * abajo: los mensajes pasan por detrás y el relleno impide que el primero se
   * quede escondido al llegar arriba del todo.
   */
  topInset?: number;
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

  /**
   * Distancia al final por debajo de la cual se considera que estás "abajo".
   * Con margen: al llegar un mensaje mientras lees los últimos, se sigue bajando.
   */
  const STICK_TO_BOTTOM_SLACK = 90;
  /** ¿Seguimos pegados al final? Si te fuiste a leer historia, no se te arrastra. */
  const stickToBottomRef = useRef(true);
  /**
   * Lo mismo, pero como ESTADO, porque el botón de volver al final sí se pinta.
   *
   * Son dos cosas y no una duplicada: el `ref` lo lee el scroll en caliente sin
   * provocar renders, y este solo cambia al cruzar el umbral. Poner el botón a
   * depender del ref no funcionaría —no repinta— y poner el scroll a depender
   * del estado repintaría el hilo entero en cada fotograma de arrastre.
   */
  const [alFinal, setAlFinal] = useState(true);
  /** Mensajes del otro que entraron mientras estabas arriba, sin verlos. */
  const [nuevosAbajo, setNuevosAbajo] = useState(0);

  /**
   * El criterio de "esto ya se ha visto de verdad", guardado en un ref.
   *
   * Hace falta ANTES de llamar al hook —que es quien lo consulta— y solo se
   * puede escribir DESPUÉS, porque mide el último mensaje y los mensajes los
   * devuelve el propio hook. El ref rompe ese círculo.
   */
  const lecturaVisibleRef = useRef<() => boolean>(() => true);

  const {
    messages,
    loading,
    loadingOlder,
    hasMore,
    loadOlder,
    send,
    confirmarLecturaPendiente,
  } = useConversation(
    active && exists ? conversationId : null,
    selfUid,
    // Tener el hilo abierto no es haberlo leído: si estás arriba, en el
    // historial, lo que entra abajo todavía no lo has visto.
    () => lecturaVisibleRef.current()
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
  const [uploading, setUploading] = useState<FotoEnCamino[]>([]);
  const uploadIdRef = useRef(0);
  /**
   * URL local de cada foto que se ha mandado desde aquí, por su ruta de Storage.
   *
   * Es el MISMO archivo que se acaba de subir y ya está decodificado, así que
   * mientras exista manda sobre la URL firmada: el globo real se pinta lleno
   * desde su primer fotograma, sin pasar por el esqueleto. Se revocan al cerrar
   * el hilo.
   */
  const localImageUrls = useRef<Record<string, string>>({});
  /** Todas las URL locales creadas, para poder revocarlas sin rastrear cuál es cuál. */
  const createdObjectUrls = useRef(new Set<string>());
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
  /** Nodo del GLOBO de cada mensaje, para anclarle el barrido de color. */
  const bubbleNodes = useRef(new Map<string, HTMLDivElement>());

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

  function shouldPop(message: MessageWithId): boolean {
    const decided = popDecision.current.get(message.id);
    if (decided !== undefined) return decided;
    // Una foto mía que ya se estaba viendo en su hueco NO entra: ya estaba. El
    // relevo tiene que ser invisible, así que ese mensaje no se anima. Se decide
    // aquí, en el render, y no en un efecto — para entonces la animación ya
    // habría empezado.
    const relevaUnaLocal =
      !!message.image && !!localImageUrls.current[message.image.thumbnailPath];
    const value = firstBatchDone.current && !relevaUnaLocal;
    popDecision.current.set(message.id, value);
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

  /**
   * Copia el texto del mensaje al portapapeles.
   *
   * El renglón lleva `user-select: none` para que la pulsación larga no saque el
   * menú de copiar del sistema encima del nuestro, así que este botón es la
   * ÚNICA forma de copiar un mensaje, en táctil y con puntero.
   *
   * `navigator.clipboard` pide contexto seguro y no está en todos lados; el
   * `textarea` fuera de pantalla con `execCommand` es el respaldo que sí funciona
   * en los navegadores viejos. Mismo par que en `CopyLinkButton`.
   */
  async function copyMessage(message: MessageWithId) {
    const text = message.text;
    if (!text) return;
    setExpandedMessage(null);

    try {
      await navigator.clipboard.writeText(text);
      showToast(tChat("messageCopied"), "success");
      return;
    } catch {
      // Sigue al respaldo.
    }

    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "true");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      textarea.style.pointerEvents = "none";

      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);

      showToast(tChat("messageCopied"), "success");
    } catch {
      setError(tCommon("actionCompletionError"));
    }
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

  const {
    urls: signedUrls,
    failed: failedImagePaths,
    retry: retryImageUrls,
  } = useDmImageUrls(conversationId, imagePaths);

  /**
   * Miniaturas que el navegador NO pudo pintar, por ruta.
   *
   * Es distinto de `failedImagePaths`, que son las que ni siquiera consiguieron
   * URL. Aquí la URL llegó pero la descarga falló — caducada, red caída, archivo
   * ya borrado. Las dos acaban en el mismo aviso, pero se detectan en sitios
   * distintos y hay que llevar la cuenta por separado.
   */
  const [brokenImages, setBrokenImages] = useState<Record<string, true>>({});

  /** Vuelve a intentar TODAS: se pide otra firma y se limpia lo roto. */
  const reintentarImagenes = useCallback(() => {
    setBrokenImages({});
    retryImageUrls();
  }, [retryImageUrls]);

  /**
   * Hasta cuándo leyó la otra persona, en milisegundos.
   *
   * Sale del recibo agregado que ya existía: `lastReadAt` guarda hasta cuándo
   * leyó cada quien, así que un mensaje está leído si es anterior a esa marca.
   * No hace falta ningún campo por mensaje ni ninguna escritura nueva — que es
   * justo lo que abarataba este diseño desde el principio.
   *
   * Antes esto buscaba UN mensaje, el último leído, porque las palomitas iban
   * solo en él. Ahora las lleva cada mensaje mío, así que lo que hace falta es
   * la marca suelta y cada globo se compara con ella.
   */
  const otherLastReadMs = useMemo(() => {
    const readAt = otherUid ? conversation?.lastReadAt?.[otherUid] : null;
    return readAt ? readAt.toMillis() : null;
  }, [conversation?.lastReadAt, otherUid]);

  /**
   * Hasta dónde había leído YO al abrir el hilo. CONGELADO a propósito.
   *
   * ⚠️ Abrir el hilo lo marca como leído, así que este dato se destruye a sí
   * mismo: un segundo después de entrar, `lastReadAt` ya dice "ahora" y la línea
   * de mensajes nuevos no tendría dónde ponerse. Por eso se guarda el PRIMER
   * valor que se ve de cada conversación y no se vuelve a tocar mientras el hilo
   * siga abierto — que es además el comportamiento que se espera: la línea se
   * queda donde estaba aunque sigas leyendo, y solo se recoloca al volver a
   * entrar.
   *
   * Si el acuse de lectura gana la carrera al primer snapshot, no hay línea.
   * Se pierde la marca, no se rompe nada.
   */
  const miLecturaFijadaRef = useRef<number | null>(null);
  const [miLecturaFijada, setMiLecturaFijada] = useState<number | null>(null);

  useEffect(() => {
    if (miLecturaFijadaRef.current !== null) return;
    const readAt = selfUid ? conversation?.lastReadAt?.[selfUid] : null;
    if (!readAt) return;
    miLecturaFijadaRef.current = readAt.toMillis();
    setMiLecturaFijada(readAt.toMillis());
  }, [conversation?.lastReadAt, selfUid]);

  /**
   * El primer mensaje del otro que llegó DESPUÉS de esa marca: encima de él va
   * la línea. Se recalcula al cambiar los mensajes, pero como la marca está
   * congelada el resultado no se mueve — salvo que cargues más historial y
   * aparezca uno anterior que tampoco habías leído, que es lo correcto.
   */
  const idPrimerNoLeido = useMemo(() => {
    if (miLecturaFijada === null || !selfUid) return null;
    for (const message of messages) {
      if (message.senderId === selfUid) continue;
      const at = message.createdAt;
      if (at && at.toMillis() > miLecturaFijada) return message.id;
    }
    return null;
  }, [messages, miLecturaFijada, selfUid]);

  /** URL para pintar: la firmada, o la permanente si es un mensaje antiguo. */
  function imageUrl(image: ChatImage, variant: "thumb" | "full"): string | null {
    if (variant === "thumb") {
      // La copia local va PRIMERO: es el archivo que se acaba de mandar, ya
      // decodificado. Sin ella, el globo que releva a la foto en camino se
      // pintaría vacío hasta que llegara la firma.
      return (
        localImageUrls.current[image.thumbnailPath] ??
        image.thumbnailUrl ??
        signedUrls[image.thumbnailPath] ??
        null
      );
    }
    return (
      localImageUrls.current[image.path] ?? image.url ?? signedUrls[image.path] ?? null
    );
  }

  /**
   * ¿Esta imagen ya no va a poder verse?
   *
   * ⚠️ Lo importante es lo que NO cuenta como rota: que todavía no tenga URL.
   * Mientras la firma está en vuelo eso es normal y toca esperar con el
   * esqueleto. Solo es un fallo cuando la firma ya respondió sin ella
   * (`failedImagePaths`) o cuando la descarga se cayó con la URL en la mano
   * (`brokenImages`). Confundir las dos cosas es justo lo que dejaba el
   * esqueleto girando para siempre.
   */
  function imagenRota(image: ChatImage): boolean {
    if (brokenImages[image.thumbnailPath]) return true;
    return !imageUrl(image, "thumb") && failedImagePaths.has(image.thumbnailPath);
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

  /**
   * ¿Se ha visto DE VERDAD lo último que llegó?
   *
   * Es el permiso para mandar el recibo de lectura, y pide dos cosas:
   *
   *  1. Que la pestaña esté delante. Con el chat abierto en una pestaña de
   *     atrás no se está leyendo nada, por muy abajo que estuviera el scroll.
   *  2. Que el ÚLTIMO mensaje quepa entero en lo que se ve, con su borde de
   *     abajo por encima del compositor —que va superpuesto y tapa esa franja—.
   *
   * Lo segundo es más estricto que "estás al final del hilo": un mensaje muy
   * alto puede asomar por el canto inferior y contar como leído sin que se haya
   * visto ni la primera línea. Aquí no cuenta hasta que se llega a su final.
   *
   * Sin nodo que medir (el hilo todavía sin pintar) se cae al criterio de
   * siempre, que es el que ya usa el auto-scroll.
   */
  const LECTURA_SLACK = 4;
  const ultimoMensajeALaVista = useCallback(() => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      return false;
    }

    const container = scrollRef.current;
    if (!container) return false;

    const last = messages[messages.length - 1];
    const node = last ? messageNodes.current.get(last.id) : null;
    if (!node) return stickToBottomRef.current;

    const containerRect = container.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const visibleBottom = containerRect.bottom - composerHeight;

    return nodeRect.bottom <= visibleBottom + LECTURA_SLACK;
  }, [messages, composerHeight]);

  useEffect(() => {
    lecturaVisibleRef.current = ultimoMensajeALaVista;
  }, [ultimoMensajeALaVista]);

  /**
   * Volver a la pestaña también es leer: aquí sale el recibo que se quedó
   * guardado mientras el chat estaba detrás. Si no había nada pendiente, no
   * escribe nada.
   */
  useEffect(() => {
    const alVolver = () => {
      if (document.visibilityState === "visible") confirmarLecturaPendiente();
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => document.removeEventListener("visibilitychange", alVolver);
  }, [confirmarLecturaPendiente]);

  /**
   * Ancla el barrido de color a la PANTALLA, no a cada globo.
   *
   * Son dos datos y ya: cuánto mide el hilo visible (`--vb-thread-h`) y a qué
   * altura del contenido está cada globo (`--vb-bubble-y`). Con eso, el globo
   * pinta el degradado a tamaño de pantalla y lo desplaza hacia arriba justo lo
   * que él baja, así que todos comparten UNA rampa continua.
   *
   * ⚠️ El scroll NO vuelve a medir nada: mueve una sola variable en el scroller
   * (`--vb-thread-scroll`) y la herencia de CSS reposiciona los globos sola. Si
   * hubiera que recorrer los nodos en cada fotograma, esto no se podría hacer.
   *
   * Se mide con rectángulos y no con `offsetTop` porque el difuminado del menú
   * abierto es un `filter`, y un ancestro con filtro cambia contra quién se
   * calcula ese `offsetTop`. El rectángulo no se entera de nada de eso.
   *
   * Todas las lecturas van antes que las escrituras: así el navegador recalcula
   * el layout UNA vez y no una por globo.
   */
  const measureBubbleTints = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;

    const scrollTop = container.scrollTop;
    // Y del contenido = Y en pantalla − Y del scroller + lo ya scrolleado.
    const origin = container.getBoundingClientRect().top - scrollTop;
    const medidas: Array<[HTMLElement, number]> = [];
    for (const node of bubbleNodes.current.values()) {
      medidas.push([node, node.getBoundingClientRect().top - origin]);
    }

    container.style.setProperty("--vb-thread-h", `${container.clientHeight}px`);
    container.style.setProperty("--vb-thread-scroll", `${scrollTop}px`);
    for (const [node, y] of medidas) {
      node.style.setProperty("--vb-bubble-y", `${y}px`);
    }
  }, []);

  /**
   * Se vuelve a medir cuando algo mueve los globos de sitio: mensajes nuevos o
   * más historial, una foto que al cargar cambia el alto, y el menú al abrirse.
   * Mientras no se haya medido, el globo se queda en su morado plano — de ahí
   * el `-100vh` por defecto, que deja el degradado fuera del recorte.
   */
  useEffect(() => {
    measureBubbleTints();
    // Y otra vez pasada la transición: el menú se despliega en 250 ms y los
    // globos de debajo terminan en un sitio distinto del que tenían al abrirlo.
    const timer = window.setTimeout(measureBubbleTints, 320);
    return () => window.clearTimeout(timer);
  }, [messages, loadedImages, expandedMessage, measureBubbleTints]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => measureBubbleTints());
    observer.observe(container);
    return () => observer.disconnect();
  }, [measureBubbleTints]);

  useEffect(() => {
    setDraft("");
    setError(null);
    setReplyingTo(null);
    lastMessageIdRef.current = null;
    // Otro hilo, otra cuenta de nuevos y otra marca de por dónde ibas.
    setNuevosAbajo(0);
    setAlFinal(true);
    ultimoContadoRef.current = null;
    miLecturaFijadaRef.current = null;
    setMiLecturaFijada(null);
  }, [conversationId]);

  /**
   * Cuenta lo que entra mientras estás arriba.
   *
   * Solo lo del otro y solo si NO estás abajo: lo tuyo ya lo ves, y estando al
   * final el mensaje entra en pantalla solo. La primera tanda tampoco cuenta —
   * abrir un hilo no es "te han llegado cinco mientras leías".
   */
  const ultimoContadoRef = useRef<string | null>(null);
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last) return;
    if (ultimoContadoRef.current === last.id) return;

    const esLaPrimeraTanda = ultimoContadoRef.current === null;
    ultimoContadoRef.current = last.id;
    if (esLaPrimeraTanda) return;
    if (last.senderId === selfUid) return;
    if (stickToBottomRef.current) return;

    setNuevosAbajo((n) => n + 1);
  }, [messages, selfUid]);

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
   * ⚠️ La foto se pinta desde el primer momento EN SU SITIO DEFINITIVO. Antes su
   * hueco era un rectángulo gris de 200×150 fijo y el mensaje real entraba
   * después con la animación de siempre: cambiaba de tamaño Y subía desde abajo,
   * o sea que la foto parecía salir de debajo del hueco. Ahora:
   *
   *  1. se mide el archivo antes de nada, y el hueco sale de la MISMA cuenta
   *     que usará el globo (`imageBox`), así que mide lo mismo;
   *  2. dentro del hueco va la propia foto, no una silueta;
   *  3. el hueco no se suelta al acabar la subida sino cuando LLEGA el mensaje,
   *     de modo que nunca están los dos ni queda un fotograma vacío;
   *  4. el mensaje que releva a una foto local no se anima: ya estaba ahí.
   *
   * El hilo puede no existir aún (modo borrador). La ruta de Storage usa el ID
   * determinista de la conversación, que se conoce antes de crearla.
   */
  async function handlePickImage(file: File | null | undefined) {
    if (!file || !conversationId || !canWrite) return;

    const uploadId = ++uploadIdRef.current;
    // Se mide ANTES de enseñar nada: con el hueco puesto a ojo, al llegar la
    // foto real cambiaría de forma, que es justo el salto que se quiere quitar.
    const preview = await medirFotoLocal(file);
    createdObjectUrls.current.add(preview.url);

    setUploading((prev) => [
      ...prev,
      {
        id: uploadId,
        previewUrl: preview.url,
        width: preview.width,
        height: preview.height,
        thumbnailPath: null,
      },
    ]);
    stickToBottomRef.current = true;
    setError(null);

    try {
      const uploaded = await uploadDirectMessageImage({ conversationId, file });
      // La copia local pasa a valer como miniatura de esas rutas: es el mismo
      // archivo, así que el globo real nace ya pintado.
      localImageUrls.current[uploaded.thumbnailPath] = preview.url;
      localImageUrls.current[uploaded.path] = preview.url;
      setUploading((prev) =>
        prev.map((foto) =>
          foto.id === uploadId ? { ...foto, thumbnailPath: uploaded.thumbnailPath } : foto
        )
      );
      // La foto va sola: el pie de foto se escribe como un mensaje aparte.
      await deliver("", uploaded, null);
    } catch {
      setError(tCommon("imageUploadError"));
      // Solo se retira a mano cuando FALLA. Si sale bien, el hueco lo libera el
      // mensaje de verdad al llegar; retirarlo aquí dejaría un parpadeo vacío.
      setUploading((prev) => prev.filter((foto) => foto.id !== uploadId));
    } finally {
      // Permite volver a elegir el MISMO fichero justo después.
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  /**
   * Relevo: el hueco de una foto en camino se suelta cuando su mensaje ya está
   * en el hilo, no cuando termina la subida. Entre una cosa y la otra hay un
   * viaje a Firestore, y soltarlo antes dejaba el hilo sin foto ese rato.
   *
   * ⚠️ Se decide EN EL RENDER y no en un efecto. Los efectos corren después de
   * pintar, así que por un fotograma se habrían visto las dos — la foto en
   * camino y su mensaje — y al desaparecer una, el salto. Así el mensaje real y
   * la retirada del hueco caen en la misma pintada.
   */
  const uploadingVisible = useMemo(() => {
    if (uploading.length === 0) return uploading;

    const llegadas = new Set(
      messages.map((message) => message.image?.thumbnailPath).filter(Boolean)
    );
    return uploading.filter(
      (foto) => !foto.thumbnailPath || !llegadas.has(foto.thumbnailPath)
    );
  }, [messages, uploading]);

  /** Y ya sin prisa, se limpia el estado de las que dejaron de pintarse. */
  useEffect(() => {
    if (uploadingVisible.length !== uploading.length) setUploading(uploadingVisible);
  }, [uploadingVisible, uploading]);

  /**
   * Una foto que se acaba de elegir tiene que VERSE, aunque el hilo estuviera al
   * final: ocupa su sitio y lo empuja fuera de la pantalla.
   */
  useEffect(() => {
    if (uploadingVisible.length > 0 && stickToBottomRef.current) scrollToBottom(true);
  }, [uploadingVisible.length, scrollToBottom]);

  /** Las URL locales mueren con el hilo; hasta entonces son la miniatura buena. */
  useEffect(() => {
    const creadas = createdObjectUrls.current;
    const porRuta = localImageUrls.current;
    return () => {
      for (const url of creadas) URL.revokeObjectURL(url);
      creadas.clear();
      for (const ruta of Object.keys(porRuta)) delete porRuta[ruta];
    };
  }, [conversationId]);

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
          new Intl.DateTimeFormat(locale, HORA_24H).format(date),
          new Intl.DateTimeFormat(locale, {
            day: "numeric",
            month: "short",
            year: "numeric",
          }).format(date),
        ].join(" · ")
      : "";

    /** La del pie del globo: solo la hora, sin la fecha. */
    const shortTime = date
      ? new Intl.DateTimeFormat(locale, HORA_24H).format(date)
      : "";

    /**
     * Las palomitas van en TODOS mis mensajes, no solo en el último.
     *
     * Antes marcaban uno solo — el último que la otra persona había visto — para
     * no llenar el hilo de iconos. Con el pie dentro del globo ya no estorban:
     * son parte del renglón de la hora, como en WhatsApp, y así se ve de un
     * vistazo dónde se quedó de leer sin tener que deducirlo.
     *
     * Azules si ya lo leyeron, grises si aún no. Sin `createdAt` es una
     * escritura optimista que el servidor no ha sellado: no se puede comparar,
     * y desde luego no está leída.
     */
    const showsReadChecks = mine;
    const readByOther =
      !!date && otherLastReadMs !== null && date.getTime() <= otherLastReadMs;

    /**
     * Hueco que el texto le reserva al pie en su última línea.
     *
     * El pie va posicionado sobre la esquina del globo, o sea FUERA del flujo,
     * así que sin esto el final del último renglón se le metería debajo. Un
     * hueco al final del texto lo empuja, y si no cabe, el pie se queda solo en
     * un renglón nuevo — que es exactamente lo que hace WhatsApp.
     */
    const metaWidth = (shortTime ? 34 : 0) + (showsReadChecks ? 21 : 0);

    // Una imagen sin pie ni cita ES el mensaje: no lleva globo detrás, solo sus
    // esquinas redondeadas.
    const bareImage = !message.isDeleted && !!message.image && !message.text && !message.replyTo;

    /**
     * ¿Este mensaje lleva me gusta?
     *
     * De CUALQUIERA de los dos, no solo mío: en un hilo de dos, que la otra
     * persona marque algo tuyo es justo lo que quieres ver. `isLikedByMe` es
     * otra cosa y solo decide qué hace el botón al pulsarlo.
     */
    const hayCorazon = (message.likedBy ?? []).length > 0;

    /**
     * La foto ya se puede enseñar: o la pintó el navegador, o es una que se
     * mandó desde aquí y sigue en memoria.
     *
     * Lo segundo importa para el relevo: la copia local ya está decodificada,
     * así que esperar a su `onLoad` para encenderla metía un parpadeo de
     * esqueleto justo encima de una foto que ya se estaba viendo.
     */
    const fotoLista =
      !!message.image &&
      (!!loadedImages[message.image.thumbnailPath] ||
        !!localImageUrls.current[message.image.thumbnailPath]);

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
        // Los que llegan mientras miras entran con un pequeño rebote. Los que
        // traen foto no: una foto se funde en su sitio y no se mueve, porque su
        // hueco ya estaba reservado y moverla lo delata.
        className={
          shouldPop(message)
            ? message.image
              ? "vibra-msg-fade"
              : "vibra-msg-pop"
            : undefined
        }
        // Con un menú abierto, TODO lo demás se difumina: el mensaje que
        // pulsaste y su menú se quedan nítidos y el ojo va solo hacia ellos.
        data-dimmed={
          expandedMessage && expandedMessage.id !== message.id ? "" : undefined
        }
        style={{ display: "flex", flexDirection: "column" }}
      >
        {/* Por aquí ibas. Va ENCIMA del separador de día (`order: -1`) porque
            marca un punto de tu lectura, no un cambio de fecha: si el primero
            sin leer estrena día, primero se dice que ahí empieza lo nuevo y
            después de qué día es. */}
        {idPrimerNoLeido === message.id ? (
          <div
            style={{
              order: -1,
              display: "flex",
              alignItems: "center",
              gap: 10,
              margin: "16px 2px 8px",
            }}
          >
            <span
              aria-hidden
              style={{ flex: 1, height: 1, background: "rgba(168,85,247,0.35)" }}
            />
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 600,
                letterSpacing: "0.02em",
                color: "#c99bf5",
                whiteSpace: "nowrap",
              }}
            >
              {tChat("newMessages")}
            </span>
            <span
              aria-hidden
              style={{ flex: 1, height: 1, background: "rgba(168,85,247,0.35)" }}
            />
          </div>
        ) : null}

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
            {/* ⚠️ Solo en TÁCTIL. Con puntero, el corazón rojo lo pinta el propio
                botón de al lado, que ocupa este mismo sitio: mantener además
                esta marca era lo que enseñaba dos corazones seguidos. En táctil
                no hay botón —el me gusta se pone desde el menú—, así que aquí
                sigue siendo la única forma de verlo. */}
            {!message.isDeleted && !pointerActions ? (
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
                {/* Aquí fuera ya SOLO vive el corazón. Las palomitas de leído
                    se mudaron dentro del globo: compartir este hueco las hacía
                    turnarse (mientras estaban ellas, el corazón esperaba) y
                    encima quedaban por debajo de la foto del mensaje siguiente.
                    Va siempre montado y se enciende con el atributo, para que el
                    pop de entrada y el de salida sean la misma transición. */}
                {/* ⚠️ CENTRADO en vertical, no colgado de la esquina de abajo.
                    Ahí quedaba a caballo entre el globo y el vacío, sin alinearse
                    con nada, y en un mensaje alto se perdía. Ahora cae justo
                    donde con puntero sale el corazón de pasar el cursor, o sea
                    en el mismo sitio en celular y en laptop.

                    El centrado NO lleva `translateY`: lo hace el `align-items`
                    del hueco, porque un absoluto sin `top` ni `bottom` se coloca
                    en su posición estática, y ahí sí manda el flex del padre.
                    Así el `transform` queda libre para el pop, que es de quien
                    es — mezclarlos haría que al animar se descolocara. */}
                <span
                  className="vibra-msg-heart"
                  data-on={hayCorazon ? "" : undefined}
                  style={{
                    position: "absolute",
                    // 4,5 px + medio icono = 13 px afuera, que es exactamente
                    // donde cae el centro del botón de pasar el cursor.
                    ...(mine ? { insetInlineStart: -4.5 } : { insetInlineEnd: -4.5 }),
                  }}
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="#ff3040">
                    <path d={HEART_PATH} />
                  </svg>
                </span>
              </span>
            ) : null}

            {/* Acción al pasar el cursor. El hueco se reserva SIEMPRE (aunque
                esté invisible) para que aparecer no empuje el globo de sitio.
                Va del lado de fuera del globo: a su izquierda si el mensaje es
                mío (pegado a la derecha), a su derecha si es del otro.

                ⚠️ Aquí queda SOLO el corazón. Responder y editar se fueron al
                menú del clic: tres iconos no cabían en el hueco reservado y se
                salían del panel por la izquierda, encima de la página de
                debajo. El corazón se queda porque es lo único que se usa de
                pasada; el resto ya tiene su sitio en el menú. */}
            {pointerActions ? (
            <span
              className="vibra-msg-actions"
              // Con me gusta puesto, el corazón se queda a la vista aunque el
              // cursor no esté encima: ahí ya no es una acción escondida, es la
              // marca del mensaje.
              data-on={hayCorazon ? "" : undefined}
              style={{
                order: mine ? 0 : 6,
                // Pegado AL GLOBO, no centrado en el hueco reservado: centrar
                // dejaba un espacio muerto justo entre el icono y el mensaje.
                // Así el sobrante se va hacia fuera, donde no se nota.
                justifyContent: mine ? "flex-end" : "flex-start",
              }}
            >
              {/* ⚠️ UN corazón, no dos.
                  Este botón es a la vez la acción y el indicador: vacío cuando
                  no hay me gusta, ROJO en el mismo sitio cuando lo hay, y volver
                  a pulsarlo lo quita. Antes el rojo era una marca aparte que se
                  pintaba al lado, así que un mensaje con me gusta enseñaba dos
                  corazones seguidos al pasar el cursor. */}
              {!message.isDeleted && conversationId ? (
                <button
                  type="button"
                  className="vibra-msg-action"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleLike(message);
                  }}
                  aria-label={isLikedByMe(message) ? tChat("unlike") : tChat("like")}
                  title={isLikedByMe(message) ? tChat("unlike") : tChat("like")}
                  aria-pressed={isLikedByMe(message)}
                >
                  {/* Los DOS corazones van siempre montados, uno encima del
                      otro, y solo cambia cuál está encendido. Es lo que da el
                      pop en las dos direcciones: al poner el me gusta, el rojo
                      entra con rebote mientras el vacío se va, y al quitarlo,
                      al revés. Montar y desmontar sería un corte seco. */}
                  <span
                    style={{
                      position: "relative",
                      width: 17,
                      height: 17,
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    <span
                      className="vibra-msg-heart"
                      data-on={hayCorazon ? undefined : ""}
                      style={{ position: "absolute" }}
                    >
                      <ActionIcon path={<path d={HEART_PATH} />} />
                    </span>
                    <span
                      className="vibra-msg-heart"
                      data-on={hayCorazon ? "" : undefined}
                      style={{ position: "absolute", color: "#ff3040" }}
                    >
                      <ActionIcon path={<path d={HEART_PATH} />} fill="#ff3040" />
                    </span>
                  </span>
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
            ref={(node) => {
              if (node) bubbleNodes.current.set(message.id, node);
              else bubbleNodes.current.delete(message.id);
            }}
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
              // Ancla de las palomitas de leído, que van dentro del globo.
              position: "relative",
              backgroundColor: bareImage
                ? "transparent"
                : mine
                  ? BUBBLE_MINE
                  : BUBBLE_THEIRS,
              /* El barrido de color solo va en LO MÍO, como en Instagram: los
                 globos del otro son el gris neutro contra el que se lee. Se pinta
                 a tamaño de pantalla y se sube tanto como haya bajado el globo,
                 así que todos los míos comparten la misma rampa continua.

                 Sin medir todavía, `--vb-bubble-y` vale -100vh: el degradado cae
                 fuera del globo y lo que se ve es el morado plano de debajo. */
              backgroundImage: mine && !bareImage ? THREAD_GRADIENT : "none",
              backgroundRepeat: "no-repeat",
              backgroundSize: "100% var(--vb-thread-h, 100vh)",
              backgroundPosition:
                "0 calc(var(--vb-thread-scroll, 0px) - var(--vb-bubble-y, -100vh))",
              // Plano: sin brillo interior. El destello al llegar desde una cita
              // entra rápido y se va sin prisa, que es lo que hace que el ojo lo
              // siga.
              boxShadow:
                flashing === message.id
                  ? BUBBLE_FLASH_VEIL
                  : "inset 0 0 0 999px rgba(255,255,255,0)",
              transition: "box-shadow 420ms ease",
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
            {!message.isDeleted && message.image && imagenRota(message.image) ? (
              /* No se pudo pintar. Antes esto era el esqueleto girando para
                 siempre, sin decir nada: un fallo temporal y uno permanente se
                 veían igual, y en ninguno de los dos casos había forma de
                 reintentar. Ahora el hueco explica qué pasó y ofrece la salida. */
              <div
                style={{
                  ...imageBox(message.image.width, message.image.height),
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  padding: 12,
                  boxSizing: "border-box",
                  background: "rgba(255,255,255,0.06)",
                  color: "rgba(255,255,255,0.6)",
                  fontSize: 12,
                  lineHeight: 1.35,
                  textAlign: "center",
                }}
              >
                <span>{tChat("imageFailed")}</span>
                <TextButton
                  tone="brand"
                  size="sm"
                  onClick={(e) => {
                    // Igual que la miniatura: no debe desplegar el mensaje.
                    e.stopPropagation();
                    reintentarImagenes();
                  }}
                >
                  {/* `retry` ya existía para el reenvío de un mensaje fallido.
                      Es la misma palabra y la misma acción, así que se reusa. */}
                  {tChat("retry")}
                </TextButton>
              </div>
            ) : !message.isDeleted && message.image ? (
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
                  ...imageBox(message.image.width, message.image.height),
                }}
              >
                <SkeletonBlock
                  style={{
                    position: "absolute",
                    inset: 0,
                    // Se apaga en cuanto la foto está encima, para que no siga
                    // brillando por los bordes.
                    opacity: fotoLista ? 0 : 1,
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
                  // La URL llegó pero la descarga falló: caducada, red caída o
                  // archivo ya borrado. Sin esto, el esqueleto se quedaba
                  // girando eternamente.
                  onError={() => {
                    const path = message.image?.thumbnailPath;
                    if (path) setBrokenImages((prev) => ({ ...prev, [path]: true }));
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
                    opacity: fotoLista ? 1 : 0,
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

                {/* El hueco del pie, al final del texto y no como relleno del
                    bloque: como relleno se lo comería a TODOS los renglones, y
                    en un mensaje largo eso es una columna vacía de arriba abajo.
                    Aquí solo estrecha el último, que es el único que lo necesita. */}
                {metaWidth ? (
                  <span
                    aria-hidden
                    style={{ display: "inline-block", width: metaWidth, height: 1 }}
                  />
                ) : null}
              </div>
            ) : null}

            {/* Pie del globo, al estilo de WhatsApp: la hora y, en lo mío, las
                palomitas detrás. Va DENTRO y en la esquina inferior interior —
                fuera se les cruzaba todo, quedaban debajo de la foto del mensaje
                siguiente y compartían sitio con el corazón. Sobre una foto a
                sangre la sombra lo despega del fondo.

                Es decorativo para el lector de pantalla: la hora completa, con
                su fecha, ya se anuncia en el detalle que abre el menú. */}
            {shortTime || showsReadChecks ? (
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  insetInlineEnd: 9,
                  bottom: 5,
                  display: "flex",
                  alignItems: "center",
                  gap: 3,
                  lineHeight: 1,
                  pointerEvents: "none",
                  fontSize: 10.5,
                  // Cifras de ancho fijo: sin esto la hora cambia de ancho al
                  // pasar de las 11:11 a las 20:00 y el hueco reservado deja de
                  // cuadrar.
                  fontVariantNumeric: "tabular-nums",
                  color: mine ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.45)",
                  filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.55))",
                }}
              >
                {shortTime ? <span>{shortTime}</span> : null}
                {showsReadChecks ? (
                  <ReadChecksIcon
                    size={16}
                    color={readByOther ? "#53bdeb" : "rgba(255,255,255,0.55)"}
                  />
                ) : null}
              </span>
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
                  {/* El corazón es la ÚNICA acción que no está aquí con puntero:
                      allí tiene su icono al lado del globo, que es lo que se usa
                      de pasada. En táctil vive aquí — estuvo en el doble toque y
                      dio más problemas de los que resolvía: chocaba con abrir la
                      imagen y obligaba a retrasar todo lo demás. */}
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

                  {/* En celular responder también se hace deslizando el mensaje
                      a la derecha; con puntero, este renglón es el único sitio. */}
                  {canReply(message) ? (
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

                  {/* Copiar sale con puntero y en táctil: al lado del globo no
                      hay icono para esto, y el menú del sistema está apagado en
                      el renglón. Un mensaje de solo imagen no tiene qué copiar. */}
                  {message.text ? (
                    <button
                      type="button"
                      className="vibra-msg-menu-item"
                      onClick={() => copyMessage(message)}
                      tabIndex={expanded ? 0 : -1}
                    >
                      <MenuIcon path={ICON_COPY} />
                      {tChat("copy")}
                    </button>
                  ) : null}

                  {/* Editar solo el autor, con texto y dentro de la ventana de
                      10 minutos: pasado ese punto las rules lo rechazan, así que
                      ni se ofrece. Va ANTES de las de eliminar — lo que borra se
                      queda al final, que es donde no se pulsa sin querer. */}
                  {mine && withinWindow && message.text ? (
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

                  {/* Retirar de los dos lados: solo el autor y solo dentro de la
                      misma ventana de 10 minutos. */}
                  {mine && withinWindow ? (
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
    // quién. Desbloquear se hace desde el menú de la cabecera, que es donde
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
          <button className="vibra-pop"
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
            <button className="vibra-pop"
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
    // menú de la cabecera, con el ReportModal compartido del producto.
    return (
      <>
        {/* Acciones de seguridad del hilo, discretas y siempre a la vista. */}
        {/* Bloquear y reportar ya viven en el menú de la cabecera; tenerlos
            también aquí sería la misma acción en dos sitios. */}

        {loading && exists ? (
          <MessageThreadSkeleton />
        ) : (!exists || messages.length === 0) && uploadingVisible.length === 0 ? (
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

            {/* Fotos en camino. Van al final porque es exactamente donde va a
                quedarse el mensaje de verdad, con la misma caja y la misma
                foto: el relevo no mueve nada. */}
            {uploadingVisible.map((foto) => (
              <SendingImageSkeleton
                key={foto.id}
                previewUrl={foto.previewUrl}
                box={imageBox(foto.width, foto.height)}
              />
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

        /* Entrada de un mensaje CON FOTO: se funde y nada más.
           Una foto llega a un hueco que ya estaba reservado y a su tamaño
           definitivo; subirla o escalarla la hace pelearse con ese hueco y
           parece que sale de debajo de él. Fundido en su sitio y ya. */
        .vibra-msg-fade {
          animation: vibraMsgFade var(--duration-normal, 250ms)
            var(--ease-smooth, cubic-bezier(0.4, 0, 0.2, 1)) both;
        }
        @keyframes vibraMsgFade {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .vibra-chat-ph {
            transition: none;
          }
          .vibra-msg-pop,
          .vibra-msg-fade {
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

        /* Acción rápida al lado del globo. Solo se monta donde hay puntero (lo
           decide la prop pointerActions), así que aquí no hay media query.
           El hueco se reserva siempre para que salir del hover no mueva el
           globo de sitio.

           ⚠️ El ancho tiene que dar para lo que hay DENTRO. Con 56 px reservados
           y tres iconos de 26 (responder y editar incluidos) el sobrante se
           salía de la caja por la izquierda y acababa pintado fuera del panel,
           encima de la página. Ahora solo vive aquí el corazón y el hueco es
           justo el suyo. */
        .vibra-msg-actions {
          display: flex;
          flex-shrink: 0;
          align-items: center;
          /* Un pelo más que el botón (26 px), para que respire contra el globo. */
          width: 32px;
          opacity: 0;
          transition: opacity var(--duration-fast, 150ms) ease;
        }
        /* Visibles también mientras el foco esté dentro: si no, tabular hasta
           ellas las apagaría justo al llegar. */
        .vibra-msg-row:hover .vibra-msg-actions,
        .vibra-msg-actions:focus-within,
        /* Con me gusta puesto ya no se esconde: es la marca del mensaje. */
        .vibra-msg-actions[data-on] {
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
          transition: transform var(--duration-fast, 150ms) ease,
            color var(--duration-fast, 150ms) ease;
        }
        /* Sin pastilla gris al pasar el cursor. Un icono suelto sobre el fondo
           del chat no necesita una caja detrás para decir que se puede pulsar:
           ya lo dice que APAREZCA al pasar por el mensaje. El aviso de que estás
           justo encima lo dan el blanco pleno y un pelo de tamaño. */
        .vibra-msg-action:hover {
          color: #fff;
          transform: scale(1.12);
        }

        /* Botón de volver al final. Redondo, sobre el hilo y pegado al lado de
           dentro, para no taparle nada al último mensaje. */
        .vibra-chat-jump {
          position: absolute;
          inset-inline-end: 14px;
          width: 36px;
          height: 36px;
          border-radius: 999px;
          border: none;
          /* Opaco: va por encima de los mensajes y con alfa se leía el texto de
             debajo a través del botón. */
          background: #26262c;
          color: rgba(255, 255, 255, 0.92);
          display: grid;
          place-items: center;
          cursor: pointer;
          box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
          z-index: 3;
          -webkit-tap-highlight-color: transparent;
          /* Apagado: ni se ve ni se puede pulsar. La transición es la MISMA de
             ida y de vuelta, así que aparecer y desaparecer se ven igual. */
          opacity: 0;
          transform: translateY(6px) scale(0.9);
          pointer-events: none;
          transition:
            opacity var(--duration-fast, 150ms) ease,
            transform var(--duration-normal, 250ms)
              var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1));
        }
        .vibra-chat-jump[data-on] {
          opacity: 1;
          transform: translateY(0) scale(1);
          pointer-events: auto;
        }
        @media (hover: hover) {
          .vibra-chat-jump[data-on]:hover {
            background: #303038;
            color: #fff;
          }
        }
        /* Cuántos han entrado mientras estabas arriba. Morado de marca: es un
           aviso, no un adorno del botón. */
        .vibra-chat-jump-badge {
          position: absolute;
          top: -3px;
          inset-inline-end: -3px;
          min-width: 18px;
          height: 18px;
          padding: 0 5px;
          box-sizing: border-box;
          border-radius: 999px;
          background: #a855f7;
          color: #fff;
          font-size: 10.5px;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          line-height: 18px;
          text-align: center;
        }
        @media (prefers-reduced-motion: reduce) {
          .vibra-chat-jump {
            transition: opacity var(--duration-fast, 150ms) ease;
            transform: none;
          }
          .vibra-chat-jump[data-on] {
            transform: none;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .vibra-msg-action {
            transition: color var(--duration-fast, 150ms) ease;
          }
          .vibra-msg-action:hover {
            transform: none;
          }
        }

      `}</style>

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          const abajo =
            el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_TO_BOTTOM_SLACK;
          stickToBottomRef.current = abajo;
          // React descarta el render si el valor no cambió, así que llamar en
          // cada evento de scroll no cuesta nada.
          setAlFinal(abajo);
          if (abajo) setNuevosAbajo(0);
          // Bajar hasta verlo ES leer: aquí sale el recibo que se quedó guardado
          // mientras se estaba arriba. Se pregunta en cada scroll y no solo al
          // cruzar el umbral de "pegado al final", porque un mensaje muy alto se
          // termina de ver ANTES de llegar a ese umbral. Si no hay nada
          // pendiente sale de inmediato, sin medir nada.
          confirmarLecturaPendiente();
          // Lo único que hace falta para que los globos vayan cambiando de color
          // al pasar por la pantalla. Una escritura, sin leer nada del layout.
          el.style.setProperty("--vb-thread-scroll", `${el.scrollTop}px`);
        }}
        // Con el menú abierto, tocar en cualquier otro sitio lo cierra. Sin
        // esto, abierto con pulsación larga, no había forma evidente de salir:
        // el resto está difuminado y no responde.
        onClickCapture={(e) => {
          if (!expandedMessage) return;
          const target = e.target as HTMLElement | null;
          if (target?.closest(".vibra-msg-menu")) return;

          /**
           * ⚠️ El globo que YA tiene el menú abierto se salta, y solo con
           * puntero.
           *
           * Esto corre en fase de CAPTURA, o sea antes que el `onClick` del
           * globo. Cerrando aquí, el `toggleExpanded` que venía detrás se
           * encontraba el menú ya cerrado y lo volvía a abrir — de ahí que
           * volver a pulsar el mensaje no lo cerrara nunca. Dejándolo pasar, lo
           * cierra el propio toggle, que es quien sabe alternar.
           *
           * En táctil NO se salta: allí el menú se abre manteniendo pulsado y
           * el `onClick` del globo no hace nada, así que el único que puede
           * cerrarlo con un toque es este.
           */
          const bubble = bubbleNodes.current.get(expandedMessage.id);
          if (pointerActions && bubble && target && bubble.contains(target)) return;

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
          padding: `${topInset + 10}px 14px ${composerHeight + 10}px`,
        }}
      >
        {renderBody()}
      </div>

      {/* Volver al final del hilo.
          Solo aparece si te has ido a leer historia, y con la cuenta de lo que
          ha entrado mientras tanto. Sin esto, estar arriba era un estado sin
          salida ni aviso: nada te decía que había mensajes nuevos abajo, y
          menos desde que el acuse de lectura exige llegar hasta ellos.

          Va SIEMPRE montado y se enciende con el atributo, para que entre y
          salga con la misma transición. Se coloca sobre el compositor, cuyo
          alto se mide en vivo. */}
      <button
        type="button"
        className="vibra-chat-jump vibra-msg-dimmable"
        data-on={!alFinal ? "" : undefined}
        data-dimmed={expandedMessage ? "" : undefined}
        aria-hidden={alFinal}
        tabIndex={alFinal ? -1 : 0}
        aria-label={tChat("jumpToLatest")}
        title={tChat("jumpToLatest")}
        onClick={() => {
          setNuevosAbajo(0);
          stickToBottomRef.current = true;
          scrollToBottom(true);
        }}
        style={{ bottom: composerHeight + 10 }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M6 10l6 6 6-6" />
        </svg>
        {nuevosAbajo > 0 ? (
          <span className="vibra-chat-jump-badge">
            {nuevosAbajo > 99 ? "99+" : nuevosAbajo}
          </span>
        ) : null}
      </button>

      {/* Superpuesto al hilo, no en su propia fila: así los mensajes se ven
          pasar por detrás al scrollear. El campo lleva desenfoque para seguir
          siendo legible sobre ellos.

          El cristal es el mismo fundido de la cabecera, pero del revés: el
          último mensaje se disuelve al bajar en vez de quedar nítido justo
          detrás del campo. Va DENTRO del contenedor superpuesto, que ya no
          ocupa sitio en el flujo, así que aquí no hay hueco nuevo que
          reservar: el relleno inferior del scroller ya mide el compositor. */}
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
          // El hueco de abajo era SOLO el safe-area, y con el safe-area a cero
          // en toda la plataforma el campo quedaba pegado al canto de la
          // pantalla. Ahora lleva su propio aire y le suma el safe-area si algún
          // día vuelve.
          padding: safeAreaBottom
            ? "10px 14px calc(16px + var(--vb-safe-bottom, 0px))"
            : "12px 14px",
          display: "grid",
          gap: 8,
          pointerEvents: "none",
        }}
      >
        {/* Aquí iba un `BlurFade` que difuminaba la franja de abajo, por detrás
            del campo de escritura. Se quitó por decisión de Luis (2026-09-05):
            en el hilo ensuciaba justo la zona donde están los últimos mensajes,
            que es la que más se mira. El compositor ya se despega bastante con
            su propio fondo, sin necesidad de emborronar lo que hay detrás.

            Si algún día vuelve, que sea con un velo mucho más corto: el problema
            no era el desenfoque en sí, era cuánto subía. */}

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
