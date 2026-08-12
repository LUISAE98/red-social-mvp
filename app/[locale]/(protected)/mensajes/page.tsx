"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import { useAuth } from "@/app/providers";
import { useInbox } from "@/lib/chat/useInbox";
import { getOtherParticipant } from "@/lib/chat/types";
import { useChatDock } from "@/components/chat/ChatDockProvider";
import ConversationList from "@/components/chat/ConversationList";
import { useProfileMinis } from "@/lib/chat/useProfileMinis";

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

  const { conversations, loading } = useInbox(selfUid);
  const { conversations: requests } = useInbox(selfUid, ["request"]);
  const { openChat, activeConversationIds } = useChatDock();

  const counterpartIds = useMemo(() => {
    if (!selfUid) return [];
    return [...conversations, ...requests]
      .map((conv) => getOtherParticipant(conv.participants, selfUid))
      .filter((uid): uid is string => !!uid);
  }, [conversations, requests, selfUid]);

  const profiles = useProfileMinis(counterpartIds);

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
        <h1 className="msgPageTitle">{tNav("tabMessages")}</h1>
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
          padding: 16px 4px 8px;
        }
        .msgPageTitle {
          font-size: 20px;
          font-weight: 600;
          color: #fff;
          margin: 0;
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
