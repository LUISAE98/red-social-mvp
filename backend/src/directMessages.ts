/**
 * Trigger de mensajes directos (perfil ↔ perfil; las comunidades no tienen DM).
 *
 * Hace las DOS cosas de una sola invocación, a propósito:
 *  1. Denormaliza el resumen del hilo (`lastMessage`, `lastMessageAt`) e
 *     incrementa el contador de no leídos del destinatario. Estos campos son
 *     territorio exclusivo del backend: las rules impiden que el cliente los
 *     toque, así que nadie puede falsear su propio inbox.
 *  2. Emite la notificación, que el pipeline de `onNotificationWritten` ya
 *     convierte en push.
 *
 * Separar (1) y (2) en dos funciones costaría el doble de invocaciones sin
 * ganar nada: el mismo evento las dispara.
 */

import { onDocumentCreated } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";

import { notifyDirectMessage } from "./notifications";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();
const REGION = "us-central1";

/** Recorte del resumen que se guarda en la conversación para pintar el inbox. */
const PREVIEW_MAX = 200;

export const onDirectMessageCreated = onDocumentCreated(
  {
    document: "conversations/{conversationId}/messages/{messageId}",
    region: REGION,
  },
  async (event) => {
    const message = event.data?.data();
    if (!message) return;

    const senderId = typeof message.senderId === "string" ? message.senderId : null;
    if (!senderId) return;

    const text = typeof message.text === "string" ? message.text : "";
    const { conversationId } = event.params;
    const convRef = db.collection("conversations").doc(conversationId);

    // La transacción es el único punto que puede fallar y provocar un reintento.
    // Como la notificación va DESPUÉS y con su propio catch, un fallo de push
    // nunca reintenta esta escritura: el contador no se dobla.
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(convRef);
      if (!snap.exists) return null;

      const data = snap.data() ?? {};
      const participants: string[] = Array.isArray(data.participants)
        ? data.participants
        : [];
      const recipientId = participants.find((uid) => uid !== senderId) ?? null;

      const createdAt =
        message.createdAt ?? admin.firestore.FieldValue.serverTimestamp();

      tx.update(convRef, {
        lastMessage: {
          text: text.slice(0, PREVIEW_MAX),
          senderId,
          createdAt,
        },
        lastMessageAt: createdAt,
        ...(recipientId
          ? { [`unread.${recipientId}`]: admin.firestore.FieldValue.increment(1) }
          : {}),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return {
        recipientId,
        status: typeof data.status === "string" ? data.status : null,
      };
    });

    if (!result?.recipientId) return;

    // Solo notifica un hilo ACEPTADO. Una solicitud de un desconocido no debe
    // sonar en el teléfono de nadie: se ve al entrar a la bandeja. Y un hilo
    // bloqueado, obviamente, tampoco.
    if (result.status !== "active") return;

    try {
      await notifyDirectMessage({
        recipientId: result.recipientId,
        senderId,
        conversationId,
        preview: text,
      });
    } catch (error) {
      // Un fallo notificando NO debe reintentar el trigger: la conversación ya
      // quedó actualizada y el reintento doblaría el contador de no leídos.
      logger.error("onDirectMessageCreated: fallo al notificar", {
        conversationId,
        error,
      });
    }
  }
);
