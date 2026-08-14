"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import LiveRingAvatar from "@/app/components/LiveRing/LiveRingAvatar";
import ProfileMoreMenu from "@/app/[locale]/(protected)/u/[handle]/components/ProfileMoreMenu";
import ConversationThread from "./ConversationThread";
import {
  ChatConversationMenuItems,
  ChatRemoveConversationDialog,
} from "./ChatConversationActions";
import { useConversationDoc } from "@/lib/chat/useConversationDoc";
import type { ProfileMini } from "./ConversationList";

/**
 * Chat anclado abajo a la derecha (laptop), estilo Facebook web.
 *
 * Desplegado ocupa una ventana fija; minimizado se queda solo la barra del
 * título pegada al borde inferior. Al minimizar NO se desmonta el hilo: se
 * corta su suscripción (`active={false}`) y se conserva quién está abierto, así
 * volver a desplegarlo es instantáneo y no vuelve a leer la conversación.
 */

export const DOCK_WIDTH = 328;
const DOCK_HEIGHT = 420;

/**
 * Debe coincidir con `--duration-normal` (250ms): quien cierra espera a que
 * termine la animación antes de quitar la pestaña de la lista.
 */
export const DOCK_ANIM_MS = 250;

export default function ChatDock({
  conversationId,
  otherUid,
  profile,
  selfUid,
  minimized,
  closing,
  onToggleMinimize,
  onClose,
}: {
  conversationId: string;
  otherUid: string | null;
  profile: ProfileMini | undefined;
  selfUid: string | null;
  minimized: boolean;
  /** true mientras baja deslizando; quien la puso la quita al terminar. */
  closing: boolean;
  onToggleMinimize: () => void;
  onClose: () => void;
}) {
  const tCommon = useTranslations("common");
  const tChat = useTranslations("chat");

  const displayName = profile?.displayName || tCommon("user");
  // Solo para saber si está silenciado: es el mismo documento que ya escucha el
  // hilo, así que no añade lecturas.
  const { conversation } = useConversationDoc(conversationId);
  // Fuera del menú: ese se desmonta al cerrarse y se llevaba el panel con él.
  const [removeOpen, setRemoveOpen] = useState(false);

  const unread = selfUid ? (conversation?.unread?.[selfUid] ?? 0) : 0;
  const showUnreadBadge = minimized && unread > 0;

  return (
    <div
      style={{
        // Entra subiendo desde el borde inferior; al cerrar, baja. El estado de
        // cierre lo lleva el provider, que es quien la quita de la lista cuando
        // termina la animación.
        animation: `${closing ? "vibraChatDockOut" : "vibraChatDockIn"} var(--duration-normal, 250ms) var(--ease-smooth, cubic-bezier(0.4, 0, 0.2, 1)) both`,
        willChange: "transform",
        // La fila que las contiene no captura clics (pointerEvents: none) para
        // no bloquear la página detrás; cada pestaña sí.
        pointerEvents: "auto",
        flexShrink: 0,
        width: DOCK_WIDTH,
        maxWidth: "calc(100vw - 40px)",
        display: "flex",
        flexDirection: "column",
        borderRadius: "12px 12px 0 0",
        overflow: "hidden",
        background: "#0b0b0d",
        border: "1px solid rgba(255,255,255,0.10)",
        borderBottom: "none",
        boxShadow: "0 -8px 40px rgba(0,0,0,0.55)",
      }}
      role="dialog"
      aria-label={displayName}
    >
      <style jsx global>{`
        /* El contador entra con el mismo rebote que el resto de marcadores del
           chat, para que un mensaje nuevo se note sin sobresaltar. */
        .vibra-dock-unread {
          animation: vibraDockUnreadPop var(--duration-normal, 250ms)
            var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1)) both;
        }
        @keyframes vibraDockUnreadPop {
          from {
            opacity: 0;
            transform: scale(0.4);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .vibra-dock-unread {
            animation: none;
          }
        }

        @keyframes vibraChatDockIn {
          from {
            transform: translateY(100%);
          }
          to {
            transform: translateY(0);
          }
        }
        @keyframes vibraChatDockOut {
          from {
            transform: translateY(0);
          }
          to {
            transform: translateY(100%);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes vibraChatDockIn {
            from,
            to {
              transform: translateY(0);
            }
          }
          @keyframes vibraChatDockOut {
            from,
            to {
              transform: translateY(100%);
            }
          }
        }
      `}</style>

      {/* Barra del título: toda ella alterna minimizar/desplegar, como en
          Facebook. Los botones de la derecha paran la propagación. */}
      <div
        onClick={() => {
          if (!closing) onToggleMinimize();
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "8px 10px",
          cursor: "pointer",
          background: "rgba(255,255,255,0.04)",
          borderBottom: minimized ? "none" : "1px solid rgba(255,255,255,0.08)",
          userSelect: "none",
        }}
      >
        {/* A la IZQUIERDA del avatar. Se para la propagación para que abrir el
            menú no minimice también la pestaña. */}
        {otherUid ? (
          <span onClick={(e) => e.stopPropagation()} style={{ display: "inline-flex" }}>
            <ProfileMoreMenu
              viewerUid={selfUid}
              profileUid={otherUid}
              // Bloquear/desbloquear NO se cablea aquí: el estado del hilo lo
              // sincroniza `useSocialRelationship`, que es por donde pasan todos
              // los bloqueos. Hacerlo también aquí sería escribir dos veces.
              reportTarget={{
                targetType: "conversation",
                targetId: conversationId,
                targetOwnerId: otherUid,
              }}
              // Área de clic holgada: con `padding: 0` el blanco entre los tres
              // puntos era todo lo que había que acertar.
              buttonStyle={{ fontSize: 18, padding: "6px 9px", lineHeight: 1 }}
              extraItems={({ close, itemStyle }) =>
                selfUid ? (
                  <ChatConversationMenuItems
                    conversationId={conversationId}
                    selfUid={selfUid}
                    muted={(conversation?.mutedBy ?? []).includes(selfUid)}
                    itemStyle={itemStyle}
                    onCloseMenu={close}
                    onRequestRemove={() => setRemoveOpen(true)}
                  />
                ) : null
              }
            />
          </span>
        ) : null}

        {/* Aviso de la pestaña minimizada: aro morado y el número de mensajes
            sin abrir. Solo minimizada — desplegada los estás leyendo, y el
            propio hilo los marca como leídos.
            El contador viene del documento de la conversación, que se sigue
            escuchando aunque la pestaña esté plegada (lo que se corta al plegar
            es la suscripción a los MENSAJES, que es la cara). */}
        <span
          style={{
            position: "relative",
            display: "inline-flex",
            flexShrink: 0,
            borderRadius: 999,
            // El aro va por sombra y no por borde: un borde cambiaría el tamaño
            // del avatar y movería toda la cabecera al aparecer.
            boxShadow: showUnreadBadge ? "0 0 0 2px #a855f7" : "none",
            transition: "box-shadow var(--duration-fast, 150ms) ease",
          }}
        >
          <LiveRingAvatar
            entityId={otherUid ?? conversationId}
            entityType="profile"
            currentUserId={selfUid}
            photoURL={profile?.photoURL ?? null}
            displayName={displayName}
            size={28}
          />

          {showUnreadBadge ? (
            <span
              className="vibra-dock-unread"
              aria-label={tChat("unreadCount", { count: unread })}
              style={{
                position: "absolute",
                top: -5,
                insetInlineEnd: -5,
                minWidth: 17,
                height: 17,
                padding: "0 4px",
                borderRadius: 999,
                background: "#a855f7",
                color: "#fff",
                fontSize: 10,
                fontWeight: 700,
                lineHeight: "17px",
                textAlign: "center",
                boxSizing: "border-box",
                // Separa el número del avatar que tiene detrás.
                border: "2px solid #0b0b0f",
              }}
            >
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </span>

        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 13,
            fontWeight: 600,
            color: "#fff",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {displayName}
        </span>

        {/* Minimizar: una raya, sin flecha. Estando minimizada NO se muestra —
            para volver a abrir se toca la pestaña, así que un botón de
            "expandir" sería redundante. Solo quedan avatar, nombre y tache. */}
        {!minimized ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleMinimize();
            }}
            aria-label={tChat("minimizeChat")}
            style={iconButtonStyle}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
              <path
                d="M6 12H18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        ) : null}

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          aria-label={tCommon("close")}
          style={iconButtonStyle}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
            <path
              d="M6 6L18 18M18 6L6 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {/* Minimizado: el hilo se queda montado pero sin suscripción ni alto. */}
      <div
        style={{
          height: minimized ? 0 : DOCK_HEIGHT,
          overflow: "hidden",
          transition:
            "height var(--duration-normal, 250ms) var(--ease-smooth, cubic-bezier(0.4, 0, 0.2, 1))",
        }}
      >
        <ConversationThread
          conversationId={conversationId}
          otherUid={otherUid}
          profile={profile}
          selfUid={selfUid}
          active={!minimized}
          // El dock solo existe en laptop: aquí siempre hay cursor.
          pointerActions
        />
      </div>

      {/* Fuera de la caja que se colapsa al minimizar, y fuera del menú. */}
      {selfUid ? (
        <ChatRemoveConversationDialog
          open={removeOpen}
          conversationId={conversationId}
          selfUid={selfUid}
          onClose={() => setRemoveOpen(false)}
          // Quitada de la bandeja, la pestaña se cierra sola.
          onRemoved={onClose}
        />
      ) : null}
    </div>
  );
}

const iconButtonStyle = {
  flexShrink: 0,
  width: 26,
  height: 26,
  borderRadius: 6,
  border: "none",
  background: "transparent",
  color: "rgba(255,255,255,0.62)",
  cursor: "pointer",
  display: "grid",
  placeItems: "center",
  padding: 0,
} as const;
