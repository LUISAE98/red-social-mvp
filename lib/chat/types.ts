import type { Timestamp } from "firebase/firestore";

/**
 * Mensajes directos (DM) 1-a-1 entre PERFILES.
 *
 * Alcance deliberado (ver plan del DM):
 *  - Solo perfil ↔ perfil. Las comunidades NO reciben mensajes.
 *  - Solo texto. Sin media, sin grupos.
 *  - Las cuentas anónimas (invitados de compra sin login) no pueden escribir.
 *
 * El modelo está diseñado para que el costo de Firestore no se dispare. Tres
 * decisiones lo fuerzan estructuralmente:
 *
 *  1. NO existe campo de "escribiendo…". Un indicador de tecleo es una escritura
 *     por pulsación; multiplica la factura por varias veces y no aporta nada
 *     imprescindible. Si algún día se quiere, va en Realtime Database.
 *  2. El inbox lee SOLO docs de `conversations` (≤20), nunca subcolecciones. Por
 *     eso `lastMessage` va denormalizado aquí. Nunca escuchar una colección de
 *     mensajes completa para contar: es el patrón caro que ya existe en el chat
 *     de lives (`subscribeToTotalChatMessages`) y que aquí no se replica.
 *  3. El recibo de lectura es AGREGADO: un `lastReadAt` por participante, no un
 *     campo por mensaje.
 */

/** Quién puede abrir una conversación conmigo. Ausente ⇒ `DEFAULT_MESSAGE_POLICY`. */
export type MessagePolicy =
  /** Cualquiera. Quien yo no siga cae en la bandeja de Solicitudes. */
  | "everyone"
  /** Solo las personas que YO sigo. El resto ni siquiera puede abrir el hilo. */
  | "following"
  /** Las que yo sigo y, además, las que me siguen a mí. */
  | "following_and_followers"
  /** Nadie. Bandeja cerrada. */
  | "none";

/**
 * Predeterminado de la plataforma: solo quien yo sigo.
 *
 * Es deliberadamente conservador — una bandeja abierta de par en par por defecto
 * convierte el DM en un canal de spam para quien nunca entró a configurarlo.
 * Quien quiera abrirla lo hace en un clic.
 */
export const DEFAULT_MESSAGE_POLICY: MessagePolicy = "following";

// El orden es el del selector: de más abierto a más cerrado.
export const MESSAGE_POLICIES: readonly MessagePolicy[] = [
  "everyone",
  "following_and_followers",
  "following",
  "none",
] as const;

export function isMessagePolicy(value: unknown): value is MessagePolicy {
  return (
    typeof value === "string" &&
    (MESSAGE_POLICIES as readonly string[]).includes(value)
  );
}

/**
 * Estado de la conversación.
 *  - "request": la abrió alguien a quien el destinatario NO sigue. Vive en la
 *    bandeja de Solicitudes y no genera notificación push.
 *  - "active" : aceptada (o abierta por alguien a quien el destinatario sigue).
 *  - "blocked": bloqueada por alguno de los dos. Nadie puede escribir.
 */
export type ConversationStatus = "active" | "request" | "blocked";

/** Resumen del último mensaje, denormalizado para pintar el inbox sin leer la subcolección. */
export type ConversationLastMessage = {
  text: string;
  senderId: string;
  createdAt: Timestamp;
  /**
   * El último mensaje llevaba imagen. Sin esto, un mensaje solo-imagen (texto
   * vacío) dejaría la fila del inbox en blanco.
   */
  hasImage?: boolean;
};

export type ConversationDoc = {
  /** Los dos UIDs. `array-contains` resuelve el inbox en una sola query. */
  participants: [string, string];
  /**
   * UIDs ordenados alfabéticamente y unidos por "_". Es el ID del documento:
   * hace imposible crear dos conversaciones para el mismo par de personas.
   */
  participantsKey: string;
  status: ConversationStatus;
  /** Quién abrió la conversación. Define quién espera aceptación en "request". */
  createdBy: string;
  /**
   * Quién bloqueó, cuando `status === "blocked"`. Solo esa persona puede
   * desbloquear: sin este campo, el bloqueado se desbloquearía a sí mismo.
   */
  blockedBy: string | null;
  /**
   * ID del primer mensaje, escrito en el mismo lote que este documento.
   *
   * Un hilo nunca nace vacío. Esto es lo que permite a las rules limitar una
   * solicitud a UN solo mensaje mientras no la acepten: no saben contar
   * documentos, pero sí comprobar que el mensaje que se intenta escribir es
   * justo este.
   */
  firstMessageId: string;
  /** Lo escribe la Cloud Function, nunca el cliente. */
  lastMessage: ConversationLastMessage | null;
  /** Orden del inbox. Lo escribe la Cloud Function. */
  lastMessageAt: Timestamp | null;
  /** No leídos por UID. Lo incrementa la Cloud Function; el dueño lo pone a 0. */
  unread: Record<string, number>;
  /** Recibo de lectura agregado, por UID. Un solo write al abrir el hilo. */
  lastReadAt: Record<string, Timestamp>;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

/**
 * Imagen adjunta a un mensaje. UNA por mensaje.
 *
 * Mismos campos que la imagen de comentarios (misma maquinaria de subida), pero
 * declarada aquí para que el contrato del DM no dependa del dominio de posts.
 */
export type ChatImage = {
  /** Ruta en Storage del original. Se abre al tocar la miniatura. */
  path: string;
  /** Ruta en Storage de la miniatura, que es lo que se pinta en el globo. */
  thumbnailPath: string;
  width?: number;
  height?: number;
  /**
   * URLs permanentes de los primeros mensajes, anteriores al modelo firmado.
   * NO se escriben más: hoy la URL la firma (y la caduca) la Cloud Function
   * `getDirectMessageImageUrls`. Se conservan para que esos mensajes se sigan
   * viendo.
   */
  url?: string;
  thumbnailUrl?: string;
};

export type MessageDoc = {
  senderId: string;
  /** Puede ir vacío si el mensaje lleva imagen. */
  text: string;
  /** Una imagen como mucho; null si el mensaje es solo texto. */
  image?: ChatImage | null;
  createdAt: Timestamp;
  /** Borrado suave: el doc se conserva, el texto deja de mostrarse. */
  isDeleted: boolean;
};

/** Límites del hilo y del inbox. Son también el control de costo. */
export const MESSAGE_MAX_LENGTH = 2000;
/** Mensajes que se traen al abrir un hilo; el resto se pagina hacia atrás. */
export const CONVERSATION_PAGE_SIZE = 30;
/** Conversaciones visibles en el inbox sin paginar. */
export const INBOX_PAGE_SIZE = 20;

/**
 * ID determinista de la conversación entre dos personas. Ordena los UIDs para
 * que ambos lados calculen exactamente el mismo ID y no se dupliquen hilos.
 */
export function buildParticipantsKey(uidA: string, uidB: string): string {
  return [uidA, uidB].sort().join("_");
}

/** El otro participante de la conversación, visto desde `selfUid`. */
export function getOtherParticipant(
  participants: readonly string[],
  selfUid: string
): string | null {
  return participants.find((uid) => uid !== selfUid) ?? null;
}
