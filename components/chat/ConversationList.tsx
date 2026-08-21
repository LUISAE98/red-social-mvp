"use client";

import type { CSSProperties } from "react";
import { useLocale, useTranslations } from "next-intl";

import LiveRingAvatar from "@/app/components/LiveRing/LiveRingAvatar";
import type { ConversationWithId } from "@/lib/chat/chatService";
import { getOtherParticipant } from "@/lib/chat/types";
import { ChatReveal, ConversationListSkeleton } from "./ChatSkeletons";
import ReadChecksIcon from "./ReadChecksIcon";

/**
 * Lista de conversaciones del inbox (perfil ↔ perfil).
 *
 * Sigue el mismo lenguaje visual que OwnerSidebarFollowedProfiles: fila
 * transparente con avatar, nombre y línea secundaria, y degradado Vibra solo en
 * la seleccionada. Así la pestaña de Mensajes no se siente ajena al resto del
 * sidebar.
 */

/** Estructuralmente compatible con el `UserMini` del OwnerSidebar. */
export type ProfileMini = {
  uid: string;
  displayName: string;
  handle: string | null;
  photoURL: string | null;
};

type Props = {
  loading: boolean;
  conversations: ConversationWithId[];
  selfUid: string | null;
  /** Perfiles de los interlocutores, por uid. */
  profiles: Record<string, ProfileMini>;
  styles: Record<string, CSSProperties>;
  onOpenConversation: (conversationId: string) => void;
  /** Hilos abiertos en pestañas: pueden ser varios a la vez. */
  activeConversationIds?: string[];
  isMobile?: boolean;
};

type TimestampLike = { toDate?: () => Date } | null | undefined;

function toDate(value: TimestampLike): Date | null {
  if (!value || typeof value.toDate !== "function") return null;
  const date = value.toDate();
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Hora corta para hoy, día y mes para lo anterior. Es lo que espera cualquiera
 * que haya usado un chat, y evita traer una librería de fechas.
 */
function formatConversationTime(value: TimestampLike, locale: string): string {
  const date = toDate(value);
  if (!date) return "";

  const now = new Date();
  const sameDay =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  if (sameDay) {
    return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(date);
  }

  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "2-digit" }),
  }).format(date);
}

export default function ConversationList({
  loading,
  conversations,
  selfUid,
  profiles,
  styles,
  onOpenConversation,
  activeConversationIds,
  isMobile = false,
}: Props) {
  const tChat = useTranslations("chat");
  const tCommon = useTranslations("common");
  const locale = useLocale();

  if (loading) {
    return (
      <div style={{ ...styles.sectionPanel, background: "transparent", padding: 0 }}>
        <ConversationListSkeleton avatarSize={isMobile ? 43 : 36} />
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div style={{ ...styles.sectionPanel, background: "transparent", padding: 0 }}>
        <div style={styles.subtle}>{tChat("noConversations")}</div>
      </div>
    );
  }

  return (
    <div
      style={{
        ...styles.sectionPanel,
        background: "transparent",
        padding: 0,
        // Cortan la cadena de encogido de arriba abajo: basta con que UN
        // ancestro no pueda encogerse para que el recorte de la vista previa no
        // llegue a aplicarse nunca.
        minWidth: 0,
      }}
    >
      {/* El contenido real entra con fade, no de golpe (vibra_style.md). */}
      <ChatReveal show>
      <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
        {conversations.map((conversation) => {
          const otherUid = selfUid
            ? getOtherParticipant(conversation.participants, selfUid)
            : null;
          const profile = otherUid ? profiles[otherUid] : undefined;
          const displayName = profile?.displayName || tCommon("user");

          const unread = selfUid ? (conversation.unread?.[selfUid] ?? 0) : 0;
          const hasUnread = unread > 0;
          const isSelected = !!activeConversationIds?.includes(conversation.id);
          const isBlocked = conversation.status === "blocked";

          const last = conversation.lastMessage;
          const mine = last?.senderId === selfUid;
          const prefix = mine ? tChat("youPrefix") : "";
          // Un mensaje solo-imagen no trae texto: se anuncia como foto en vez
          // de dejar la fila vacía.
          const preview = isBlocked
            ? tChat("conversationBlocked")
            : last?.isDeleted
              ? // El backend manda la bandera, no la frase: no sabe en qué
                // idioma lee cada quien.
                `${prefix}${tChat("messageDeleted")}`
              : last?.text
                ? `${prefix}${last.text}`
                : last?.hasImage
                  ? `${prefix}${tChat("photoPreview")}`
                  : tChat("noMessagesYet");

          const time = formatConversationTime(
            conversation.lastMessageAt as TimestampLike,
            locale
          );

          /**
           * Palomitas de leído en la fila: solo si lo ÚLTIMO del hilo lo
           * escribiste tú y ya lo vieron.
           *
           * Sale del mismo recibo agregado que en el hilo, sin ningún dato
           * nuevo: `lastReadAt` dice hasta cuándo leyó el otro, y basta con que
           * alcance a la marca del último mensaje.
           */
          const otherReadAt = otherUid ? conversation.lastReadAt?.[otherUid] : null;
          const showsReadChecks =
            mine &&
            !isBlocked &&
            !!otherReadAt &&
            !!last?.createdAt &&
            last.createdAt.toMillis() <= otherReadAt.toMillis();

          return (
            <div
              key={conversation.id}
              style={{
                ...styles.card,
                border: "none",
                margin: 0,
                borderRadius: 16,
                padding: "10px 12px",
                display: "flex",
                alignItems: "center",
                gap: 10,
                // La fila es un elemento de rejilla, y esos traen `min-width:
                // auto`: sin esto, una vista previa larga ensancha la tarjeta más
                // allá del panel por mucho que el texto de dentro esté preparado
                // para recortarse. En el sidebar eso empujaba el "Ver todos"
                // fuera de la vista.
                minWidth: 0,
                background: !isSelected
                  ? "transparent"
                  : "linear-gradient(90deg, rgba(236,72,153,0.20) 0%, rgba(147,51,234,0.18) 42%, rgba(59,130,246,0.14) 100%)",
                boxShadow: !isSelected
                  ? "none"
                  : "inset 0 1px 0 rgba(255,255,255,0.04), 0 10px 24px rgba(0,0,0,0.22)",
              }}
            >
              <button
                type="button"
                onClick={() => onOpenConversation(conversation.id)}
                style={{
                  minWidth: 0,
                  flex: 1,
                  border: "none",
                  background: "transparent",
                  color: "#fff",
                  cursor: "pointer",
                  padding: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  textAlign: "start",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                <LiveRingAvatar
                  entityId={otherUid ?? conversation.id}
                  entityType="profile"
                  currentUserId={selfUid}
                  photoURL={profile?.photoURL ?? null}
                  displayName={displayName}
                  size={isMobile ? 43 : 36}
                />

                {/* Rejilla de dos por dos, y no dos renglones con la hora
                    metida en el primero. Con la hora y las palomitas apiladas
                    DENTRO del renglón del nombre, ese renglón crecía al alto de
                    las dos y la vista previa caía a un tercer renglón, dejando
                    un hueco muerto entre el nombre y ella. Repartidas en su
                    propia columna, la hora queda a la altura del nombre y las
                    palomitas a la de la vista previa, que es donde se ven. */}
                <div
                  style={{
                    minWidth: 0,
                    flex: 1,
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) auto",
                    columnGap: 6,
                    alignItems: "center",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 6,
                      minWidth: 0,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 13,
                        // En reposo pesa lo mismo que cualquier otro nombre
                        // del producto. El no leído sigue engordando: aquí el
                        // peso no es estilo, es el aviso.
                        fontWeight: hasUnread ? 700 : 500,
                        letterSpacing: "-0.08px",
                        color: hasUnread
                          ? "rgba(255,255,255,0.98)"
                          : "rgba(255,255,255,0.94)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        minWidth: 0,
                        flex: 1,
                      }}
                    >
                      {displayName}
                    </span>
                  </div>

                  {/* Celda de la derecha del primer renglón. Va siempre, aunque
                      esté vacía: si no, la vista previa se colaría en ella y la
                      rejilla se descuadraría. Vacía no ocupa alto. */}
                  {time ? (
                    <span
                      style={{
                        fontSize: 10,
                        color: hasUnread
                          ? "rgba(255,255,255,0.70)"
                          : "rgba(255,255,255,0.40)",
                        lineHeight: 1.25,
                        whiteSpace: "nowrap",
                        justifySelf: "end",
                      }}
                    >
                      {time}
                    </span>
                  ) : (
                    <span style={{ display: "block" }} aria-hidden="true" />
                  )}

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      marginTop: 1,
                      minWidth: 0,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        color: hasUnread
                          ? "rgba(255,255,255,0.72)"
                          : "rgba(255,255,255,0.48)",
                        fontWeight: hasUnread ? 600 : 400,
                        fontStyle: conversation.lastMessage ? "normal" : "italic",
                        lineHeight: 1.25,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        minWidth: 0,
                        flex: 1,
                      }}
                    >
                      {preview}
                    </span>

                    {hasUnread ? (
                      <span
                        style={{
                          flexShrink: 0,
                          minWidth: 17,
                          height: 17,
                          padding: "0 5px",
                          borderRadius: 999,
                          background: "#a855f7",
                          color: "#fff",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 10,
                          fontWeight: 700,
                          lineHeight: 1,
                          letterSpacing: -0.1,
                        }}
                      >
                        {unread > 99 ? "99+" : unread}
                      </span>
                    ) : null}
                  </div>

                  {/* Se montan solo cuando toca, no ocultas con opacidad: un
                      elemento invisible seguiría ocupando su alto y estiraría
                      TODAS las filas, tengan visto o no. La entrada se anima al
                      montarse, con el mismo rebote que en el hilo. */}
                  {showsReadChecks ? (
                    <span className="vibra-row-checks" style={{ justifySelf: "end" }}>
                      <ReadChecksIcon size={16} />
                    </span>
                  ) : (
                    <span style={{ display: "block" }} aria-hidden="true" />
                  )}
                </div>
              </button>
            </div>
          );
        })}
      </div>
      </ChatReveal>

      {/* Entrada de las palomitas en una fila. Propia y no la del hilo: esa vive
          en el bloque de estilos de la conversación, que aquí no está montado. */}
      <style jsx global>{`
        .vibra-row-checks {
          display: block;
          line-height: 0;
          animation: vibraRowChecksPop var(--duration-normal, 250ms)
            var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1)) both;
        }
        @keyframes vibraRowChecksPop {
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
          .vibra-row-checks {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}
