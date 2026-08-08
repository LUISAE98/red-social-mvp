"use client";

import { useTranslations } from "next-intl";

import LiveRingAvatar from "@/app/components/LiveRing/LiveRingAvatar";
import ConversationThread from "./ConversationThread";
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
        <LiveRingAvatar
          entityId={otherUid ?? conversationId}
          entityType="profile"
          currentUserId={selfUid}
          photoURL={profile?.photoURL ?? null}
          displayName={displayName}
          size={28}
        />

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

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleMinimize();
          }}
          aria-label={minimized ? tChat("expandChat") : tChat("minimizeChat")}
          style={iconButtonStyle}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
            {/* Chevron: apunta arriba si está minimizado (se despliega hacia
                arriba) y abajo si está abierto (se minimiza hacia abajo). */}
            <path
              d={minimized ? "M6 15L12 9L18 15" : "M6 9L12 15L18 9"}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

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
        />
      </div>
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
