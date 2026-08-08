/**
 * Trigger de mensajes directos (perfil ↔ perfil; las comunidades no tienen DM).
 *
 * Hace las DOS cosas de una sola invocación, a propósito:
 *  1. Denormaliza el resumen del hilo (`lastMessage`, `lastMessageAt`) e
 *     incrementa el contador de no leídos del destinatario. Estos campos son
 *     territorio exclusivo del backend: las rules impiden que el cliente los
 *     toque, así que nadie puede falsear su propio inbox.
 *  2. Envía el push al dispositivo.
 *
 * Separar (1) y (2) en dos funciones costaría el doble de invocaciones sin
 * ganar nada: el mismo evento las dispara.
 *
 * OJO — el push va DIRECTO, sin crear doc en `users/{uid}/notifications`: un
 * mensaje directo NO aparece en la campanita. Su bandeja es la pestaña de
 * Mensajes (con su propio contador de no leídos), y duplicarlo en la campanita
 * sería ruido para algo que ya tiene su sitio.
 */

import { onDocumentCreated } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";

import { sendPushToUser } from "./push";

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
      const senderSnap = await db.collection("users").doc(senderId).get();
      const sender = senderSnap.data() ?? {};
      const senderName =
        (typeof sender.displayName === "string" && sender.displayName) ||
        (typeof sender.handle === "string" && sender.handle) ||
        "Alguien";
      const senderAvatar =
        (typeof sender.photoURL === "string" && sender.photoURL) || null;

      await sendPushToUser(result.recipientId, {
        title: senderName,
        // El propio mensaje como cuerpo: es lo que se espera ver en la pantalla
        // de bloqueo.
        body: text.slice(0, 140) || "te envió un mensaje",
        // `/groups` monta el OwnerSidebar completo; `dm` abre ese hilo.
        link: `/groups?dm=${conversationId}`,
        // Mensajes seguidos del mismo hilo se colapsan en un solo aviso.
        tag: `dm_${conversationId}`,
        icon: senderAvatar,
      });
    } catch (error) {
      // Un fallo notificando NO debe reintentar el trigger: la conversación ya
      // quedó actualizada y el reintento doblaría el contador de no leídos.
      logger.error("onDirectMessageCreated: fallo al enviar el push", {
        conversationId,
        error,
      });
    }
  }
);
