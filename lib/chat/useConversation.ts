"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { guardarMensajes, leerMensajesGuardados } from "./messageCache";
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
export function useConversation(
  conversationId: string | null,
  selfUid: string | null,
  /**
   * ¿Se está VIENDO el final del hilo ahora mismo?
   *
   * Tener la conversación abierta no es haber leído: se puede estar arriba, en
   * el historial, mientras abajo entran mensajes nuevos. Sin esto el recibo se
   * mandaba igual y el otro veía el visto de algo que nadie había mirado.
   *
   * Va como función y no como valor porque en la vista esto es un `ref` que
   * cambia en cada scroll; pasarlo como estado obligaría a repintar el hilo
   * entero al cruzar el umbral.
   */
  viendoElFinal?: () => boolean
) {
  /** Última página, en vivo. */
  const [live, setLive] = useState<MessageWithId[]>([]);
  /** Páginas anteriores ya cargadas, de más antigua a más reciente. */
  const [older, setOlder] = useState<MessageWithId[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const markedRef = useRef<string | null>(null);
  /** Hay lectura por confirmar que no se pudo mandar por estar arriba del hilo. */
  const lecturaPendienteRef = useRef(false);
  /**
   * La última versión de `viendoElFinal`. Se guarda en un ref y se sincroniza en
   * un efecto declarado ANTES que los que la usan, para que estos la vean ya
   * puesta y no se reejecuten cada vez que la vista crea otra función.
   */
  const viendoElFinalRef = useRef(viendoElFinal);
  useEffect(() => {
    viendoElFinalRef.current = viendoElFinal;
  });

  useEffect(() => {
    setOlder([]);
    setHasMore(true);
    markedRef.current = null;
    lecturaPendienteRef.current = false;

    if (!conversationId) {
      setLive([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    /**
     * Lo guardado en el aparato se pinta ANTES de que conteste Firestore.
     *
     * `cancelado` corta la carrera: si la suscripción llega primero —o si te
     * sales del hilo mientras se lee el disco— lo de la caché ya no vale y
     * escribirlo encima sería retroceder a una versión vieja.
     */
    let cancelado = false;
    let llegoLaRed = false;

    void leerMensajesGuardados(conversationId).then((guardados) => {
      if (cancelado || llegoLaRed || guardados.length === 0) return;
      setLive(guardados);
      setLoading(false);
    });

    const unsub = subscribeToConversation(
      conversationId,
      (next) => {
        llegoLaRed = true;
        setLive(next);
        setLoading(false);
        setError(null);
        // Menos de una página completa ⇒ no hay historial anterior que pedir.
        if (next.length < CONVERSATION_PAGE_SIZE) setHasMore(false);
        // Al disco, sin caducidad. Un mensaje editado o borrado vuelve a pasar
        // por aquí, así que la copia guardada se corrige sola.
        void guardarMensajes(conversationId, next);
      },
      (err) => {
        setError(err);
        setLoading(false);
      }
    );

    return () => {
      cancelado = true;
      unsub();
    };
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

  /**
   * Manda el recibo, pero solo si de verdad se está viendo el final del hilo.
   *
   * Si no se puede, no se pierde: queda apuntado y sale en cuanto la vista
   * avise de que ha vuelto abajo (`confirmarLecturaPendiente`).
   */
  const marcarLeido = useCallback(() => {
    if (!conversationId || !selfUid) return;

    const viendo = viendoElFinalRef.current;
    if (viendo && !viendo()) {
      lecturaPendienteRef.current = true;
      return;
    }

    lecturaPendienteRef.current = false;
    void markConversationRead(conversationId, selfUid);
  }, [conversationId, selfUid]);

  /**
   * La vista llama a esto al volver al final del hilo. Solo escribe si quedaba
   * algo por confirmar, así que bajar y subir no cuesta writes.
   */
  const confirmarLecturaPendiente = useCallback(() => {
    if (!lecturaPendienteRef.current) return;
    marcarLeido();
  }, [marcarLeido]);

  // Marca leído al abrir el hilo: un solo write, no uno por render.
  useEffect(() => {
    if (!conversationId || !selfUid || loading) return;
    if (markedRef.current === conversationId) return;

    markedRef.current = conversationId;
    marcarLeido();
  }, [conversationId, selfUid, loading, marcarLeido]);

  // Con el hilo YA abierto, los mensajes que llegan también cuentan como leídos
  // (si no, la Cloud Function sigue subiendo el contador de algo que la persona
  // está mirando). Va con retardo a propósito: una ráfaga de mensajes se
  // colapsa en UN write en vez de uno por mensaje, que es justo el costo que
  // este diseño evita.
  //
  // "Está mirando" es literal: si se está arriba leyendo historial, esto NO
  // confirma nada — lo deja pendiente para cuando se vuelva abajo.
  const lastIncomingIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!conversationId || !selfUid) return;

    const last = messages[messages.length - 1];
    if (!last || last.senderId === selfUid) return;
    if (lastIncomingIdRef.current === last.id) return;

    lastIncomingIdRef.current = last.id;
    const timer = setTimeout(marcarLeido, 2500);

    return () => clearTimeout(timer);
  }, [messages, conversationId, selfUid, marcarLeido]);

  const loadOlder = useCallback(async () => {
    if (!conversationId || loadingOlder || !hasMore) return;

    const oldest = older[0] ?? live[0];
    if (!oldest?.createdAt) return;

    setLoadingOlder(true);
    try {
      // El id va como desempate: dos mensajes con la misma marca de tiempo
      // hacían que la página siguiente se saltara mensajes o los repitiera.
      const page = await fetchOlderMessages(
        conversationId,
        oldest.createdAt,
        undefined,
        oldest.id
      );
      if (page.length < CONVERSATION_PAGE_SIZE) setHasMore(false);
      if (page.length) {
        setOlder((prev) => [...page, ...prev]);
        // El historial que se baja al subir por el hilo también se queda en el
        // aparato. Es lo que hace que la segunda vez no cueste nada, y lo que
        // mete los mensajes viejos en el alcance del buscador.
        void guardarMensajes(conversationId, page);
      }
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
    confirmarLecturaPendiente,
  };
}
