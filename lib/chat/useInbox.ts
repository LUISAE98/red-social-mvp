"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { captureError } from "@/lib/observability/captureError";
import {
  fetchOlderConversations,
  subscribeToInbox,
  type ConversationWithId,
} from "./chatService";
import type { ConversationStatus } from "./types";

/**
 * Bandeja de conversaciones.
 *
 * Una sola query sobre `conversations` (≤20 docs). Nunca lee subcolecciones de
 * mensajes: el resumen de cada hilo va denormalizado en `lastMessage`, que es
 * justamente lo que hace que el inbox sea barato.
 *
 * `statuses` permite separar la bandeja principal de Solicitudes para que un
 * aluvión de solicitudes no desplace las conversaciones reales.
 */
export function useInbox(
  selfUid: string | null,
  statuses: ConversationStatus[] = ["active", "blocked"]
) {
  const [state, setState] = useState<{
    conversations: ConversationWithId[];
    loading: boolean;
    error: Error | null;
  }>({ conversations: [], loading: true, error: null });

  // Sin esto, un array literal en el call site recrearía la suscripción en cada
  // render (desmontar/montar listener = releer la bandeja entera cada vez).
  const statusKey = statuses.join(",");

  useEffect(() => {
    if (!selfUid) return;

    const unsub = subscribeToInbox(
      selfUid,
      statusKey.split(",") as ConversationStatus[],
      (next) => setState({ conversations: next, loading: false, error: null }),
      (err) => setState((prev) => ({ ...prev, loading: false, error: err }))
    );

    return () => unsub();
  }, [selfUid, statusKey]);

  // Derivado en vez de reseteado dentro del efecto: sin sesión no hay bandeja,
  // y así no queda visible el estado sobrante de un uid anterior. Memoizado
  // porque el array vacío sería una referencia nueva en cada render.
  const liveConversations = useMemo(
    () => (selfUid ? state.conversations : []),
    [selfUid, state.conversations]
  );
  const loading = selfUid ? state.loading : false;
  const error = selfUid ? state.error : null;

  /**
   * Historial de la bandeja.
   *
   * El listener en vivo cubre solo la primera página; lo anterior se trae bajo
   * demanda y vive aquí, fusionado por delante de lo suscrito. Sin esto la
   * bandeja se quedaba en 20 conversaciones y la 21 no existía.
   */
  const [older, setOlder] = useState<ConversationWithId[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // Cambiar de sesión o de bandeja invalida el historial acumulado.
  const resetKey = `${selfUid ?? ""}|${statusKey}`;
  const lastResetKey = useRef(resetKey);
  if (lastResetKey.current !== resetKey) {
    lastResetKey.current = resetKey;
    if (older.length > 0) setOlder([]);
    if (!hasMore) setHasMore(true);
  }

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !selfUid) return;

    // El más antiguo de lo que ya hay, venga del listener o del historial.
    const all = [...state.conversations, ...older];
    const oldest = all[all.length - 1]?.lastMessageAt;
    if (!oldest) {
      setHasMore(false);
      return;
    }

    setLoadingMore(true);
    try {
      const page = await fetchOlderConversations({
        selfUid,
        statuses: statusKey.split(",") as ConversationStatus[],
        before: oldest,
      });
      setOlder((current) => {
        const seen = new Set([
          ...state.conversations.map((c) => c.id),
          ...current.map((c) => c.id),
        ]);
        return [...current, ...page.conversations.filter((c) => !seen.has(c.id))];
      });
      setHasMore(page.hasMore);
    } catch (err) {
      captureError(err, { scope: "chat", code: "inbox_load_more_failed" });
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, selfUid, statusKey, state.conversations, older]);

  // Lo suscrito manda: si una conversación del historial recibe un mensaje
  // nuevo sube a la primera página, y sin filtrar saldría dos veces.
  const conversations = useMemo(() => {
    const merged =
      older.length === 0
        ? liveConversations
        : (() => {
            const live = new Set(liveConversations.map((c) => c.id));
            return [...liveConversations, ...older.filter((c) => !live.has(c.id))];
          })();

    if (!selfUid) return merged;

    // Las que quitaste de la bandeja se esconden MIENTRAS no pase nada nuevo.
    // En cuanto llega otro mensaje, `lastMessageAt` adelanta a la marca y la
    // conversación reaparece sola: quitar un chat no bloquea a nadie.
    //
    // Se filtra aquí y no en la consulta porque Firestore no sabe comparar dos
    // campos del mismo documento entre sí.
    return merged.filter((conv) => {
      const hiddenAt = conv.hiddenAt?.[selfUid];
      if (!hiddenAt) return true;
      const lastAt = conv.lastMessageAt;
      if (!lastAt) return false;
      return lastAt.toMillis() > hiddenAt.toMillis();
    });
  }, [liveConversations, older, selfUid]);

  const unreadTotal = useMemo(
    () =>
      selfUid
        ? conversations.reduce((sum, conv) => sum + (conv.unread?.[selfUid] ?? 0), 0)
        : 0,
    [conversations, selfUid]
  );

  return {
    conversations,
    loading,
    error,
    unreadTotal,
    hasMore: hasMore && conversations.length > 0,
    loadingMore,
    loadMore,
  };
}
