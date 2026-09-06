"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { useAuth } from "@/app/providers";
import { useInbox } from "@/lib/chat/useInbox";
import { getOtherParticipant } from "@/lib/chat/types";
import { useChatDock } from "@/components/chat/ChatDockProvider";
import ConversationList, {
  CHAT_AVATAR_ANCHO,
  CHAT_AVATAR_ANCHO_LAPTOP,
} from "@/components/chat/ConversationList";
import { ConversationListSkeleton } from "@/components/chat/ChatSkeletons";
import { useProfileMinis } from "@/lib/chat/useProfileMinis";
import { useScreenReady } from "@/lib/useScreenReady";
import { useIsCompact } from "@/lib/hooks/useMediaQuery";
import { IconButton } from "@/components/ui/IconButton";
import { VibraNavigationIcon } from "@/app/components/VibraServiceIcons/VibraNavigationIcons";
import {
  buscarEnMensajes,
  type MensajeEncontrado,
} from "@/lib/chat/messageCache";
import { sembrarHistorial } from "@/lib/chat/sembrarMensajes";
import { comparable } from "@/lib/chat/textoBusqueda";
import MessageSearchResults from "./components/MessageSearchResults";

/**
 * Todos los chats, en su propia página (el "Ver todos" del sidebar).
 *
 * Misma estructura que la página de notificaciones: columna de 640, cabecera
 * con título, y la lista debajo. Reusa `ConversationList`, así que una fila se
 * ve idéntica aquí y en el sidebar.
 */
export default function MessagesPage() {
  const tNav = useTranslations("nav");
  const tChat = useTranslations("chat");
  const tCommon = useTranslations("common");
  const { user } = useAuth();
  const selfUid = user?.uid ?? null;

  const { conversations, loading, hasMore, loadingMore, loadMore } = useInbox(selfUid);
  const { conversations: requests } = useInbox(selfUid, ["request"]);
  const { openChat, activeConversationIds } = useChatDock();

  const [busqueda, setBusqueda] = useState("");

  /**
   * Mensajes encontrados, GUARDADOS JUNTO a la búsqueda que los produjo.
   *
   * Van emparejados porque leer el disco tarda: sin la pareja, los resultados
   * de "fac" se seguían enseñando un instante después de escribir "factura", y
   * al borrar el campo había que vaciarlos a mano. Comparando la aguja, unos
   * resultados que no son de lo que está escrito simplemente no se usan.
   */
  const [hallazgos, setHallazgos] = useState<{
    aguja: string;
    mensajes: MensajeEncontrado[];
  }>({ aguja: "", mensajes: [] });

  /** Aún sembrando historial: hay que decirlo o parece que no hay resultados. */
  const [sembrando, setSembrando] = useState(false);

  /**
   * El avatar de esta lista, un 15% más chico en laptop (52 → 44).
   *
   * ⚠️ `useIsCompact` arranca en `false` y se corrige al hidratar, así que la
   * primera pasada dice "laptop". Aquí no se nota: las filas llegan de
   * Firestore DESPUÉS de hidratar, así que nunca se pintan con la medida
   * equivocada. El hueco de carga usa esta misma cuenta por lo mismo de
   * siempre: si se separan, la lista salta al llegar los datos.
   */
  const esCompacto = useIsCompact();
  const ladoAvatar = esCompacto ? CHAT_AVATAR_ANCHO : CHAT_AVATAR_ANCHO_LAPTOP;

  // La bandeja avisa en cuanto deja de cargar; su lista ya tiene esqueleto.
  useScreenReady(!loading);

  const counterpartIds = useMemo(() => {
    if (!selfUid) return [];
    return [...conversations, ...requests]
      .map((conv) => getOtherParticipant(conv.participants, selfUid))
      .filter((uid): uid is string => !!uid);
  }, [conversations, requests, selfUid]);

  const profiles = useProfileMinis(counterpartIds);

  /**
   * Se busca por el nombre y el arroba de la otra persona, y por el texto del
   * último mensaje. Es un filtro EN MEMORIA sobre lo ya traído, no una
   * consulta: el historial se pagina por scroll, así que lo que aún no ha
   * bajado tampoco se busca. Para lo que es —encontrar un hilo del que te
   * acuerdas— alcanza, y no cuesta ni una lectura más.
   */
  const filtrar = useMemo(() => {
    const aguja = comparable(busqueda.trim());

    return (lista: typeof conversations) => {
      if (!aguja) return lista;

      return lista.filter((conversation) => {
        const otherUid = selfUid
          ? getOtherParticipant(conversation.participants, selfUid)
          : null;
        const profile = otherUid ? profiles[otherUid] : undefined;
        const pajar = comparable(
          [profile?.displayName, profile?.handle, conversation.lastMessage?.text]
            .filter(Boolean)
            .join(" "),
        );
        // Aquí SOLO por persona. Lo que casa por contenido va en su propia
        // sección, con el mensaje encontrado a la vista.
        return pajar.includes(aguja);
      });
    };
  }, [busqueda, profiles, selfUid]);

  /**
   * Baja el historial COMPLETO de cada hilo al aparato, en segundo plano.
   *
   * Es lo que convierte la búsqueda en histórica: sin esto solo se encontraba
   * dentro de lo que hubieras abierto y scrolleado a mano.
   *
   * Van de uno en uno y no en paralelo a propósito: son lecturas de fondo y no
   * deben competir con lo que estás mirando ahora mismo. Se paga una vez por
   * hilo y por aparato, porque lo guardado no caduca y queda marcado.
   */
  const sembradosRef = useRef<Set<string>>(new Set());
  const [semilla, setSemilla] = useState(0);

  useEffect(() => {
    if (conversations.length === 0) return;

    const pendientes = conversations.filter(
      (c) => !sembradosRef.current.has(c.id)
    );
    if (pendientes.length === 0) return;

    let cancelado = false;

    void (async () => {
      // El aviso se enciende DENTRO de la parte asíncrona: un setState síncrono
      // en el cuerpo del efecto encadena un render de más, y el repo lo trata
      // como error de lint, no como aviso.
      setSembrando(true);
      let bajoAlgo = false;

      for (const conversation of pendientes) {
        if (cancelado) return;
        sembradosRef.current.add(conversation.id);

        try {
          if (await sembrarHistorial(conversation.id)) bajoAlgo = true;
        } catch {
          // Sembrar es una mejora, no un requisito: si falla, la búsqueda no
          // alcanza a ese hilo y la pantalla sigue funcionando igual.
          sembradosRef.current.delete(conversation.id);
        }
      }

      if (cancelado) return;
      setSembrando(false);
      // Repite la búsqueda que estuviera en curso: lo recién bajado puede
      // contener justo lo que se estaba buscando cuando salió vacío.
      if (bajoAlgo) setSemilla((n) => n + 1);
    })();

    return () => {
      cancelado = true;
    };
  }, [conversations]);

  /**
   * Leer el disco en CADA tecla sería absurdo, así que se espera a que dejes de
   * escribir. 180ms es lo que tarda una pausa real entre palabras.
   *
   * `cancelado` evita que una lectura lenta pise el resultado de una búsqueda
   * posterior, que es como se enseñan resultados de lo que ya no está escrito.
   */
  useEffect(() => {
    const aguja = busqueda.trim();
    if (!aguja) return;

    let cancelado = false;
    const t = window.setTimeout(() => {
      void buscarEnMensajes(aguja).then((mensajes) => {
        if (cancelado) return;
        setHallazgos({ aguja, mensajes });
      });
    }, 180);

    return () => {
      cancelado = true;
      window.clearTimeout(t);
    };
  }, [busqueda, semilla]);

  const conversacionesVisibles = useMemo(
    () => filtrar(conversations),
    [filtrar, conversations],
  );

  // Las solicitudes también se filtran: si buscas a alguien que aún no has
  // aceptado, seguía saliendo abajo como si nada, y quedaba raro al lado de un
  // aviso que decía que no había resultados.
  const solicitudesVisibles = useMemo(() => filtrar(requests), [filtrar, requests]);

  /** Escribiendo algo, la pantalla cambia de modo: deja de ser la bandeja. */
  const buscando = busqueda.trim().length > 0;

  /** Los mensajes encontrados, solo si son de LO QUE ESTÁ ESCRITO ahora. */
  const mensajesEncontrados = useMemo(
    () => (hallazgos.aguja === busqueda.trim() ? hallazgos.mensajes : []),
    [hallazgos, busqueda],
  );

  /**
   * El perfil del otro, a partir del hilo. La fila de resultados solo tiene el
   * id de la conversación, y necesita cara y nombre.
   */
  const porConversacion = useMemo(() => {
    const mapa = new Map<string, (typeof profiles)[string]>();
    if (!selfUid) return mapa;

    for (const conversation of [...conversations, ...requests]) {
      const otherUid = getOtherParticipant(conversation.participants, selfUid);
      const perfil = otherUid ? profiles[otherUid] : undefined;
      if (perfil) mapa.set(conversation.id, perfil);
    }
    return mapa;
  }, [conversations, requests, profiles, selfUid]);

  // Dispara la siguiente tanda al llegar al final. El margen la adelanta para
  // que ya esté puesta cuando el dedo llegue abajo.
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hasMore || loadingMore) return;
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel) return;

    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: "0px 0px 300px 0px" }
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [hasMore, loadingMore, loadMore]);

  // Estilos del sidebar que `ConversationList` espera; aquí van planos porque
  // la página no tiene el panel morado de fondo que sí tiene el sidebar.
  const listStyles = useMemo(
    () => ({
      sectionPanel: { display: "grid", gap: 8 },
      card: {},
      subtle: { fontSize: 13, color: "rgba(255,255,255,0.45)", padding: "8px 4px" },
    }),
    []
  );

  function handleOpen(conversationId: string) {
    if (!selfUid) return;
    openChat({
      conversationId,
      otherUid: getOtherParticipant(conversationId.split("_"), selfUid),
      profile: profiles[getOtherParticipant(conversationId.split("_"), selfUid) ?? ""],
    });
  }

  return (
    <div className="msgPage">
      <div className="msgPageHead">
        <h1 className="vibra-page-title">{tNav("tabMessages")}</h1>
      </div>

      {/* Buscador. Mismo campo que el de Guardados: alto 38, radio 12, fondo
          rgba(255,255,255,0.06) y la lupa DENTRO, a la derecha. Aquí filtra
          mientras escribes en vez de esperar al Enter, porque no cuesta una
          consulta; la lupa se queda igualmente para quien la busque con el
          dedo, y el formulario para quien mande con Enter. */}
      <form
        className="msgSearch"
        onSubmit={(event) => event.preventDefault()}
        role="search"
      >
        <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
          <input
            type="search"
            value={busqueda}
            onChange={(event) => setBusqueda(event.target.value)}
            placeholder={tChat("searchPlaceholder")}
            aria-label={tChat("searchPlaceholder")}
            className="msgSearchInput"
            style={{ paddingInlineEnd: busqueda ? 62 : 38 }}
          />

          {/* Limpiar: solo cuando hay algo que limpiar. */}
          {busqueda ? (
            <button
              type="button"
              className="msgSearchClear vibra-pop"
              onClick={() => setBusqueda("")}
              aria-label={tCommon("clearSearch")}
              title={tCommon("clearSearch")}
            >
              ×
            </button>
          ) : null}

          <IconButton
            label={tCommon("search")}
            size="sm"
            tone="bare"
            shape="square"
            style={{
              position: "absolute",
              insetInlineEnd: 6,
              top: "50%",
              transform: "translateY(-50%)",
              placeItems: "center",
            }}
            type="submit"
          >
            <VibraNavigationIcon type="search" size={18} strokeWidth={2.2} />
          </IconButton>
        </div>
      </form>

      {/* Buscando, la pantalla es OTRA: dos secciones, personas y mensajes.
          Mezclarlas en una sola lista obliga a adivinar por qué salió cada fila,
          y era justo el problema —una conversación aparecía por un mensaje de
          hace meses y la fila enseñaba el último, que no tenía nada que ver—. */}
      {buscando ? (
        <>
          {conversacionesVisibles.length > 0 || solicitudesVisibles.length > 0 ? (
            <div className="msgSeccion">
              <div className="msgSeccionTitulo">{tChat("searchPeople")}</div>
              <ConversationList
                loading={false}
                conversations={[...conversacionesVisibles, ...solicitudesVisibles]}
                selfUid={selfUid}
                profiles={profiles}
                styles={listStyles}
                activeConversationIds={activeConversationIds}
                onOpenConversation={handleOpen}
                isMobile
                avatarSize={ladoAvatar}
              />
            </div>
          ) : null}

          {mensajesEncontrados.length > 0 ? (
            <div className="msgSeccion">
              <div className="msgSeccionTitulo">
                {tChat("searchMessages", { count: mensajesEncontrados.length })}
              </div>
              <MessageSearchResults
                resultados={mensajesEncontrados}
                aguja={busqueda}
                perfilPorConversacion={(id) => porConversacion.get(id)}
                selfUid={selfUid}
                ladoAvatar={ladoAvatar}
                onAbrir={handleOpen}
              />
            </div>
          ) : null}

          {conversacionesVisibles.length === 0 &&
          solicitudesVisibles.length === 0 &&
          mensajesEncontrados.length === 0 ? (
            <div className="msgNoResults">
              {sembrando ? (
                /* Decirlo importa: mientras baja el historial, una búsqueda
                   puede salir vacía y volver a llenarse sola en un segundo. */
                tChat("searchPreparing")
              ) : (
                <>
                  {tChat("noSearchResults")}
                  <span className="msgNoResultsHint">{tChat("searchScopeHint")}</span>
                </>
              )}
            </div>
          ) : null}
        </>
      ) : (
        <>
          {/* 🚨 `isMobile` NO ES OPCIONAL AQUÍ. No pregunta por el aparato,
              pregunta si la fila tiene sitio: esta pantalla es una columna de
              640px para ella sola, y la barra lateral de laptop es estrecha.

              La página no lo pasaba, así que caía al `false` por defecto y la
              lista se pintaba con las medidas de la barra —avatares de 36—
              aunque la rama de celular dijera otra cosa. */}
          <ConversationList
            loading={loading}
            conversations={conversations}
            selfUid={selfUid}
            profiles={profiles}
            styles={listStyles}
            activeConversationIds={activeConversationIds}
            onOpenConversation={handleOpen}
            isMobile
            avatarSize={ladoAvatar}
          />
        </>
      )}

      {/* Historial: al asomarse el final de la lista se trae la siguiente
          tanda. El centinela va ANTES de las solicitudes, que son un bloque
          aparte y no deben empujarlo fuera de vista. */}
      {!buscando && !loading && hasMore && (
        <>
          <div ref={loadMoreSentinelRef} aria-hidden style={{ height: 1 }} />
          {/* El avatar va a mano porque este hueco no pasa por `ConversationList`
              y su valor por defecto es el de la barra de laptop. Tiene que medir
              lo mismo que la fila real, o la lista salta al llegar la tanda. */}
          {loadingMore && <ConversationListSkeleton rows={3} avatarSize={ladoAvatar} />}
        </>
      )}

      {!buscando && requests.length > 0 && (
        <div className="msgRequests">
          <div className="msgRequestsTitle">
            {tNav("messageRequests", { count: requests.length })}
          </div>
          <ConversationList
            loading={false}
            conversations={requests}
            selfUid={selfUid}
            profiles={profiles}
            styles={listStyles}
            activeConversationIds={activeConversationIds}
            onOpenConversation={handleOpen}
            isMobile
            avatarSize={ladoAvatar}
          />
        </div>
      )}

      <style jsx>{`
        .msgPage {
          max-width: 640px;
          margin: 0 auto;
          /* Abajo NO se libera el nav: de eso ya se encarga el layout protegido
             (mainCol reserva 84px + safe-area). Aquí había 96px extra, y el
             resultado era un pozo vacío entre la última fila y el nav que se
             leía como un segundo safe-area apilado. */
          padding: 8px 12px 12px;
        }
        .msgPageHead {
          display: flex;
          align-items: center;
          justify-content: space-between;
          /* Mismo aire que el resto de títulos: 8 arriba (los pone .msgPage)
             y 10 abajo. */
          padding: 0 4px 10px;
        }
        /* El aspecto sale de ".vibra-page-title" (globals.css). */
        .msgSearch {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          min-width: 0;
          box-sizing: border-box;
          padding: 0 4px;
          margin-bottom: 12px;
        }
        /* Campo canónico de Vibra (vibra_style.md → "Textarea"), el mismo que
           usa Guardados. El color del placeholder lo deja el navegador. */
        .msgSearchInput {
          width: 100%;
          min-width: 0;
          height: 38px;
          border-radius: 12px;
          border: none;
          background: rgba(255, 255, 255, 0.06);
          color: #fff;
          padding-inline-start: 12px;
          font-size: 13px;
          font-family: inherit;
          outline: none;
          box-sizing: border-box;
        }
        /* Safari le pinta su propia × al type="search", y quedarían dos. */
        .msgSearchInput::-webkit-search-decoration,
        .msgSearchInput::-webkit-search-cancel-button {
          -webkit-appearance: none;
          appearance: none;
        }
        .msgSearchClear {
          position: absolute;
          inset-inline-end: 36px;
          top: 50%;
          transform: translateY(-50%);
          width: 24px;
          height: 24px;
          border: none;
          background: transparent;
          color: rgba(255, 255, 255, 0.55);
          cursor: pointer;
          display: grid;
          place-items: center;
          font-size: 18px;
          line-height: 1;
          padding: 0;
        }
        .msgSeccion {
          margin-bottom: 18px;
        }
        .msgSeccionTitulo {
          font-size: 12px;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.52);
          padding: 0 4px 6px;
        }
        .msgNoResultsHint {
          display: block;
          margin-top: 6px;
          font-size: 12px;
          color: rgba(255, 255, 255, 0.38);
        }
        .msgNoResults {
          font-size: 13px;
          color: rgba(255, 255, 255, 0.5);
          padding: 18px 4px;
          text-align: center;
        }
        .msgRequests {
          margin-top: 18px;
        }
        .msgRequestsTitle {
          font-size: 12px;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.52);
          padding: 0 4px 6px;
        }
      `}</style>
    </div>
  );
}
