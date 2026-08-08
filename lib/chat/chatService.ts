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
  startAfter,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from "firebase/firestore";

import { db } from "@/lib/firebase";
import { captureError } from "@/lib/observability/captureError";
import { submitReport } from "@/lib/moderation/reportService";
import type { ReportReason } from "@/lib/moderation/types";
import {
  CONVERSATION_PAGE_SIZE,
  DEFAULT_MESSAGE_POLICY,
  INBOX_PAGE_SIZE,
  MESSAGE_MAX_LENGTH,
  buildParticipantsKey,
  isMessagePolicy,
  type ChatImage,
  type ConversationDoc,
  type ConversationStatus,
  type MessageDoc,
  type MessagePolicy,
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

/** Política de recepción del destinatario. `users/{uid}` es de lectura pública. */
async function getRecipientPolicy(otherUid: string): Promise<MessagePolicy> {
  const snap = await getDoc(doc(db, "users", otherUid));
  const value = snap.data()?.messagePolicy;
  return isMessagePolicy(value) ? value : DEFAULT_MESSAGE_POLICY;
}

/** ID determinista de la conversación con otra persona. No escribe nada. */
export function getConversationId(selfUid: string, otherUid: string): string {
  return buildParticipantsKey(selfUid, otherUid);
}

/** ¿Existe ya el hilo? Sirve para decidir entre crearlo o solo escribir en él. */
export async function conversationExists(conversationId: string): Promise<boolean> {
  const snap = await getDoc(conversationRef(conversationId));
  return snap.exists();
}

/**
 * Crea la conversación JUNTO A su primer mensaje, en un solo lote atómico.
 *
 * Un hilo nunca nace vacío, y por eso las rules pueden limitar una solicitud a
 * un único mensaje: comprueban que el mensaje escrito es exactamente el
 * declarado en `firstMessageId`. Si el lote falla, no queda ni conversación
 * huérfana ni mensaje suelto.
 *
 * El estado inicial lo decide el follow, no quien llama: las rules rechazan
 * cualquier otro valor, así que no hay forma de colarse en la bandeja principal
 * de un desconocido.
 */
export async function createConversationWithFirstMessage(
  selfUid: string,
  otherUid: string,
  text: string,
  image?: ChatImage | null
): Promise<string> {
  if (!selfUid || !otherUid) {
    throw new Error("Falta el identificador de alguno de los participantes.");
  }
  if (selfUid === otherUid) {
    throw new Error("No puedes abrir una conversación contigo mismo.");
  }

  const body = text.trim();
  if (!body && !image) {
    throw new Error("El mensaje está vacío.");
  }
  if (body.length > MESSAGE_MAX_LENGTH) {
    throw new Error(`El mensaje no puede superar ${MESSAGE_MAX_LENGTH} caracteres.`);
  }

  const conversationId = buildParticipantsKey(selfUid, otherUid);
  const [first, second] = [selfUid, otherUid].sort();

  // Solicitudes existe SOLO para la política "everyone" — la única que deja
  // escribir a un desconocido. Con las demás, quien no cumple la relación ni
  // siquiera ve el botón, así que lo que llega aquí entra directo. Las rules
  // recalculan esto por su cuenta y rechazan cualquier otro valor.
  const [recipientFollowsMe, policy] = await Promise.all([
    isFollowedBy(selfUid, otherUid),
    getRecipientPolicy(otherUid),
  ]);
  const status: ConversationStatus =
    policy === "everyone" && !recipientFollowsMe ? "request" : "active";

  // ID generado en cliente para poder declararlo en la conversación ANTES de
  // que exista el mensaje; es lo que ata ambos documentos en el mismo lote.
  const messageRef = doc(messagesCol(conversationId));

  const batch = writeBatch(db);

  batch.set(conversationRef(conversationId), {
    participants: [first, second],
    participantsKey: conversationId,
    status,
    createdBy: selfUid,
    lastMessage: null,
    lastMessageAt: null,
    blockedBy: null,
    unread: {},
    lastReadAt: {},
    firstMessageId: messageRef.id,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(messageRef, {
    senderId: selfUid,
    text: body,
    ...(image ? { image } : {}),
    createdAt: serverTimestamp(),
    isDeleted: false,
  });

  await batch.commit();

  return conversationId;
}

/**
 * Envía un mensaje. `lastMessage`/`unread` los actualiza la Cloud Function.
 *
 * Puede llevar UNA imagen. Con imagen, el texto es opcional (pie de foto).
 */
export async function sendMessage(
  conversationId: string,
  senderId: string,
  text: string,
  image?: ChatImage | null
): Promise<void> {
  const body = text.trim();

  if (!body && !image) {
    throw new Error("El mensaje está vacío.");
  }
  if (body.length > MESSAGE_MAX_LENGTH) {
    throw new Error(`El mensaje no puede superar ${MESSAGE_MAX_LENGTH} caracteres.`);
  }

  await addDoc(messagesCol(conversationId), {
    senderId,
    text: body,
    // Solo se escribe la clave si hay imagen: las rules limitan los campos y un
    // `image: undefined` viajaría como null innecesario.
    ...(image ? { image } : {}),
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

/**
 * Rechaza una solicitud. Es un bloqueo, no un borrado: el hilo se conserva para
 * que quede rastro de lo que se escribió si más tarde hay un reporte, y quien
 * lo mandó no recibe ninguna señal de haber sido rechazado.
 */
export async function rejectConversationRequest(
  conversationId: string,
  selfUid: string
): Promise<void> {
  await blockConversation(conversationId, selfUid);
}

/**
 * Reporta el hilo completo a moderación.
 *
 * Va por la callable `submitReport` (Admin SDK), igual que el resto de reportes
 * del producto: el cliente nunca escribe en `reports` directamente.
 */
export async function reportConversation(params: {
  conversationId: string;
  reportedUid: string;
  reason: ReportReason;
  description?: string;
}): Promise<void> {
  await submitReport({
    targetType: "conversation",
    targetId: params.conversationId,
    targetOwnerId: params.reportedUid,
    reason: params.reason,
    ...(params.description ? { description: params.description } : {}),
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
