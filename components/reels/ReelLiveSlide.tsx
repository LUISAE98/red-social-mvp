"use client";

// UN live a pantalla completa dentro del feed de reels.
//
// Es un ANTICIPO, no el live. Se ve y se oye lo que está pasando, pero el chat,
// las donaciones, los super comentarios y el conteo de espectadores viven en el
// visor, y ahí solo se entra tocando. Es el trato que hace TikTok: el feed
// enseña, no mete.
//
// El reproductor NO es propio. `LiveInlinePlayer` ya resuelve lo difícil —HLS con
// hls.js, WebRTC de Cloudflare, portada mientras carga, orientación del video y
// el reintento en silencio cuando el navegador bloquea el audio— y está probado
// en el feed de comunidades. Escribir un segundo reproductor aquí habría
// duplicado justo la parte que más cuesta mantener.

import { useState } from "react";
import FillImage from "@/components/ui/FillImage";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { AvatarRing, medidaAroEnCaja } from "@/components/ui/AvatarRing";
import { SkeletonBlock } from "@/components/ui";
import { useCreatorProfile } from "@/lib/reels/creatorProfiles";
import type { ReelLivePost } from "@/lib/reels/reelItems";
import FollowCreatorButton from "@/components/social/FollowCreatorButton";
import { useLiveTicketAccess } from "@/lib/liveAccess/useLiveTicketAccess";
import LiveTicketPaywall, {
  isPaidLive,
  useLiveTicketTotal,
} from "@/components/live/LiveTicketPaywall";

/**
 * Aire bajo los botones de la última fila, en píxeles.
 *
 * Antes eran 8px fijos. Con el safe-area inferior a cero en toda la plataforma,
 * esos 8px son literalmente lo que separa un botón del canto de la pantalla, y
 * los controles se leen como si se salieran por abajo.
 *
 * Se SUMA a lo que llegue en `safeBottom` (en el reel, el alto de la barra
 * inferior), no lo sustituye: en el reel los botones tienen que quedar por
 * encima de la barra Y además respirar.
 */
const BOTTOM_BREATHING_PX = 20;


const LiveInlinePlayer = dynamic(
  () => import("@/app/components/LiveInlinePlayer/LiveInlinePlayer"),
  { ssr: false },
);

const FONT = "inherit";
/**
 * El aro de un live es ROJO, no el degradado de Vibra.
 *
 * Mismo rojo que el anillo de en vivo del resto de la plataforma
 * (`LiveRingAvatar`), para que signifique lo mismo en todas partes.
 */
const LIVE_RED = "#ef4444";
/** El degradado de Vibra. Se queda para el boton de entrar, que sigue siendo la
 *  llamada a la accion de siempre. */
const VIBRA_RING = "linear-gradient(135deg, #ec4899 0%, #9333ea 52%, #3b82f6 100%)";

type Props = {
  post: ReelLivePost;
  /** Fuera de pantalla. El reproductor suelta la conexión y deja de consumir. */
  paused?: boolean;
  muted?: boolean;
  onMutedChange?: (muted: boolean) => void;
  /** Entrar al visor del live. */
  onOpen: () => void;
  safeTop?: string | number;
  safeBottom?: string | number;
  /** Escala reducida, para el carrusel de escritorio. */
  compact?: boolean;
};

export default function ReelLiveSlide({
  post,
  paused = false,
  muted = true,
  onMutedChange,
  onOpen,
  safeTop = "0px",
  safeBottom = "0px",
  compact = false,
}: Props) {
  const tLive = useTranslations("live");

  const ld = post.liveData;
  // La cara del live es la de quien transmite. En un live no hay la ambigüedad
  // de las historias entre quien graba y quien publica: el autor del post es el
  // que está en cámara.
  //
  // Del lector COMPARTIDO: la superficie ya adelantó esta lectura al armar el
  // feed, así que aquí el creador normalmente ya está y el panel sale puesto.
  const creator = useCreatorProfile(post.authorId);
  const creatorPendiente = !!post.authorId && creator === undefined;

  // Vertical llena la pantalla; horizontal se enmarca con negro arriba y abajo
  // en vez de recortarse. Es la misma regla que ya siguen las historias.
  const [isPortrait, setIsPortrait] = useState(true);

  // Un live de boleto se ENSEÑA, no se esconde: es su escaparate. Pero se
  // enseña bloqueado.
  //
  // ⚠️ El desenfoque es una CORTINA, no una puerta: el video sigue llegando al
  // navegador y quitar un filtro de CSS es cosa de diez segundos. Lo que de
  // verdad cierra el paso es que el proxy exija el boleto antes de servir el
  // stream, y eso vive en `/api/cf-viewer-proxy`. Esto de aquí es lo que se ve.
  //
  // Y de pago NO significa bloqueado PARA TI: puedes tener el boleto, o ser
  // miembro de una comunidad donde el creador lo libero, o ser su dueno. El
  // proxy ya respeta esos tres casos, asi que la interfaz tiene que decir lo
  // mismo — si no, el servidor te deja ver y la pantalla te tapa.
  const esDePago = isPaidLive(post);
  const acceso = useLiveTicketAccess(post, esDePago);
  // Mientras se averigua se mantiene el candado: quitarlo y volver a ponerlo
  // ensena medio segundo de un live que quiza no has pagado.
  const bloqueado = esDePago && !acceso.allowed;
  const precioBoleto = useLiveTicketTotal(post);
  const [paywallOpen, setPaywallOpen] = useState(false);

  const avatarSz = compact ? 40 : 54;
  // El hueco lo dicta la medida estándar del aro, no un número a ojo.
  const avatarInset = medidaAroEnCaja(avatarSz).sobresale;
  // Aire por debajo de los botones. Con `safeBottom` numérico (historias en el
  // visor de círculos) no hay barra que esquivar y basta con el aire; con string
  // (el reel, que pasa el alto real del nav) se suma al hueco de la barra.
  const btnPadBottom =
    typeof safeBottom === "string"
      ? `calc(${safeBottom} + ${BOTTOM_BREATHING_PX}px)`
      : `${safeBottom + BOTTOM_BREATHING_PX}px`;
  const topOffset = typeof safeTop === "number" ? safeTop + 36 : `calc(${safeTop} + 36px)`;

  return (
    <>
      {/* El reproductor ocupa todo y recibe el toque. Tocar en cualquier sitio
          entra al live, que es lo que la gente intenta hacer por instinto. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 1,
          filter: bloqueado ? "blur(22px)" : undefined,
          // El desenfoque encoge la imagen por los bordes; se agranda un poco
          // para que no asomen franjas transparentes.
          transform: bloqueado ? "scale(1.08)" : undefined,
        }}
      >
        <LiveInlinePlayer
          creatorLocale={ld?.creatorLocale ?? null}
          postId={post.id}
          hlsUrl={ld?.hlsUrl ?? null}
          playbackId={ld?.playbackId ?? null}
          coverUrl={ld?.coverUrl ?? null}
          title={ld?.title ?? null}
          streamProvider={ld?.streamProvider ?? null}
          broadcastMode={ld?.broadcastMode ?? null}
          portrait
          fit={isPortrait ? "cover" : "contain"}
          onOrientationDetected={setIsPortrait}
          paused={paused}
          initialMuted={bloqueado ? true : muted}
          onMutedChange={onMutedChange}
          onClick={() => (bloqueado ? setPaywallOpen(true) : onOpen())}
        />
      </div>

      {/* Cabecera: quién transmite. Misma geometría y mismo aro que una
          historia, para que el feed no cambie de idioma visual al pasar de un
          saludo a un live. */}
      <div
        style={{
          position: "absolute",
          top: topOffset,
          insetInlineStart: 12,
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          gap: compact ? 6 : 8,
          pointerEvents: "none",
        }}
      >
        <div style={{ position: "relative", width: avatarSz, height: avatarSz, flexShrink: 0 }}>
          <div
            style={{
              position: "absolute",
              inset: avatarInset,
              borderRadius: "50%",
              overflow: "hidden",
              background: "rgba(255,255,255,0.1)",
            }}
          >
            {creatorPendiente ? (
              <SkeletonBlock height="100%" circle />
            ) : (
              <FillImage
                src={creator?.photo}
                fallback={<div style={{ width: "100%", height: "100%", background: "rgba(255,255,255,0.15)" }} />}
              />
            )}
          </div>
          <AvatarRing foto={medidaAroEnCaja(avatarSz).foto} color={LIVE_RED} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
          {creatorPendiente ? (
            <SkeletonBlock width={compact ? 84 : 116} height={compact ? 13 : 17} radius={5} style={{ margin: "1px 0" }} />
          ) : (
            <span
              style={{
                color: "#fff",
                fontSize: compact ? 13 : 17,
                fontWeight: 600,
                lineHeight: "1.2",
                fontFamily: FONT,
              }}
            >
              {creator?.name ?? ""}
            </span>
          )}
          <span
            style={{
              color: "rgba(255,255,255,0.75)",
              fontSize: compact ? 11 : 13,
              fontWeight: 500,
              lineHeight: "1.2",
              fontFamily: FONT,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: compact ? 160 : 240,
            }}
          >
            {ld?.title?.trim() || tLive("statusLive")}
          </span>
        </div>
        <FollowCreatorButton targetUserId={post.authorId ?? null} compact={compact} />
      </div>

      {/* Entrar al live. En el mismo sitio que los botones de una historia, para
          que el pulgar no tenga que buscar. */}
      <div
        style={{
          position: "absolute",
          insetInline: 0,
          bottom: 0,
          zIndex: 10,
          display: "flex",
          gap: 10,
          padding: "0 14px",
          paddingBottom: btnPadBottom,
        }}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            // Con boleto, el toque lleva a la caja y NO al live. Entrar al visor
            // solo para toparse con el mismo muro es un paso de mas.
            if (bloqueado) setPaywallOpen(true);
            else onOpen();
          }}
          style={{
            flex: 1,
            height: compact ? 38 : 44,
            borderRadius: 12,
            border: "none",
            background: VIBRA_RING,
            color: "#fff",
            fontSize: compact ? 13 : 15,
            fontWeight: 600,
            fontFamily: FONT,
            cursor: "pointer",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          {bloqueado
            ? tLive("ticketToEnterLive", { price: precioBoleto ?? "" })
            : tLive("goToLive")}
        </button>
      </div>

      {/* La caja se abre ENCIMA, sin desmontar el reel: al cerrarla se vuelve a
          la misma historia y a la misma posicion. Es la misma pasarela que usa
          el visor del live. */}
      {bloqueado && (
        <LiveTicketPaywall
          post={post}
          open={paywallOpen}
          onClose={() => setPaywallOpen(false)}
        />
      )}
    </>
  );
}
