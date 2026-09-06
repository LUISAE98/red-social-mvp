"use client";

import { useLocale, useTranslations } from "next-intl";
import { Timestamp } from "firebase/firestore";

import LiveRingAvatar from "@/app/components/LiveRing/LiveRingAvatar";
import {
  formatConversationTime,
  type ProfileMini,
} from "@/components/chat/ConversationList";
import type { MensajeEncontrado } from "@/lib/chat/messageCache";
import { recortarAlrededor, resaltar } from "@/lib/chat/textoBusqueda";

/**
 * Resultados de buscar DENTRO de los mensajes.
 *
 * Una fila por coincidencia, no por conversación: si hablaste tres veces de
 * "factura" con la misma persona, salen las tres, cada una con su fecha. Es lo
 * que hace cualquier mensajería y es la diferencia entre encontrar el mensaje y
 * que solo te digan en qué hilo mirar.
 */
export default function MessageSearchResults({
  resultados,
  aguja,
  perfilPorConversacion,
  selfUid,
  ladoAvatar,
  onAbrir,
}: {
  resultados: MensajeEncontrado[];
  /** Lo buscado, para resaltarlo dentro de cada fila. */
  aguja: string;
  perfilPorConversacion: (conversationId: string) => ProfileMini | undefined;
  selfUid: string | null;
  ladoAvatar: number;
  onAbrir: (conversationId: string) => void;
}) {
  const tChat = useTranslations("chat");
  const tCommon = useTranslations("common");
  const locale = useLocale();

  return (
    <div className="msgHits">
      {resultados.map((hit) => {
        const perfil = perfilPorConversacion(hit.conversationId);
        const nombre = perfil?.displayName || tCommon("user");
        const mio = hit.senderId === selfUid;

        // Recortar ANTES de resaltar: en un mensaje largo la coincidencia puede
        // estar en el carácter 400, y sin esto la fila enseñaba el principio del
        // mensaje y ni rastro de lo buscado.
        const { texto, cortadoAlInicio } = recortarAlrededor(hit.texto, aguja);
        const trozos = resaltar(texto, aguja);

        return (
          <button
            key={hit.conversationId + ":" + hit.messageId}
            type="button"
            className="msgHit vibra-pop"
            onClick={() => onAbrir(hit.conversationId)}
          >
            <LiveRingAvatar
              entityId={perfil?.uid ?? hit.conversationId}
              entityType="profile"
              currentUserId={selfUid}
              photoURL={perfil?.photoURL ?? null}
              displayName={nombre}
              size={ladoAvatar}
            />

            <span className="msgHitCuerpo">
              <span className="msgHitCabecera">
                <span className="msgHitNombre">{nombre}</span>
                <span className="msgHitFecha">
                  {formatConversationTime(
                    Timestamp.fromMillis(hit.cuando),
                    locale
                  )}
                </span>
              </span>

              <span className="msgHitTexto">
                {/* "Tú" delante, igual que en la bandeja: sin esto no se sabe
                    quién dijo lo que estás encontrando. */}
                {mio ? <span className="msgHitTuyo">{tChat("youPrefix")}</span> : null}
                {cortadoAlInicio ? "…" : null}
                {trozos.map((trozo, i) =>
                  trozo.resaltado ? (
                    <mark key={i} className="msgHitMarca">
                      {trozo.texto}
                    </mark>
                  ) : (
                    <span key={i}>{trozo.texto}</span>
                  )
                )}
              </span>
            </span>
          </button>
        );
      })}

      <style jsx>{`
        .msgHits {
          display: grid;
          gap: 6px;
        }
        .msgHit {
          display: flex;
          align-items: center;
          gap: 12px;
          width: 100%;
          min-width: 0;
          padding: 10px 8px;
          border: none;
          border-radius: 14px;
          background: transparent;
          color: inherit;
          text-align: start;
          cursor: pointer;
          font-family: inherit;
          -webkit-tap-highlight-color: transparent;
        }
        .msgHit:hover {
          background: rgba(255, 255, 255, 0.05);
        }
        .msgHitCuerpo {
          display: grid;
          gap: 3px;
          min-width: 0;
          flex: 1;
        }
        .msgHitCabecera {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 10px;
          min-width: 0;
        }
        .msgHitNombre {
          font-size: 14px;
          font-weight: 600;
          color: #fff;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .msgHitFecha {
          flex-shrink: 0;
          font-size: 11px;
          color: rgba(255, 255, 255, 0.42);
          font-variant-numeric: tabular-nums;
        }
        /* Un solo renglón con puntos suspensivos: la fila es un resumen, el
           mensaje entero se lee abriendo el hilo. */
        .msgHitTexto {
          font-size: 13px;
          line-height: 1.35;
          color: rgba(255, 255, 255, 0.62);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          min-width: 0;
        }
        .msgHitTuyo {
          color: rgba(255, 255, 255, 0.42);
        }
        /* El navegador pinta <mark> en amarillo sobre negro por defecto, que
           aquí sería un brochazo. Se reescribe entero. */
        .msgHitMarca {
          background: transparent;
          color: #fff;
          font-weight: 700;
        }
      `}</style>
    </div>
  );
}
