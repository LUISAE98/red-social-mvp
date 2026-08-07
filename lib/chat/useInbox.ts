"use client";

import { useEffect, useMemo, useState } from "react";

import { subscribeToInbox, type ConversationWithId } from "./chatService";
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
  const conversations = useMemo(
    () => (selfUid ? state.conversations : []),
    [selfUid, state.conversations]
  );
  const loading = selfUid ? state.loading : false;
  const error = selfUid ? state.error : null;

  const unreadTotal = useMemo(
    () =>
      selfUid
        ? conversations.reduce((sum, conv) => sum + (conv.unread?.[selfUid] ?? 0), 0)
        : 0,
    [conversations, selfUid]
  );

  return { conversations, loading, error, unreadTotal };
}
