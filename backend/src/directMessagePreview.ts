/**
 * Mantiene al día la vista previa del inbox cuando el último mensaje cambia.
 *
 * `conversations/{id}.lastMessage` se escribe al CREAR un mensaje, y hasta ahora
 * nadie la volvía a tocar. Así que editar o retirar el último mensaje dejaba la
 * bandeja mostrando el texto viejo — incluido el caso feo: retiras un mensaje y
 * la frase que querías quitar se sigue leyendo en la lista de conversaciones.
 *
 * En vez de intentar adivinar si el mensaje editado ERA el último, se relee cuál
 * es el último ahora y se reescribe el resumen. Sale más barato de razonar y
 * cubre solo, sin casos especiales, el caso de que se retire.
 */

import { getFirestore } from "firebase-admin/firestore";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";

const db = getFirestore();
const REGION = "us-central1";

/** Mismo tope que usa el trigger de creación al recortar el resumen. */
// ⚠️ B9-bajo. Era 140 mientras el resumen INICIAL se guardaba con 200
// (`PREVIEW_MAX` en `directMessages.ts`), así que editar un mensaje le RECORTABA el
// resumen del inbox sin que nadie hubiera cambiado el texto. El mismo valor en
// los dos sitios; si cambia, cambia en los dos.
const PREVIEW_MAX = 200;

export const onDirectMessageChangedUpdatePreview = onDocumentUpdated(
  { document: "conversations/{convId}/messages/{messageId}", region: REGION, retry: true },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;

    // Solo lo que se VE en la bandeja. `deletedFor` y `likedBy` cambian por
    // persona y no deben mover el resumen, que es común a los dos.
    const textChanged = before.text !== after.text;
    const deletionChanged = before.isDeleted !== after.isDeleted;
    if (!textChanged && !deletionChanged) return;

    const convRef = db.collection("conversations").doc(event.params.convId);

    try {
      const latestSnap = await convRef
        .collection("messages")
        .orderBy("createdAt", "desc")
        .limit(1)
        .get();

      const latest = latestSnap.docs[0];
      if (!latest) return;

      // El mensaje que cambió no era el último: la bandeja no enseña ese.
      if (latest.id !== event.params.messageId) return;

      const data = latest.data();
      const isDeleted = data.isDeleted === true;
      const text = typeof data.text === "string" ? data.text : "";

      await convRef.update({
        lastMessage: {
          // De un mensaje retirado no se guarda el texto: la bandeja lo
          // anuncia con su propia frase, en el idioma de quien mira.
          text: isDeleted ? "" : text.slice(0, PREVIEW_MAX),
          senderId: data.senderId,
          createdAt: data.createdAt,
          hasImage: !isDeleted && data.image != null,
          isDeleted,
        },
      });
    } catch (error) {
      // ⚠️ B9-bajo. Antes esto solo se registraba y ahí moría: si fallaba, el
      // inbox se quedaba enseñando para siempre el texto viejo de un mensaje
      // editado, o el contenido de uno RETIRADO. Con `retry: true` Firebase lo
      // reintenta con espera creciente y acaba rindiéndose, que es mejor que no
      // intentarlo nunca.
      logger.error("onDirectMessageChangedUpdatePreview: fallo al refrescar", {
        convId: event.params.convId,
        error,
      });
      throw error;
    }
  }
);
