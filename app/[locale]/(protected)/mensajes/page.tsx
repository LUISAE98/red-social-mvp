"use client";

import { useEffect, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";

import { useAuth } from "@/app/providers";
import { useInbox } from "@/lib/chat/useInbox";
import { getOtherParticipant } from "@/lib/chat/types";
import { useChatDock } from "@/components/chat/ChatDockProvider";
import ConversationList from "@/components/chat/ConversationList";
import { ConversationListSkeleton } from "@/components/chat/ChatSkeletons";
import { useProfileMinis } from "@/lib/chat/useProfileMinis";
import { useScreenReady } from "@/lib/useScreenReady";

/**
 * Todos los chats, en su propia página (el "Ver todos" del sidebar).
 *
 * Misma estructura que la página de notificaciones: columna de 640, cabecera
 * con título, y la lista debajo. Reusa `ConversationList`, así que una fila se
 * ve idéntica aquí y en el sidebar.
 */
export default function MessagesPage() {
  const tNav = useTranslations("nav");
  const { user } = useAuth();
  const selfUid = user?.uid ?? null;

  const { conversations, loading, hasMore, loadingMore, loadMore } = useInbox(selfUid);
  const { conversations: requests } = useInbox(selfUid, ["request"]);
  const { openChat, activeConversationIds } = useChatDock();

  // La bandeja avisa en cuanto deja de cargar; su lista ya tiene esqueleto.
  useScreenReady(!loading);

  const counterpartIds = useMemo(() => {
    if (!selfUid) return [];
    return [...conversations, ...requests]
      .map((conv) => getOtherParticipant(conv.participants, selfUid))
      .filter((uid): uid is string => !!uid);
  }, [conversations, requests, selfUid]);

  const profiles = useProfileMinis(counterpartIds);

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

      <ConversationList
        loading={loading}
        conversations={conversations}
        selfUid={selfUid}
        profiles={profiles}
        styles={listStyles}
        activeConversationIds={activeConversationIds}
        onOpenConversation={handleOpen}
      />

      {/* Historial: al asomarse el final de la lista se trae la siguiente
          tanda. El centinela va ANTES de las solicitudes, que son un bloque
          aparte y no deben empujarlo fuera de vista. */}
      {!loading && hasMore && (
        <>
          <div ref={loadMoreSentinelRef} aria-hidden style={{ height: 1 }} />
          {loadingMore && <ConversationListSkeleton rows={3} />}
        </>
      )}

      {requests.length > 0 && (
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
