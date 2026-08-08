"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";

import { db } from "@/lib/firebase";
import type { ConversationWithId } from "./chatService";
import type { ConversationDoc } from "./types";

/**
 * Suscripción al documento de UNA conversación.
 *
 * Se usa cuando el hilo se abre desde fuera del inbox (p. ej. el botón "Enviar
 * mensaje" de un perfil), donde no hay un doc ya cargado del que tirar. Es un
 * solo documento, así que el costo es despreciable.
 *
 * Devuelve `null` tanto si no hay id como si el hilo TODAVÍA no existe: ese
 * segundo caso es el modo borrador, en el que el primer envío crea la
 * conversación junto a su mensaje.
 */
export function useConversationDoc(conversationId: string | null) {
  const [conversation, setConversation] = useState<ConversationWithId | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!conversationId) return;

    const unsub = onSnapshot(
      doc(db, "conversations", conversationId),
      (snap) => {
        setConversation(
          snap.exists() ? { id: snap.id, ...(snap.data() as ConversationDoc) } : null
        );
        setLoading(false);
      },
      // Un hilo inexistente puede dar permission-denied en vez de "no existe":
      // para la UI significan lo mismo (no hay conversación todavía).
      () => {
        setConversation(null);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [conversationId]);

  return {
    conversation: conversationId ? conversation : null,
    loading: conversationId ? loading : false,
  };
}
