import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit as fsLimit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from "firebase/firestore";

import { db } from "@/lib/firebase";
import { captureError } from "@/lib/observability/captureError";
import {
  CONVERSATION_PAGE_SIZE,
  INBOX_PAGE_SIZE,
  MESSAGE_MAX_LENGTH,
  buildParticipantsKey,
  type ConversationDoc,
  type ConversationStatus,
  type MessageDoc,
} from "./types";

/**
 * Capa de datos del DM (perfil ↔ perfil; las comunidades no tienen mensajería).
 *
 * Control de costo — las tres reglas que no se rompen aquí:
 *  1. El inbox lee SOLO docs de `conversations` (≤20), nunca subcolecciones.
 *  2. El hilo mantiene UN listener acotado a la última página. Las páginas
 *     antiguas se traen con `getDocs` de una sola vez y NO quedan suscritas:
 *     abrir una conversación de 5000 mensajes cuesta 30 lecturas, no 5000.
 *  3. El recibo de lectura es un único write por apertura (`lastReadAt.<uid>`),
 *     no un campo por mensaje. Y no existe indicador de "escribiendo…".
 */

export type ConversationWithId = ConversationDoc & { id: string };
export type MessageWithId = MessageDoc & { id: string };

function conversationsCol() {
  return collection(db, "conversations");
}

function messagesCol(conversationId: string) {
  return collection(db, "conversations", conversationId, "messages");
}

function conversationRef(conversationId: string) {
  return doc(db, "conversations", conversationId);
}

/**
 * ¿El destinatario me sigue?
 *
 * Las rules exigen que el `status` inicial sea "active" solo si el destinatario
 * sigue al emisor. Ese dato lo comprueban en `users/{otro}/following/{yo}`, que
 * el cliente NO puede leer (solo su dueño). Pero sí puede leer su propio espejo
 * `users/{yo}/followers/{otro}`, y ambos se mantienen sincronizados por las
 * propias rules (`existsAfter` cruzado al seguir/dejar de seguir).
 */
async function isFollowedBy(selfUid: string, otherUid: string): Promise<boolean> {
  const snap = await getDoc(doc(db, "users", selfUid, "followers", otherUid));
  return snap.exists();
}

/**
 * Abre (o recupera) la conversación con otra persona.
 *
 * Devuelve el ID determinista. Si ya existía, no escribe nada. El estado inicial
 * lo decide el follow, no quien llama: las rules rechazan cualquier otro valor,
 * así que no hay forma de colarse en la bandeja principal de un desconocido.
 */
export async function openConversation(
  selfUid: string,
  otherUid: string
): Promise<string> {
  if (!selfUid || !otherUid) {
    throw new Error("Falta el identificador de alguno de los participantes.");
  }
  if (selfUid === otherUid) {
    throw new Error("No puedes abrir una conversación contigo mismo.");
  }

  const conversationId = buildParticipantsKey(selfUid, otherUid);
  const ref = conversationRef(conversationId);

  const existing = await getDoc(ref);
  if (existing.exists()) return conversationId;

  const [first, second] = [selfUid, otherUid].sort();
  const status: ConversationStatus = (await isFollowedBy(selfUid, otherUid))
    ? "active"
    : "request";

  await setDoc(ref, {
    participants: [first, second],
    participantsKey: conversationId,
    status,
    createdBy: selfUid,
    lastMessage: null,
    lastMessageAt: null,
    blockedBy: null,
    unread: {},
    lastReadAt: {},
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return conversationId;
}

/** Envía un mensaje de texto. `lastMessage`/`unread` los actualiza la Cloud Function. */
export async function sendMessage(
  conversationId: string,
  senderId: string,
  text: string
): Promise<void> {
  const body = text.trim();

  if (!body) {
    throw new Error("El mensaje está vacío.");
  }
  if (body.length > MESSAGE_MAX_LENGTH) {
    throw new Error(`El mensaje no puede superar ${MESSAGE_MAX_LENGTH} caracteres.`);
  }

  await addDoc(messagesCol(conversationId), {
    senderId,
    text: body,
    createdAt: serverTimestamp(),
    isDeleted: false,
  });
}

/** Borrado suave del mensaje propio. El texto es inmutable. */
export async function deleteMessage(
  conversationId: string,
  messageId: string
): Promise<void> {
  await updateDoc(doc(db, "conversations", conversationId, "messages", messageId), {
    isDeleted: true,
  });
}

/**
 * Marca el hilo como leído: un solo write, no uno por mensaje.
 * Se llama al abrir la conversación y al llegar mensajes con la vista abierta.
 */
export async function markConversationRead(
  conversationId: string,
  selfUid: string
): Promise<void> {
  try {
    await updateDoc(conversationRef(conversationId), {
      [`lastReadAt.${selfUid}`]: serverTimestamp(),
      [`unread.${selfUid}`]: 0,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    // No es crítico: fallar al marcar leído no debe romper la vista del hilo.
    captureError(error, { scope: "chat", code: "mark_read_failed" });
  }
}

/** Bloquea el hilo. Solo quien bloquea puede después desbloquearlo. */
export async function blockConversation(
  conversationId: string,
  selfUid: string
): Promise<void> {
  await updateDoc(conversationRef(conversationId), {
    status: "blocked",
    blockedBy: selfUid,
    updatedAt: serverTimestamp(),
  });
}

/** Desbloquea. Las rules rechazan esto si no fuiste tú quien bloqueó. */
export async function unblockConversation(conversationId: string): Promise<void> {
  await updateDoc(conversationRef(conversationId), {
    status: "active",
    blockedBy: null,
    updatedAt: serverTimestamp(),
  });
}

/** Acepta una solicitud: el hilo pasa a la bandeja principal. */
export async function acceptConversationRequest(
  conversationId: string
): Promise<void> {
  await updateDoc(conversationRef(conversationId), {
    status: "active",
    updatedAt: serverTimestamp(),
  });
}

function toConversation(
  snap: QueryDocumentSnapshot<DocumentData>
): ConversationWithId {
  return { id: snap.id, ...(snap.data() as ConversationDoc) };
}

/**
 * Suscripción al inbox. `statuses` separa la bandeja principal de Solicitudes,
 * para que un aluvión de solicitudes no desplace las conversaciones reales.
 */
export function subscribeToInbox(
  selfUid: string,
  statuses: ConversationStatus[],
  onData: (conversations: ConversationWithId[]) => void,
  onError?: (error: Error) => void,
  pageSize = INBOX_PAGE_SIZE
): Unsubscribe {
  const q = query(
    conversationsCol(),
    where("participants", "array-contains", selfUid),
    where("status", "in", statuses),
    orderBy("lastMessageAt", "desc"),
    fsLimit(pageSize)
  );

  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map(toConversation)),
    (err) => {
      captureError(err, { scope: "chat", code: "inbox_subscribe_failed" });
      onError?.(err);
    }
  );
}

/**
 * Suscripción a la ÚLTIMA página del hilo. Se consulta en orden descendente
 * (los más nuevos primero) para que el listener quede acotado a `pageSize`
 * documentos por muy larga que sea la conversación; se invierte en memoria para
 * pintarlos en orden de lectura.
 */
export function subscribeToConversation(
  conversationId: string,
  onData: (messages: MessageWithId[]) => void,
  onError?: (error: Error) => void,
  pageSize = CONVERSATION_PAGE_SIZE
): Unsubscribe {
  const q = query(
    messagesCol(conversationId),
    orderBy("createdAt", "desc"),
    fsLimit(pageSize)
  );

  return onSnapshot(
    q,
    (snap) => {
      const messages = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as MessageDoc) }))
        .reverse();
      onData(messages);
    },
    (err) => {
      captureError(err, { scope: "chat", code: "conversation_subscribe_failed" });
      onError?.(err);
    }
  );
}

/**
 * Trae la página anterior a `oldestCreatedAt`. Lectura de una sola vez a
 * propósito: el historial antiguo no cambia, así que suscribirse a él sería
 * pagar para siempre por datos inmutables.
 */
export async function fetchOlderMessages(
  conversationId: string,
  oldestCreatedAt: unknown,
  pageSize = CONVERSATION_PAGE_SIZE
): Promise<MessageWithId[]> {
  if (!oldestCreatedAt) return [];

  const q = query(
    messagesCol(conversationId),
    orderBy("createdAt", "desc"),
    startAfter(oldestCreatedAt),
    fsLimit(pageSize)
  );

  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as MessageDoc) })).reverse();
}
