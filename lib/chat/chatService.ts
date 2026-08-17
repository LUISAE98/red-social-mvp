import {
  addDoc,
  arrayRemove,
  arrayUnion,
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
  type Timestamp,
  type Unsubscribe,
} from "firebase/firestore";

import { db } from "@/lib/firebase";
import { prepararFreno, aplicarFreno } from "@/lib/rateLimit/frenoEnLote";
import { captureError } from "@/lib/observability/captureError";
import { submitReport } from "@/lib/moderation/reportService";
import type { ReportReason } from "@/lib/moderation/types";
import {
  CONVERSATION_PAGE_SIZE,
  DEFAULT_MESSAGE_POLICY,
  INBOX_PAGE_SIZE,
  MESSAGE_MAX_LENGTH,
  REPLY_PREVIEW_MAX_LENGTH,
  buildParticipantsKey,
  isMessagePolicy,
  type ChatImage,
  type ConversationDoc,
  type ConversationStatus,
  type MessageDoc,
  type MessagePolicy,
  type MessageReply,
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

  // ⚠️ B9-alto. El primer mensaje pasa por la misma regla que los demás, así que
  // también necesita el contador del freno en este lote.
  const freno = await prepararFreno(selfUid, "dm");

  const batch = writeBatch(db);

  aplicarFreno(batch, freno);

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
 * Extracto que se guarda dentro de la respuesta a partir del mensaje citado.
 *
 * Un mensaje ya retirado no se puede citar: quedaría una cita de "Se eliminó
 * este mensaje", que no dice nada.
 */
export function buildReplyPreview(message: MessageWithId): MessageReply | null {
  if (message.isDeleted) return null;

  return {
    messageId: message.id,
    senderId: message.senderId,
    text: message.text.slice(0, REPLY_PREVIEW_MAX_LENGTH),
    ...(message.image ? { hasImage: true } : {}),
  };
}

/**
 * Envía un mensaje. `lastMessage`/`unread` los actualiza la Cloud Function.
 *
 * Puede llevar UNA imagen. Con imagen, el texto es opcional (pie de foto).
 * `replyTo` lleva el extracto ya construido con `buildReplyPreview`.
 */
export async function sendMessage(
  conversationId: string,
  senderId: string,
  text: string,
  image?: ChatImage | null,
  replyTo?: MessageReply | null
): Promise<void> {
  const body = text.trim();

  if (!body && !image) {
    throw new Error("El mensaje está vacío.");
  }
  if (body.length > MESSAGE_MAX_LENGTH) {
    throw new Error(`El mensaje no puede superar ${MESSAGE_MAX_LENGTH} caracteres.`);
  }

  // ⚠️ B9-alto. El mensaje y su contador de freno van en el MISMO lote atómico.
  //
  // Ni los mensajes ni las solicitudes tenían freno ninguno: un participante de
  // un hilo activo podía generar mensajes, disparadores y avisos sin límite, y
  // con política `everyone` se podía montar una campaña contra mucha gente.
  //
  // La regla `canCreate` del mensaje lo exige con `getAfter`: sin contador no hay
  // mensaje. 1 s entre mensajes, 300 por hora.
  const freno = await prepararFreno(senderId, "dm");

  const lote = writeBatch(db);
  const mensajeRef = doc(messagesCol(conversationId));

  lote.set(mensajeRef, {
    senderId,
    text: body,
    // Solo se escribe la clave si hay imagen: las rules limitan los campos y un
    // `image: undefined` viajaría como null innecesario. Igual con la cita.
    ...(image ? { image } : {}),
    ...(replyTo
      ? {
          replyTo: {
            messageId: replyTo.messageId,
            senderId: replyTo.senderId,
            text: replyTo.text.slice(0, REPLY_PREVIEW_MAX_LENGTH),
            ...(replyTo.hasImage ? { hasImage: true } : {}),
          },
        }
      : {}),
    createdAt: serverTimestamp(),
    isDeleted: false,
  });

  aplicarFreno(lote, freno);

  await lote.commit();
}

function messageRef(conversationId: string, messageId: string) {
  return doc(db, "conversations", conversationId, "messages", messageId);
}

/**
 * Pone o quita TU corazón en un mensaje.
 *
 * Vale en los dos sentidos y sin ventana de tiempo: un corazón no reescribe lo
 * dicho, así que no necesita el límite de 10 minutos que sí tienen editar y
 * retirar. `arrayUnion`/`arrayRemove` lo hacen idempotente — tocar dos veces
 * rápido no deja el mensaje con dos corazones tuyos ni con ninguno de más.
 */
export async function setMessageLike(
  conversationId: string,
  messageId: string,
  selfUid: string,
  liked: boolean
): Promise<void> {
  await updateDoc(messageRef(conversationId, messageId), {
    likedBy: liked ? arrayUnion(selfUid) : arrayRemove(selfUid),
  });
}

/**
 * Oculta el mensaje SOLO para quien lo pide. El otro lo sigue viendo.
 * Sin límite de tiempo y disponible para cualquiera de los dos.
 */
export async function hideMessageForMe(
  conversationId: string,
  messageId: string,
  selfUid: string
): Promise<void> {
  await updateDoc(messageRef(conversationId, messageId), {
    deletedFor: arrayUnion(selfUid),
  });
}

/**
 * Retira el mensaje para los DOS. Solo el autor y dentro de los 10 minutos;
 * las rules rechazan lo demás.
 */
export async function deleteMessageForEveryone(
  conversationId: string,
  messageId: string
): Promise<void> {
  await updateDoc(messageRef(conversationId, messageId), { isDeleted: true });
}

/**
 * Reescribe el texto. Solo el autor y dentro de los 10 minutos. Marca
 * `editedAt` siempre: la edición se muestra, no se disimula.
 */
export async function editMessage(
  conversationId: string,
  messageId: string,
  text: string
): Promise<void> {
  const body = text.trim();
  if (body.length > MESSAGE_MAX_LENGTH) {
    throw new Error(`El mensaje no puede superar ${MESSAGE_MAX_LENGTH} caracteres.`);
  }

  await updateDoc(messageRef(conversationId, messageId), {
    text: body,
    editedAt: serverTimestamp(),
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

/**
 * Silencia o reactiva los avisos de un hilo, solo para ti.
 *
 * Silenciar apaga el push; no deja de recibir mensajes ni oculta el hilo. Lo lee
 * la Cloud Function antes de notificar.
 */
export async function setConversationMuted(
  conversationId: string,
  selfUid: string,
  muted: boolean
): Promise<void> {
  await updateDoc(conversationRef(conversationId), {
    mutedBy: muted ? arrayUnion(selfUid) : arrayRemove(selfUid),
    updatedAt: serverTimestamp(),
  });
}

/**
 * Quita la conversación de TU bandeja.
 *
 * No borra el hilo — las rules lo prohíben a propósito, para que nadie pueda
 * hacer desaparecer lo que escribió. Solo se marca desde cuándo dejas de verla:
 * si esa persona vuelve a escribir, reaparece con el mensaje nuevo.
 */
export async function hideConversationForMe(
  conversationId: string,
  selfUid: string
): Promise<void> {
  await updateDoc(conversationRef(conversationId), {
    [`hiddenAt.${selfUid}`]: serverTimestamp(),
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

/**
 * Pone el hilo de DM de acuerdo con el bloqueo de PERFIL.
 *
 * El bloqueo vive en dos sitios: la relación entre perfiles, que es la canónica
 * y la que ve todo el producto, y el estado del hilo, que es lo que miran las
 * rules para dejar escribir o no. Mantenerlos a mano desde cada pantalla no
 * funcionó: al desbloquear desde la página del perfil, el hilo se quedaba en
 * "blocked" para siempre y no había forma de volver a escribir.
 *
 * Por eso esto se llama desde `useSocialRelationship`, que es por donde pasan
 * TODOS los bloqueos del producto, y no desde cada sitio que pinta un botón.
 *
 * El ID del hilo es determinista a partir de los dos UIDs, así que no hace falta
 * saber si la conversación está abierta ni tenerla a mano.
 */
export async function syncConversationBlock(
  selfUid: string,
  otherUid: string,
  blocked: boolean
): Promise<void> {
  try {
    const conversationId = buildParticipantsKey(selfUid, otherUid);
    const snapshot = await getDoc(conversationRef(conversationId));
    // Sin hilo no hay nada que sincronizar: cuando se cree, nacerá coherente.
    if (!snapshot.exists()) return;

    const data = snapshot.data() as ConversationDoc;

    if (blocked) {
      if (data.status === "blocked") return;
      await blockConversation(conversationId, selfUid);
      return;
    }

    // Solo se deshace TU bloqueo. Si quien bloqueó fue el otro, su bloqueo sigue
    // en pie y las rules rechazarían el cambio de todas formas.
    if (data.status !== "blocked" || data.blockedBy !== selfUid) return;
    await unblockConversation(conversationId);
  } catch (error) {
    // No debe tumbar el bloqueo de perfil, que es la acción que pidió la
    // persona; pero sí hay que enterarse, porque deja el hilo descuadrado.
    captureError(error, { scope: "chat", code: "sync_conversation_block_failed" });
  }
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
 * Conversaciones ANTERIORES a las que ya están en la bandeja.
 *
 * El listener en vivo se queda acotado a la primera página, como el del hilo:
 * el historial se trae de una sola vez y NO queda suscrito. Así una bandeja de
 * doscientas conversaciones no multiplica el costo del listener.
 *
 * `before` es el `lastMessageAt` de la conversación más antigua ya cargada.
 */
export async function fetchOlderConversations(params: {
  selfUid: string;
  statuses: ConversationStatus[];
  before: Timestamp;
  pageSize?: number;
}): Promise<{ conversations: ConversationWithId[]; hasMore: boolean }> {
  const pageSize = params.pageSize ?? INBOX_PAGE_SIZE;

  const snap = await getDocs(
    query(
      conversationsCol(),
      where("participants", "array-contains", params.selfUid),
      where("status", "in", params.statuses),
      orderBy("lastMessageAt", "desc"),
      startAfter(params.before),
      fsLimit(pageSize)
    )
  );

  return {
    conversations: snap.docs.map(toConversation),
    hasMore: snap.docs.length === pageSize,
  };
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
