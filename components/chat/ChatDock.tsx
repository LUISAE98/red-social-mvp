"use client";

import { useEffect, useRef, useState } from "react";
import { BlurFade, IconButton } from "@/components/ui";
import { useRouter } from "@/i18n/navigation";
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

/**
 * Cuánto BAJA el desenfoque de la cabecera por debajo de ella, metiéndose en el
 * hilo. Ahí es donde ocurre el fundido: si el efecto acabara justo en el canto
 * de la cabecera volvería a haber una línea, que es lo que se quería quitar.
 */
const HEADER_FADE_OVERHANG = 26;

/** Cuánto dura el desvanecido. Empieza dentro de la cabecera y acaba en el hilo. */
const HEADER_FADE_LENGTH = 40;

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

  /**
   * Alto real de la cabecera. Va SUPERPUESTA al hilo —los mensajes tienen que
   * pasarle por detrás para que el desenfoque tenga algo que difuminar—, así
   * que el hilo necesita ese hueco arriba y la caja de abajo un margen negativo
   * que la suba. Se mide en vivo porque el nombre puede ir a dos renglones en
   * idiomas largos y un valor fijo dejaría el primer mensaje tapado.
   */
  const headerRef = useRef<HTMLDivElement | null>(null);
  const [headerHeight, setHeaderHeight] = useState(45);

  useEffect(() => {
    const node = headerRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      // El BORDE, no `contentRect`: la cabecera lleva relleno propio arriba y
      // abajo y `contentRect` lo excluye.
      const border = entries[0]?.borderBoxSize?.[0]?.blockSize;
      const next = Math.ceil(border ?? node.getBoundingClientRect().height);
      // Cero significa que está oculta, no que mida cero. Guardarlo dejaría el
      // hueco del hilo en nada y el efecto sin tamaño hasta la siguiente medida.
      if (next > 0) setHeaderHeight(next);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const router = useRouter();
  const unread = selfUid ? (conversation?.unread?.[selfUid] ?? 0) : 0;

  /**
   * Al perfil. Para la propagación porque el resto de la cabecera pliega y
   * despliega la pestaña: sin esto, ir al perfil la minimizaría de paso.
   */
  function handleOpenProfile(e: React.MouseEvent) {
    // ⚠️ Minimizada, la cabecera ENTERA sirve para volver a abrir la pestaña, y
    // este botón lleva `flex: 1`, o sea que ocupa todo el ancho libre. Si aquí
    // se navegara al perfil no quedaría ni un punto donde pulsar para
    // restaurarla: el clic se lo comía el nombre y la pestaña no volvía a
    // abrirse nunca. Estando plegada se deja burbujear para que despliegue.
    if (minimized) return;
    if (!profile?.handle) return;
    e.stopPropagation();
    router.push(`/u/${profile.handle}`);
  }
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
        ref={headerRef}
        onClick={() => {
          if (!closing) onToggleMinimize();
        }}
        style={{
          position: "relative",
          // Por encima del hilo, que es el hermano de abajo: así los mensajes
          // quedan DETRÁS y entran en lo que difumina el cristal.
          zIndex: 2,
          padding: "8px 10px",
          cursor: "pointer",
          // Plegada no hay hilo debajo —la caja mide cero—, así que no habría
          // nada que difuminar y el cristal se vería como un vidrio sobre nada.
          // Ahí se queda la barra de siempre.
          background: minimized ? "rgba(255,255,255,0.04)" : "transparent",
          userSelect: "none",
        }}
      >
        {/* El canto duro se sustituye por un fundido: el mensaje que sube se
            disuelve en vez de cortarse contra una línea de 1px. */}
        {!minimized ? (
          <BlurFade
            side="top"
            size={headerHeight + HEADER_FADE_OVERHANG}
            blur={16}
            // Arriba se queda macizo, que es donde caen el avatar y el nombre;
            // el fundido empieza por debajo de ellos.
            fade={HEADER_FADE_LENGTH}
            // El MISMO color del fondo de la pestaña. Cualquier otro se leería
            // como una banda encima en vez de como el fondo desvaneciéndose.
            veil="rgba(11,11,13,0.68)"
          />
        ) : null}

        <div
          style={{
            position: "relative",
            zIndex: 1,
            display: "flex",
            alignItems: "center",
            gap: 9,
          }}
        >
          {/* A la IZQUIERDA del avatar. Se para la propagación para que abrir el
              menú no minimice también la pestaña. */}
          {otherUid ? (
            <span
              onClick={(e) => { if (!minimized) e.stopPropagation(); }}
              style={{ display: "inline-flex" }}
            >
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
                // Área de clic holgada: sin relleno, solo el propio glifo
                // respondía al toque, y en la pestaña del dock es diminuto.
                buttonStyle={{ padding: "6px 9px", lineHeight: 1 }}
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
            {/* Sin envolverlo en nada pulsable: el avatar ya trae su propio botón
                y su propia cadena — live, historias y, si no hay ninguno, esto. */}
            <LiveRingAvatar
              entityId={otherUid ?? conversationId}
              entityType="profile"
              currentUserId={selfUid}
              photoURL={profile?.photoURL ?? null}
              displayName={displayName}
              size={28}
              onClick={handleOpenProfile}
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

          {/* El nombre lleva al perfil, siempre — a diferencia del avatar, que
              primero atiende al live y a las historias. */}
          <button
            type="button"
            onClick={handleOpenProfile}
            disabled={!minimized && !profile?.handle}
            style={{
              flex: 1,
              minWidth: 0,
              border: "none",
              background: "transparent",
              padding: 0,
              textAlign: "start",
              fontFamily: "inherit",
              fontSize: 13,
              fontWeight: 500,
              color: "#fff",
              // El velo del cristal deja pasar algo de lo de detrás; esta sombra
              // es el seguro para cuando lo de detrás es un globo morado.
              textShadow: minimized ? "none" : "0 1px 3px rgba(0,0,0,0.65)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              cursor: profile?.handle ? "pointer" : "default",
            }}
          >
            {displayName}
          </button>

          {/* Minimizar: una raya, sin flecha. Estando minimizada NO se muestra —
              para volver a abrir se toca la pestaña, así que un botón de
              "expandir" sería redundante. Solo quedan avatar, nombre y tache. */}
          {!minimized ? (
            <IconButton label={tChat("minimizeChat")} size="sm" tone="bare" shape="square" style={{ placeItems: "center" }} onClick={(e) => { e.stopPropagation(); onToggleMinimize(); }}>
              <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
                <path
                  d="M6 12H18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </IconButton>
          ) : null}

          <IconButton label={tCommon("close")} size="sm" tone="bare" shape="square" style={{ placeItems: "center" }} onClick={(e) => { e.stopPropagation(); onClose(); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
              <path
                d="M6 6L18 18M18 6L6 18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </IconButton>
        </div>
      </div>

      {/* Minimizado: el hilo se queda montado pero sin suscripción ni alto. */}
      <div
        style={{
          // El margen negativo mete el hilo POR DEBAJO de la cabecera, y el
          // alto se lo devuelve: la pestaña sigue midiendo lo mismo que antes
          // (cabecera + DOCK_HEIGHT), pero ahora los mensajes recorren también
          // la franja de la cabecera y se ven pasar tras el cristal.
          marginTop: minimized ? 0 : -headerHeight,
          height: minimized ? 0 : DOCK_HEIGHT + headerHeight,
          overflow: "hidden",
          // El margen se anima junto al alto; si no, al plegar el hilo bajaría
          // de golpe mientras se encoge.
          transition:
            "height var(--duration-normal, 250ms) var(--ease-smooth, cubic-bezier(0.4, 0, 0.2, 1)), margin-top var(--duration-normal, 250ms) var(--ease-smooth, cubic-bezier(0.4, 0, 0.2, 1))",
        }}
      >
        <ConversationThread
          conversationId={conversationId}
          otherUid={otherUid}
          profile={profile}
          selfUid={selfUid}
          active={!minimized}
          // Lo que le tapa la cabecera superpuesta. Sin esto, el mensaje más
          // antiguo se quedaría escondido detrás de ella al llegar arriba.
          topInset={headerHeight}
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
