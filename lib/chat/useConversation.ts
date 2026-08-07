"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  fetchOlderMessages,
  markConversationRead,
  sendMessage as sendMessageToConversation,
  subscribeToConversation,
  type MessageWithId,
} from "./chatService";
import { CONVERSATION_PAGE_SIZE } from "./types";

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

  // Marca leído UNA vez por conversación abierta: un solo write, no uno por
  // mensaje ni uno por render.
  useEffect(() => {
    if (!conversationId || !selfUid || loading) return;
    if (markedRef.current === conversationId) return;

    markedRef.current = conversationId;
    void markConversationRead(conversationId, selfUid);
  }, [conversationId, selfUid, loading]);

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
    async (text: string) => {
      if (!conversationId || !selfUid) return;
      await sendMessageToConversation(conversationId, selfUid, text);
    },
    [conversationId, selfUid]
  );

  return {
    messages: [...older, ...live],
    loading,
    loadingOlder,
    hasMore,
    error,
    loadOlder,
    send,
  };
}
