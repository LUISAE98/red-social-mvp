"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  fetchOlderMessages,
  markConversationRead,
  sendMessage as sendMessageToConversation,
  subscribeToConversation,
  type MessageWithId,
} from "./chatService";
import {
  CONVERSATION_PAGE_SIZE,
  type ChatImage,
  type MessageReply,
} from "./types";

/**
 * Hilo de una conversación.
 *
 * El listener en vivo queda acotado a la última página (`CONVERSATION_PAGE_SIZE`)
 * por larga que sea la conversación. Las páginas antiguas se traen con una
 * lectura de una sola vez y se guardan en memoria: el historial ya no cambia,
 * así que suscribirse a él sería pagar para siempre por datos inmutables.
 */
export function useConversation(conversationId: string | null, selfUid: string | null) {
  /** Última página, en vivo. */
  const [live, setLive] = useState<MessageWithId[]>([]);
  /** Páginas anteriores ya cargadas, de más antigua a más reciente. */
  const [older, setOlder] = useState<MessageWithId[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const markedRef = useRef<string | null>(null);

  useEffect(() => {
    setOlder([]);
    setHasMore(true);
    markedRef.current = null;

    if (!conversationId) {
      setLive([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const unsub = subscribeToConversation(
      conversationId,
      (next) => {
        setLive(next);
        setLoading(false);
        setError(null);
        // Menos de una página completa ⇒ no hay historial anterior que pedir.
        if (next.length < CONVERSATION_PAGE_SIZE) setHasMore(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [conversationId]);

  // Historial paginado + última página en vivo, en orden de lectura.
  // Los ocultados "solo para mí" se filtran aquí: siguen existiendo en la base
  // (el otro los ve), pero desaparecen de esta vista.
  const messages = useMemo(
    () =>
      [...older, ...live].filter(
        (message) => !(selfUid && message.deletedFor?.includes(selfUid))
      ),
    [older, live, selfUid]
  );

  // Marca leído al abrir el hilo: un solo write, no uno por render.
  useEffect(() => {
    if (!conversationId || !selfUid || loading) return;
    if (markedRef.current === conversationId) return;

    markedRef.current = conversationId;
    void markConversationRead(conversationId, selfUid);
  }, [conversationId, selfUid, loading]);

  // Con el hilo YA abierto, los mensajes que llegan también cuentan como leídos
  // (si no, la Cloud Function sigue subiendo el contador de algo que la persona
  // está mirando). Va con retardo a propósito: una ráfaga de mensajes se
  // colapsa en UN write en vez de uno por mensaje, que es justo el costo que
  // este diseño evita.
  const lastIncomingIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!conversationId || !selfUid) return;

    const last = messages[messages.length - 1];
    if (!last || last.senderId === selfUid) return;
    if (lastIncomingIdRef.current === last.id) return;

    lastIncomingIdRef.current = last.id;
    const timer = setTimeout(() => {
      void markConversationRead(conversationId, selfUid);
    }, 2500);

    return () => clearTimeout(timer);
  }, [messages, conversationId, selfUid]);

  const loadOlder = useCallback(async () => {
    if (!conversationId || loadingOlder || !hasMore) return;

    const oldest = older[0] ?? live[0];
    if (!oldest?.createdAt) return;

    setLoadingOlder(true);
    try {
      const page = await fetchOlderMessages(conversationId, oldest.createdAt);
      if (page.length < CONVERSATION_PAGE_SIZE) setHasMore(false);
      if (page.length) setOlder((prev) => [...page, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoadingOlder(false);
    }
  }, [conversationId, loadingOlder, hasMore, older, live]);

  const send = useCallback(
    async (text: string, image?: ChatImage | null, replyTo?: MessageReply | null) => {
      if (!conversationId || !selfUid) return;
      await sendMessageToConversation(conversationId, selfUid, text, image, replyTo);
    },
    [conversationId, selfUid]
  );

  return {
    messages,
    loading,
    loadingOlder,
    hasMore,
    error,
    loadOlder,
    send,
  };
}
