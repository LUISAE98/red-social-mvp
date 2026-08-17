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
    const { conversationId, messageId } = event.params;
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

      // ⚠️ B9-alto, carrera del resumen. Antes se reemplazaba `lastMessage` sin
      // mirar nada: si dos mensajes se procesaban fuera de orden —cosa normal,
      // los disparadores no garantizan orden— el inbox se quedaba enseñando el
      // MÁS VIEJO como último mensaje.
      //
      // Solo se pisa el resumen si este mensaje es más nuevo que el que ya está.
      // El contador de no leídos SÍ se incrementa siempre: ese es correcto en
      // cualquier orden, porque cuenta, no reemplaza.
      const anterior = data.lastMessageAt;
      const esMasNuevo =
        !(anterior instanceof admin.firestore.Timestamp) ||
        !(message.createdAt instanceof admin.firestore.Timestamp) ||
        message.createdAt.toMillis() >= anterior.toMillis();

      // ⚠️ Y la idempotencia. Un disparador puede entregarse DOS VECES —es la
      // garantía de Firebase, `at least once`— y sin marca el contador subía dos
      // veces y el push sonaba dos veces por el mismo mensaje.
      const yaProcesados = Array.isArray(data.processedMessageIds)
        ? (data.processedMessageIds as string[])
        : [];
      if (yaProcesados.includes(messageId)) return null;

      const cambios: Record<string, unknown> = {
        // Se guardan los últimos ids vistos, no todos: la lista tiene que caber
        // en el documento y una reentrega llega enseguida, no días después.
        processedMessageIds: [...yaProcesados, messageId].slice(-50),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      if (esMasNuevo) {
        cambios.lastMessage = {
          text: text.slice(0, PREVIEW_MAX),
          senderId,
          createdAt,
          // Un mensaje puede ser solo imagen (texto vacío): el inbox necesita
          // saberlo para no pintar una fila en blanco.
          hasImage: message.image != null,
        };
        cambios.lastMessageAt = createdAt;
      }

      if (recipientId) {
        cambios[`unread.${recipientId}`] = admin.firestore.FieldValue.increment(1);
      }

      tx.update(convRef, cambios);

      return {
        recipientId,
        status: typeof data.status === "string" ? data.status : null,
        // Silenciado por el destinatario: se le sigue guardando el mensaje y el
        // contador de no leídos, pero no se le suena el teléfono.
        muted:
          Array.isArray(data.mutedBy) && recipientId
            ? data.mutedBy.includes(recipientId)
            : false,
      };
    });

    if (!result?.recipientId) return;

    // Solo notifica un hilo ACEPTADO. Una solicitud de un desconocido no debe
    // sonar en el teléfono de nadie: se ve al entrar a la bandeja. Y un hilo
    // bloqueado, obviamente, tampoco.
    if (result.status !== "active") return;

    // Silenciado: el mensaje ya quedó guardado y contado arriba; lo único que se
    // salta es el aviso al teléfono.
    if (result.muted) return;

    try {
      const senderSnap = await db.collection("users").doc(senderId).get();
      const sender = senderSnap.data() ?? {};
      const senderName =
        (typeof sender.displayName === "string" && sender.displayName) ||
        (typeof sender.handle === "string" && sender.handle) ||
        "Alguien";
      const senderAvatar =
        (typeof sender.photoURL === "string" && sender.photoURL) || null;

      // ⚠️ B9-medio. El cuerpo YA NO lleva el mensaje.
      //
      // Antes se mandaban hasta 140 caracteres del texto, y una notificación se
      // lee en la pantalla de bloqueo sin desbloquear el teléfono: cualquiera
      // que pasara al lado leía la conversación. Decisión de producto de Luis
      // (2026-08-16): en el aviso nunca va el contenido.
      //
      // El NOMBRE de quien escribe sí se conserva: sin él la notificación no
      // sirve para decidir si vale la pena mirar, y ese dato ya lo sabe quien ve
      // el teléfono si conoce a la persona.
      void text;

      await sendPushToUser(result.recipientId, {
        title: senderName,
        body: "Nuevo mensaje",
        // Directo al hilo. En celular es la pantalla completa de la
        // conversación; en laptop, la propia página del hilo.
        link: `/mensajes/${conversationId}`,
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
